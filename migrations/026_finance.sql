-- Migration 026: Finance area (Brenda + Inácio + Admin only).
--
-- Three new tables:
--   * `bank_accounts` — the company's bank accounts (lista fixa
--     pequena, mas editável pela Brenda na própria área Finance).
--   * `payment_milestones` — uma linha por parcela de cada contrato
--     ASSINADO. Materializadas pelo webhook DocuSign a partir do
--     JSONB `contracts.payment_plan` quando o cliente assina.
--   * `sub_payments` — espelho pro lado dos subcontractors. Geradas
--     a partir de `subcontractor_agreements.payment_plan` quando o sub
--     assina o agreement.
--
-- The JSONB `payment_plan` continua sendo a "spec" do plano (definida
-- pela Brenda no EstimateFlow step 2). As tabelas abaixo guardam o
-- ESTADO mutável de cada parcela: status, valor recebido, data, conta
-- destino, notas. Audit log acompanha cada mudança via `audit_log`.
--
-- Permissões: a app é gated client-side. RLS permissiva como nas
-- outras tabelas — só os roles owner/operations/admin enxergam o
-- item "Finance" na sidebar e disparam as queries.

-- ─── bank_accounts ────────────────────────────────────────────────
create table if not exists public.bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                       -- "Wells Fargo Operations"
  last4       text,                                -- "9842" (últimos 4 dígitos)
  active      boolean not null default true,
  sort_order  int     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── payment_milestones ──────────────────────────────────────────
-- Status enum encoded as text so it's grepable and easy to evolve.
-- Allowed values today: 'pending' | 'partial' | 'paid' | 'overdue'.
create table if not exists public.payment_milestones (
  id                       uuid primary key default gen_random_uuid(),
  contract_id              uuid,
  job_id                   uuid,
  order_idx                int  not null default 0,
  label                    text,
  due_amount               numeric(12,2) not null,
  due_date                 date,
  received_amount          numeric(12,2) not null default 0,
  received_at              timestamptz,
  received_to_account_id   uuid,
  status                   text not null default 'pending',
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ─── sub_payments ────────────────────────────────────────────────
create table if not exists public.sub_payments (
  id                    uuid primary key default gen_random_uuid(),
  agreement_id          uuid,
  subcontractor_id      uuid,
  job_id                uuid,
  order_idx             int  not null default 0,
  label                 text,
  due_amount            numeric(12,2) not null,
  due_date              date,
  paid_amount           numeric(12,2) not null default 0,
  paid_at               timestamptz,
  paid_from_account_id  uuid,
  status                text not null default 'pending',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────
create index if not exists payment_milestones_contract_idx
  on public.payment_milestones (contract_id);
create index if not exists payment_milestones_job_idx
  on public.payment_milestones (job_id);
create index if not exists payment_milestones_status_idx
  on public.payment_milestones (status);
create index if not exists payment_milestones_due_idx
  on public.payment_milestones (due_date);

create index if not exists sub_payments_agreement_idx
  on public.sub_payments (agreement_id);
create index if not exists sub_payments_job_idx
  on public.sub_payments (job_id);
create index if not exists sub_payments_status_idx
  on public.sub_payments (status);

-- ─── RLS — permissive, like the rest of the app ──────────────────
alter table public.bank_accounts        enable row level security;
alter table public.payment_milestones   enable row level security;
alter table public.sub_payments         enable row level security;

drop policy if exists bank_accounts_anon_all      on public.bank_accounts;
drop policy if exists payment_milestones_anon_all on public.payment_milestones;
drop policy if exists sub_payments_anon_all       on public.sub_payments;

create policy bank_accounts_anon_all
  on public.bank_accounts      for all using (true) with check (true);
create policy payment_milestones_anon_all
  on public.payment_milestones for all using (true) with check (true);
create policy sub_payments_anon_all
  on public.sub_payments       for all using (true) with check (true);

-- Force PostgREST schema reload so the API sees the new tables
-- immediately (no waiting for the periodic refresh).
notify pgrst, 'reload schema';
