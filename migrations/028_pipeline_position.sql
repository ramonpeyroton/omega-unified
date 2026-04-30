-- Migration 028: per-column ordering for pipeline cards.
--
-- Until now jobs were displayed in each pipeline column ordered by
-- created_at DESC. The seller couldn't shuffle cards vertically inside
-- a column to reflect their own priority — only horizontally between
-- columns. This adds a single nullable position column the kanban
-- writes when the user drops a card.
--
-- We use a FLOAT8 + "midpoint between neighbors" scheme so a single
-- drop only writes ONE row (the moved card) — never the whole column.
-- The float gives us plenty of headroom before precision matters
-- (~50 consecutive midpoint inserts at the same spot before we'd
-- need a re-spacing pass; nobody does that in practice).
--
-- NULLs sort LAST in the kanban query, which means cards created
-- before this migration just appear at the bottom of their column
-- in the original created_at order — no backfill needed.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pipeline_position FLOAT8;

-- Composite index covers the kanban's per-column "ORDER BY position
-- NULLS LAST, created_at DESC" without a sort step.
CREATE INDEX IF NOT EXISTS jobs_pipeline_status_position_idx
  ON jobs (pipeline_status, pipeline_position NULLS LAST, created_at DESC);
