-- Migration 031: per-job notes the team writes inside the JobFullView
-- Details tab. Mirrors the "Notes" card in Ramon's redesign mockup.
--
-- Each row is one note authored by one user. The Details tab renders
-- the most recent N (sorted by created_at DESC) plus a "+ Add Note"
-- button that inserts a fresh row.
--
-- Keyed by user_name (not user_id) to match the rest of the PIN-only
-- auth model. When auth-hardening lands, switch to user_id along with
-- the rest of the schema.

CREATE TABLE IF NOT EXISTS job_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_name   TEXT        NOT NULL,
  user_role   TEXT,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "give me every note for THIS job, newest first."
CREATE INDEX IF NOT EXISTS job_notes_job_idx
  ON job_notes (job_id, created_at DESC);

ALTER TABLE job_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_notes anon all" ON job_notes;
CREATE POLICY "job_notes anon all"
  ON job_notes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
