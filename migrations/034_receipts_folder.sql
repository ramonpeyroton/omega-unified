-- Migration 034: add 'receipts' to job_documents.folder check.
--
-- Gabriel's redesigned Today's Jobs row gained a "Receipts" CTA that
-- launches the phone camera so he can snap a photo of a material
-- purchase receipt. The photo lands in two places:
--   1. job_documents (folder = 'receipts')  → visible in the Documents
--      tab of the project, alongside Invoices/Permits/Plans/etc.
--   2. job_expenses (receipt_url = same URL) → so the spend already
--      shows up in Financials without him retyping anything.
--
-- The existing check constraint only allowed the original 6 folders
-- ('invoices','permits','building_plans','checks','contracts',
-- 'change_orders'). We drop+recreate it to add 'receipts'.
--
-- Idempotent: rerunning is safe — the DROP uses IF EXISTS and the
-- ADD uses a stable name that we drop first.

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
    'change_orders'
  ));
