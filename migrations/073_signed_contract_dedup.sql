-- Migration 073: stop duplicate "Signed Contract" docs.
--
-- handleSaveSignedPdf (api/docusign/[action].js) used a check-then-insert
-- (SELECT "does a Signed Contract exist?" → INSERT) that is NOT atomic:
-- when the save fired several times at once (status refresh / multiple
-- surfaces), every call passed the SELECT before any INSERT committed,
-- so 2-3 identical rows landed within microseconds. Sian Zhu had 3,
-- Deeksha 2, etc. — all cleaned up before this index was created.
--
-- This partial unique index makes "one DocuSign-saved signed contract
-- per job" a hard database rule, so a racing INSERT now fails with
-- 23505 (which the handler swallows as an idempotent success) instead
-- of creating a duplicate.

create unique index if not exists job_documents_signed_contract_uniq
  on public.job_documents (job_id)
  where folder = 'contracts'
    and uploaded_by = 'DocuSign'
    and title like 'Signed Contract%';
