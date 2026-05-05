-- Migration 045: add 'daily_logs' to job_documents.folder check.
--
-- Every image / file uploaded inside a project's Daily Logs chat
-- (NativeProjectChat) writes a pointer row in job_documents under
-- this folder. That way the Documents tab of the card grows a
-- searchable archive of all chat media without users doing extra
-- work — they post a photo of the punch list, it shows up here.
--
-- The CHECK constraint was last edited in migration 034 to add
-- 'receipts'. We keep that and append 'daily_logs'.
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
    'daily_logs'
  ));
