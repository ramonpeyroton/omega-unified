-- Migration 077: Lead Central pipeline.
--
-- Adds three early-funnel stages to the pipeline — Contacted, Visit
-- Scheduled, Visited — and the data the Lost flow and the website lead
-- intake need. "Estimate Rejected" is relabelled "Lost" in the app; the
-- key stays 'estimate_rejected', so nothing here renames data.
--
-- What it does:
--   1. jobs_pipeline_status_check → 13 allowed values (the 10 from 004 +
--      contacted, visit_scheduled, visited).
--   2. New nullable columns on jobs: stage_entered_at, lost_reason (+ check),
--      lost_note, external_lead_id, lead_source_url, client_phone_digits
--      (generated) + their indexes. One-time backfill of stage_entered_at.
--   3. New table job_stage_events — history of every stage change. RLS on,
--      no policies → server-only (same approach as 076).
--   4. Triggers: BEFORE stamps stage_entered_at and keeps lost_* coherent;
--      AFTER writes one job_stage_events row per real stage change.
--
-- What it does NOT do:
--   * No automatic stage moves. Cards enter / leave the new stages only
--     when someone moves them in the app.
--   * No change to the existing triggers on jobs (038 auto-eject,
--     040 commissions, 041 calendar propagation, 043 chat members), and
--     no change to RLS or policies on any existing table.
--   * Rows are not moved or deleted. The only data write is the
--     stage_entered_at backfill.
--
-- Live DB checked 2026-09-26 before writing this: pipeline_status is
-- varchar(50) with jobs_pipeline_status_check as its only constraint;
-- jobs has 4 user triggers (all enabled); owner is postgres.
--
-- Run it in the Supabase SQL editor BEFORE deploying the frontend that
-- uses the new stages. The frontend that is live today keeps working
-- with this migration applied. Safe to re-run.

begin;

-- 1. Allowed pipeline stages ─────────────────────────────────────────
alter table public.jobs drop constraint if exists jobs_pipeline_status_check;
alter table public.jobs add constraint jobs_pipeline_status_check
  check (pipeline_status in (
    'new_lead',
    'contacted',
    'visit_scheduled',
    'visited',
    'estimate_draft',
    'estimate_sent',
    'estimate_negotiating',
    'estimate_approved',
    'contract_sent',
    'contract_signed',
    'in_progress',
    'completed',
    'estimate_rejected'
  ));

-- 2. New columns ─────────────────────────────────────────────────────
alter table public.jobs
  add column if not exists stage_entered_at    timestamptz,
  add column if not exists lost_reason         text,
  add column if not exists lost_note           text,
  add column if not exists external_lead_id    text,
  add column if not exists lead_source_url     text,
  add column if not exists client_phone_digits text
    generated always as (right(regexp_replace(coalesce(client_phone, ''), '\D', '', 'g'), 10)) stored;

alter table public.jobs drop constraint if exists jobs_lost_reason_check;
alter table public.jobs add constraint jobs_lost_reason_check
  check (lost_reason is null or lost_reason in (
    'no_response',
    'not_a_fit',
    'price',
    'went_with_competitor',
    'out_of_area',
    'estimate_rejected',
    'other'
  ));

-- One-time backfill: stage_entered_at = coalesce(updated_at, created_at).
-- Written as a same-type ALTER ... USING (a table rewrite) instead of an
-- UPDATE on purpose: an UPDATE of every row would fire trigger 040 on all
-- of them (it runs on EVERY update of jobs) and broadcast a Realtime
-- UPDATE per row (the TV dashboard would re-celebrate every signed
-- contract). The rewrite does neither. Rows that already have a value
-- keep it, so re-running is harmless.
alter table public.jobs
  alter column stage_entered_at type timestamptz
  using coalesce(stage_entered_at, updated_at, created_at);

create index if not exists jobs_client_phone_digits_idx
  on public.jobs (client_phone_digits);

-- Website / Houzz / Local Services intake dedupe: one job per external id
-- per source.
create unique index if not exists jobs_lead_source_external_lead_id_key
  on public.jobs (lead_source, external_lead_id)
  where external_lead_id is not null;

-- 3. Stage history (server-only) ─────────────────────────────────────
create table if not exists public.job_stage_events (
  id          uuid        primary key default gen_random_uuid(),
  job_id      uuid        not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status   text        not null,
  changed_at  timestamptz not null default now()
);

