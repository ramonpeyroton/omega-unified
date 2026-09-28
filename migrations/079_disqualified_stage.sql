-- Migration 079: "Disqualified" pipeline stage.
--
-- A last column for leads that never became a real opportunity (out of
-- area, spam, budget too low, duplicate…). It behaves like Lost:
--   * moving a card there asks for a reason (+ the user's PIN, in the app);
--   * the card leaves the active board (in_pipeline = false) — the Kanban
--     shows the 10 most recent, the rest stay in My Leads;
--   * it is NOT a lost deal, so it stays out of the close-rate math.
--
-- What it does:
--   1. jobs_pipeline_status_check → 14 values (077's 13 + 'disqualified').
--   2. jobs_lost_reason_check → also accepts the disqualification reasons
--      (budget_too_low, bad_contact, spam, duplicate). lost_reason /
--      lost_note now hold the reason for Lost OR Disqualified.
--   3. jobs_track_stage() (077) keeps the reason when a card moves into
--      Disqualified (it used to clear it for every status except Lost).
--   4. jobs_auto_eject_on_rejected() (038) also takes Disqualified cards
--      off the board. Lost behaves exactly as before.
--
-- No row is changed. Nothing moves automatically into Disqualified —
-- only a person moving the card does that. Run it BEFORE deploying the
-- frontend that shows the new column. Safe to re-run.

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
    'disqualified',
    'estimate_rejected'
  ));

-- 2. Reasons (Lost + Disqualified share lost_reason / lost_note) ─────
alter table public.jobs drop constraint if exists jobs_lost_reason_check;
alter table public.jobs add constraint jobs_lost_reason_check
  check (lost_reason is null or lost_reason in (
    -- Lost
    'no_response',
    'not_a_fit',
    'price',
    'went_with_competitor',
    'out_of_area',
    'estimate_rejected',
    'other',
    -- Disqualified (not_a_fit / out_of_area / other are shared)
    'budget_too_low',
    'bad_contact',
    'spam',
    'duplicate'
  ));

-- 3. Keep the reason on a move into Disqualified ───────────────────────
create or replace function public.jobs_track_stage()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
    if new.pipeline_status is distinct from 'estimate_rejected'
       and new.pipeline_status is distinct from 'disqualified' then
      new.lost_reason := null;
      new.lost_note   := null;
    end if;
  elsif new.pipeline_status is distinct from old.pipeline_status then
    new.stage_entered_at := now();
    if new.pipeline_status = 'estimate_rejected' then
      -- Moves that don't ask for a reason (e.g. the Estimate Flow
      -- "Reject" button) default to 'estimate_rejected'.
      new.lost_reason := coalesce(new.lost_reason, 'estimate_rejected');
    elsif new.pipeline_status = 'disqualified' then
      null; -- keep the reason the move sent
    else
      new.lost_reason := null;
      new.lost_note   := null;
    end if;
  end if;
  return new;
end;
$$;

-- 4. Disqualified leaves the active board, like Lost ─────────────────
create or replace function public.jobs_auto_eject_on_rejected()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE'
      and new.pipeline_status in ('estimate_rejected', 'disqualified')
      and coalesce(old.pipeline_status, '') <> new.pipeline_status) then
    new.in_pipeline := false;
  end if;
  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- ROLLBACK — roll the FRONTEND back first, then paste this. Disqualified
-- cards become Lost (still off the board); disqualification-only reasons
-- become 'other'. Restores the 077 / 038 function bodies and checks.
--
-- begin;
-- update public.jobs
--    set pipeline_status = 'estimate_rejected',
--        lost_reason = case when lost_reason in ('budget_too_low', 'bad_contact', 'spam', 'duplicate')
--                           then 'other' else lost_reason end
--  where pipeline_status = 'disqualified';
-- update public.jobs set lost_reason = 'other'
--  where lost_reason in ('budget_too_low', 'bad_contact', 'spam', 'duplicate');
-- create or replace function public.jobs_auto_eject_on_rejected()
-- returns trigger language plpgsql as $f$
-- begin
--   if (tg_op = 'UPDATE' and new.pipeline_status = 'estimate_rejected'
--       and coalesce(old.pipeline_status, '') <> 'estimate_rejected') then
--     new.in_pipeline := false;
--   end if;
--   return new;
-- end; $f$;
-- create or replace function public.jobs_track_stage()
-- returns trigger language plpgsql as $f$
-- begin
--   if tg_op = 'INSERT' then
--     new.stage_entered_at := coalesce(new.stage_entered_at, now());
--     if new.pipeline_status is distinct from 'estimate_rejected' then
--       new.lost_reason := null; new.lost_note := null;
--     end if;
--   elsif new.pipeline_status is distinct from old.pipeline_status then
--     new.stage_entered_at := now();
--     if new.pipeline_status = 'estimate_rejected' then
--       new.lost_reason := coalesce(new.lost_reason, 'estimate_rejected');
--     else
--       new.lost_reason := null; new.lost_note := null;
--     end if;
--   end if;
--   return new;
-- end; $f$;
-- alter table public.jobs drop constraint if exists jobs_lost_reason_check;
-- alter table public.jobs add constraint jobs_lost_reason_check
--   check (lost_reason is null or lost_reason in ('no_response', 'not_a_fit', 'price',
--     'went_with_competitor', 'out_of_area', 'estimate_rejected', 'other'));
-- alter table public.jobs drop constraint if exists jobs_pipeline_status_check;
-- alter table public.jobs add constraint jobs_pipeline_status_check
--   check (pipeline_status in ('new_lead', 'contacted', 'visit_scheduled', 'visited',
--     'estimate_draft', 'estimate_sent', 'estimate_negotiating', 'estimate_approved',
--     'contract_sent', 'contract_signed', 'in_progress', 'completed', 'estimate_rejected'));
-- commit;
-- notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
