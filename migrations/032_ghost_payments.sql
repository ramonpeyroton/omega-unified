-- Migration 032: ghost_payments — manual ledger of checks the office
-- writes against the GHOST account.
--
-- Brenda asked for a private register that does NOT sync with
-- QuickBooks (audit reasons). Each row captures one check: who got
-- paid, when, how much, optional check # + notes, and which job
-- (when applicable — solo payments are allowed too).
--
-- Auditability:
--   * Soft-delete via deleted_at — rows are never physically removed
--     so an auditor can always trace every payment that was ever
--     recorded, even if Brenda later "deleted" it.
--   * Every create / update / delete is also logged into the existing
--     audit_log table by the frontend (logAudit helper).
--
-- Visibility (enforced in the UI, not RLS): owner / operations /
-- admin only. Attila and the field crew never see this tab.

CREATE TABLE IF NOT EXISTS ghost_payments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id  UUID         REFERENCES subcontractors(id) ON DELETE SET NULL,
  job_id            UUID         REFERENCES jobs(id)            ON DELETE SET NULL,
  paid_at           DATE         NOT NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  check_number      TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        TEXT
);

-- Hot path: list payments ordered by paid_at DESC, ignoring soft-
-- deleted rows. Filtered partial index keeps the active set small
-- regardless of how many deletions accumulate over time.
CREATE INDEX IF NOT EXISTS ghost_payments_paid_at_idx
  ON ghost_payments (paid_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ghost_payments_sub_idx
  ON ghost_payments (subcontractor_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ghost_payments_job_idx
  ON ghost_payments (job_id)
  WHERE deleted_at IS NULL;

ALTER TABLE ghost_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ghost_payments anon all" ON ghost_payments;
CREATE POLICY "ghost_payments anon all"
  ON ghost_payments
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
