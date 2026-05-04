-- Migration 039: lead_owner — who "owns" each lead.
--
-- Used by the commission engine (migration 040): when the lead
-- progresses past New Lead, the receptionist who owns it earns $40
-- (visit) and another $300 (signed contract). It also drives the
-- "Owner" column in My Leads so anyone scanning the list can see
-- whose pipe each lead lives in.
--
-- Backfill rule: existing rows pick the most reasonable proxy we
-- already have — the receptionist who created the lead (created_by)
-- if it's a receptionist-flavored row, otherwise assigned_to. Rows
-- with neither are left NULL and Ramon can fix them later via the
-- Edit Lead modal.
--
-- Idempotent.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS lead_owner text;

-- Best-effort backfill — only touches rows that don't already have
-- a value, so re-running this migration is safe.
UPDATE public.jobs
   SET lead_owner = assigned_to
 WHERE lead_owner IS NULL
   AND assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_lead_owner_idx
  ON public.jobs (lead_owner)
  WHERE lead_owner IS NOT NULL;
