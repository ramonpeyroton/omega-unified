-- Migration 035: per-lead status, separate from pipeline_status.
--
-- Rafaela's "My Leads" view used to show a status badge derived from
-- pipeline_status (LOST / WON / PENDING). That mixes two concepts:
--   • pipeline_status is the SALES PIPELINE state (new_lead →
--     estimate_sent → contract_signed → in_progress → completed) that
--     drives the kanban and Attila's workflow.
--   • lead_status is the RECEPTIONIST's quick tag — the answer to
--     "what happened on the last call?" — and updates several times
--     per day as she dials through leads.
--
-- Six allowed values, free to be NULL while she hasn't tagged the
-- lead yet. Stored as text so we don't have to migrate enums every
-- time the team adds a label.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP/ADD constraint.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS lead_status text;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_lead_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_lead_status_check
  CHECK (lead_status IS NULL OR lead_status IN (
    'appointment_set',
    'declined',
    'estimate_sent',
    'follow_up',
    'lost',
    'signed'
  ));

-- Helps the LeadsList sort / filter by status without a seq scan.
CREATE INDEX IF NOT EXISTS jobs_lead_status_idx
  ON public.jobs (lead_status)
  WHERE lead_status IS NOT NULL;
