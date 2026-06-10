-- Migration 071: company_expenses table
--
-- Overhead expenses that are NOT tied to a specific client/project —
-- Office supplies and Gabriel's reimbursable Personal expenses. Logged
-- from the manager's "Company expense (no client)" entry in Quick
-- Receipts and surfaced in the Finance → Company tab.
--
-- These deliberately live in their OWN table (not job_expenses) so they
-- never touch any client's project cost / margin. Per-project costs
-- (Material, Fuel, Van, Returns) stay in job_expenses.
--
-- Personal expenses are reimbursable: they start as 'to_reimburse' and
-- Brenda/Inácio mark them 'reimbursed' from the Finance screen. Office
-- expenses are company money out the door — 'not_applicable'.

create table if not exists public.company_expenses (
  id                   uuid primary key default gen_random_uuid(),
  date                 date,
  category             text not null default 'Office',          -- 'Office' | 'Personal'
  description          text,
  amount               numeric(12, 2) not null,
  receipt_url          text,
  logged_by            text,
  reimbursable         boolean not null default false,           -- true for Personal
  reimbursement_status text not null default 'not_applicable',   -- 'not_applicable' | 'to_reimburse' | 'reimbursed'
  reimbursed_at        timestamptz,
  reimbursed_by        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists company_expenses_created_idx
  on public.company_expenses (created_at desc);

-- RLS: permissive (same pattern as all internal tables)
alter table public.company_expenses enable row level security;

create policy "allow all" on public.company_expenses
  for all using (true) with check (true);
