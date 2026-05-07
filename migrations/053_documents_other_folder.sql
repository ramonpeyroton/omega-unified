-- Migration 053: add 'other' to job_documents.folder check.
--
-- Bulk legacy import (Brenda + Rafaela populating ~250 old client
-- cards) needs a catch-all bucket for documents the AI classifier
-- cannot place with confidence. "Other" makes them land somewhere
-- reviewable instead of being lost or blocking the upload.
--
-- Last edited in migration 045 (added 'daily_logs'). We keep the
-- whole list and append 'other'.
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
    'other'
  ));
