-- Migration 081: Bills — operating expenses tab for Operations
--
-- Brenda manages the company's operating bills (rent, utilities, software,
-- insurance, taxes, etc.) in a new Finance tab called "Bills". Supports:
--   • one-time bills (template_id = null, single row in `bills`)
--   • recurring bills (template defines the rule, `bills` holds the per-period
--     occurrences materialized by src/shared/lib/bills.js)
--   • fixed amount OR variable amount (Operations fills in each period)
--
-- NOT the same as `company_expenses` (migration 071) — those are ad-hoc
-- field receipts logged by the Manager (Gabriel) and are reimbursable to
-- Personal / Office categories. `bills` is Brenda's structured bill tracker.

-- ─── Vendors (reusable payees) ───────────────────────────────────────
-- Operations creates once ("Eversource", "QuickBooks", "State Farm")
-- and reuses across bills + templates. `category` here is a soft hint;
-- the authoritative category lives on each bill.
create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text
);

-- Unique vendor name among active rows (case-insensitive) so you can't
-- end up with "Eversource" + "eversource" + "EVERSOURCE".
create unique index if not exists vendors_name_active_unique
  on public.vendors (lower(name)) where active = true;

alter table public.vendors enable row level security;
create policy "allow all" on public.vendors for all using (true) with check (true);

-- ─── Bill templates (recurrence rules) ───────────────────────────────
-- One template per recurring bill. The library helper
-- src/shared/lib/bills.js#materializeTemplate materializes future
-- occurrences into `bills`.
--
-- amount_mode:
--   'fixed'    — default_amount is the amount every period; occurrences
--                are pre-filled with it on materialization
--   'variable' — default_amount is a hint; each occurrence starts with
--                amount=null and shows an "Enter amount" chip until
--                Operations fills it in
--
-- due_day:
--   weekly/biweekly  — 0-6 (Sun..Sat) for the day of week
--   monthly          — 1-31 for the day of month (31 clamps to month end)
--   quarterly/annual — 1-31 for the day of month at each cycle
create table if not exists public.bill_templates (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid references public.vendors(id) on delete set null,
  label           text not null,
  category        text not null,
  amount_mode     text not null check (amount_mode in ('fixed','variable')),
  default_amount  numeric(10,2),
  recurrence      text not null check (recurrence in ('weekly','biweekly','monthly','quarterly','annual')),
  due_day         int,
  start_date      date not null,
  end_date        date,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists bill_templates_active_idx
  on public.bill_templates (active);

alter table public.bill_templates enable row level security;
create policy "allow all" on public.bill_templates for all using (true) with check (true);

-- ─── Bills (occurrences) ─────────────────────────────────────────────
-- Each row is one billing period. For recurring: materialized from a
-- template (template_id set). For one-time: inserted directly with
-- template_id = null.
--
-- status:
--   'pending' — not yet paid; may be overdue (computed from due_date in UI)
--   'paid'    — paid; paid_at + paid_amount set
--   'skipped' — intentionally skipped this period (e.g. vendor credit)
create table if not exists public.bills (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid references public.bill_templates(id) on delete set null,
  vendor_id          uuid references public.vendors(id) on delete set null,
  label              text not null,
  category           text not null,
  due_date           date not null,
  amount             numeric(10,2),
  amount_entered_at  timestamptz,
  status             text not null default 'pending' check (status in ('pending','paid','skipped')),
  paid_at            timestamptz,
  paid_amount        numeric(10,2),
  payment_method     text,
  attachment_url     text,
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         text,
  overdue_notified_at timestamptz, -- last time an "overdue" push fired for this bill
  due_soon_notified_at timestamptz -- when the "2 days before" push fired
);

-- A template can only materialize ONE bill per due_date (idempotent
-- regenerations are safe).
create unique index if not exists bills_template_due_unique
  on public.bills (template_id, due_date) where template_id is not null;

create index if not exists bills_due_idx    on public.bills (due_date);
create index if not exists bills_status_idx on public.bills (status);
create index if not exists bills_pending_due_idx
  on public.bills (due_date) where status = 'pending';

alter table public.bills enable row level security;
create policy "allow all" on public.bills for all using (true) with check (true);

-- ROLLBACK:
-- drop table if exists public.bills;
-- drop table if exists public.bill_templates;
-- drop table if exists public.vendors;
