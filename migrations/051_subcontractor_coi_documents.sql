-- Migration 051: COI document history per subcontractor
-- Replaces the single coi_url column with a proper history table.
-- The most recent row (by uploaded_at) is the "active" COI.

create table if not exists subcontractor_coi_documents (
  id             uuid        primary key default gen_random_uuid(),
  subcontractor_id uuid      not null references subcontractors(id) on delete cascade,
  file_url       text        not null,
  file_name      text,
  label          text,
  uploaded_at    timestamptz not null default now(),
  uploaded_by    text
);

create index if not exists idx_sub_coi_docs_sub_date
  on subcontractor_coi_documents(subcontractor_id, uploaded_at desc);