create index if not exists job_stage_events_to_status_changed_at_idx
  on public.job_stage_events (to_status, changed_at);
create index if not exists job_stage_events_job_id_changed_at_idx
  on public.job_stage_events (job_id, changed_at);

-- RLS on with no policy → the public anon key can neither read nor write
-- it. Rows are written by the SECURITY DEFINER trigger below; the server
-- (service_role) bypasses RLS to read them, e.g. for a future "visits
-- done today" line in the daily summary.
alter table public.job_stage_events enable row level security;

-- 4a. BEFORE trigger — stamp stage_entered_at, keep lost_* coherent ───
-- Only acts on INSERT or on a REAL stage change. Re-saving the same stage
-- (e.g. reordering cards inside a column) touches nothing, so the 234
-- legacy Lost rows keep lost_reason NULL until someone actually moves them.
create or replace function public.jobs_track_stage()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
    if new.pipeline_status is distinct from 'estimate_rejected' then
      new.lost_reason := null;
      new.lost_note   := null;
    end if;
  elsif new.pipeline_status is distinct from old.pipeline_status then
    new.stage_entered_at := now();
    if new.pipeline_status = 'estimate_rejected' then
      -- Moves that don't ask for a reason (e.g. the Estimate Flow
      -- "Reject" button) default to 'estimate_rejected'.
      new.lost_reason := coalesce(new.lost_reason, 'estimate_rejected');
    else
      new.lost_reason := null;
      new.lost_note   := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_track_stage_trg on public.jobs;
create trigger jobs_track_stage_trg
  before insert or update of pipeline_status on public.jobs
  for each row execute function public.jobs_track_stage();

-- 4b. AFTER trigger — one history row per real stage change ──────────
create or replace function public.jobs_log_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
begin
  if new.pipeline_status is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.pipeline_status is not distinct from old.pipeline_status then
      return null;
    end if;
    v_from := old.pipeline_status;
  end if;
  insert into public.job_stage_events (job_id, from_status, to_status)
  values (new.id, v_from, new.pipeline_status);
  return null;
end;
$$;

drop trigger if exists jobs_log_stage_event_trg on public.jobs;
create trigger jobs_log_stage_event_trg
  after insert or update of pipeline_status on public.jobs
  for each row execute function public.jobs_log_stage_event();

commit;

-- Tell PostgREST to reload so the new columns are visible immediately.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- ROLLBACK — roll the FRONTEND back first (the old app does not know the
-- three new stages), then paste this. It removes the triggers and the
-- history table, moves any card sitting in a new stage back to New Lead
-- and restores the 10-value check. The new columns stay (the old app
-- ignores them; dropping them loses Lost reasons and website lead ids).
--
-- begin;
-- drop trigger if exists jobs_log_stage_event_trg on public.jobs;
-- drop trigger if exists jobs_track_stage_trg on public.jobs;
-- drop function if exists public.jobs_log_stage_event();
-- drop function if exists public.jobs_track_stage();
-- drop table if exists public.job_stage_events;
-- update public.jobs set pipeline_status = 'new_lead'
--  where pipeline_status in ('contacted', 'visit_scheduled', 'visited');
-- alter table public.jobs drop constraint if exists jobs_pipeline_status_check;
-- alter table public.jobs add constraint jobs_pipeline_status_check
--   check (pipeline_status in ('new_lead', 'estimate_draft', 'estimate_sent',
--     'estimate_negotiating', 'estimate_approved', 'contract_sent',
--     'contract_signed', 'in_progress', 'completed', 'estimate_rejected'));
-- commit;
-- notify pgrst, 'reload schema';
--
-- Optional — only if the columns must go too (their data is lost):
-- begin;
-- drop index if exists jobs_lead_source_external_lead_id_key;
-- drop index if exists jobs_client_phone_digits_idx;
-- alter table public.jobs
--   drop constraint if exists jobs_lost_reason_check,
--   drop column if exists client_phone_digits,
--   drop column if exists lead_source_url,
--   drop column if exists external_lead_id,
--   drop column if exists lost_note,
--   drop column if exists lost_reason,
--   drop column if exists stage_entered_at;
-- commit;
-- notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
