-- Migration 064: add 'sub_invoices' to job_documents.folder check.
--
-- New dedicated folder for subcontractor invoices received via email
-- (Gmail AI integration) or uploaded manually. Kept separate from the
-- existing 'invoices' folder (used for client-facing invoices / billing).
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
    'coi',
    'sub_invoices'
  ));
