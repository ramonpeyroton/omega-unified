-- Migration 054: add 'coi' to job_documents.folder check.
--
-- Adds a Certificate of Insurance folder to the Documents tab of
-- each client card. Separate from subcontractor_coi_documents
-- (migration 051) — that one is per-subcontractor; this one is per
-- job, for COIs sent by the client's own carrier or specifically
-- attached to this project.
--
-- Last edited in migration 053 (added 'other'). We keep that and
-- append 'coi'.
--
-- Idempotent.

ALTER TABLE public.job_documents
  DROP CONSTRAINT IF EXISTS job_documents_folder_check;

ALTER TABLE public.job_documents
  ADD CONSTRAINT job_documents_folder_check
  CHECK (folder IN (
    'invoices',
    'receipts',
    'permits',
    'building_plans',
    'checks',
    'contracts',
    'change_orders',
    'daily_logs',
    'other',
    'coi'
  ));
