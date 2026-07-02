-- 074 — Change Orders become signable online documents (like estimates).
--
-- The change_orders table existed in production but was never defined in a
-- migration. This formalizes it AND adds the fields needed to send it to
-- the client, have them sign it online (native signature, same as
-- estimates), flip the status to 'signed', and count the amount toward the
-- job's revenue.
--
-- Status lifecycle: 'draft' -> 'sent' -> 'signed' (or 'rejected').
-- (Legacy rows may still be 'pending'/'approved'; those are untouched and
-- simply won't count as signed.)
--
-- RLS is intentionally left as-is (the table is already anon-readable for
-- the internal Contracts screen, and the public sign page needs that read;
-- writes on signing happen server-side with the service role).

create table if not exists public.change_orders (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null,
  contract_id  uuid,
  status       text not null default 'draft',
  description  text,
  amount       numeric default 0,
  reason       text,
  paid         boolean default false,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz default now()
);

-- Signable-document fields (mirror estimates). ADD IF NOT EXISTS keeps this
-- safe against the table already existing with the legacy columns.
alter table public.change_orders add column if not exists co_number integer;
alter table public.change_orders add column if not exists created_by text;

-- Send / open tracking
alter table public.change_orders add column if not exists sent_at timestamptz;
alter table public.change_orders add column if not exists sent_by text;
alter table public.change_orders add column if not exists pdf_url text;
alter table public.change_orders add column if not exists client_opened_at timestamptz;
alter table public.change_orders add column if not exists client_open_count integer default 0;

-- Signature capture
alter table public.change_orders add column if not exists signature_png text;
alter table public.change_orders add column if not exists initials_png text;
alter table public.change_orders add column if not exists signed_by text;
alter table public.change_orders add column if not exists signed_at timestamptz;
alter table public.change_orders add column if not exists signed_date text;
alter table public.change_orders add column if not exists signed_ip text;
alter table public.change_orders add column if not exists signed_user_agent text;
alter table public.change_orders add column if not exists disclaimers text;
alter table public.change_orders add column if not exists disclaimers_acknowledged boolean default false;
alter table public.change_orders add column if not exists consent boolean default false;

create index if not exists idx_change_orders_job on public.change_orders (job_id);
