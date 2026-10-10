-- Migration 086: one DocuSign "Signed Contract" document per CONTRACT.
--
-- Replaces 073 (never run in production). 073 allowed only one signed
-- contract per JOB, which would also block the PDF of a job's second
-- contract. Every save stores the file at
--   <job_id>/contracts/signed-contract-<contract_id>-<date>.pdf
-- so the unique key here is the file (photo_url) instead.
--
-- Why now: on 10/10/26 four "Check Signature Status" taps saved Eric
-- Goodman's signed contract 4 times (same file, 4 rows). Nicolas Brissat
-- and Daniel & Angie Moon also have 2 rows each. The app now runs the
-- "just signed" steps once (EstimateFlow + webhook), and this index is the
-- database-level backstop.
--
-- Step 1 deletes ONLY the extra rows: same job, same file, keeping the
-- oldest. The PDF file in Storage is shared by all of them and is not
-- touched, so every job keeps its signed contract.

delete from public.job_documents d
using public.job_documents keep
where d.folder = 'contracts'
  and d.uploaded_by = 'DocuSign'
  and d.title like 'Signed Contract%'
  and keep.folder = 'contracts'
  and keep.uploaded_by = 'DocuSign'
  and keep.title like 'Signed Contract%'
  and keep.job_id = d.job_id
  and keep.photo_url = d.photo_url
  and (keep.created_at, keep.id) < (d.created_at, d.id);

drop index if exists public.job_documents_signed_contract_uniq;

create unique index if not exists job_documents_signed_contract_file_uniq
  on public.job_documents (photo_url)
  where folder = 'contracts'
    and uploaded_by = 'DocuSign'
    and title like 'Signed Contract%'
    and photo_url is not null;
