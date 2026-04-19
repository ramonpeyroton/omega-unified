-- Migration 001: Cost Projection
-- Apply in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jbdtdyxzfejhotbjdnwm/sql/new
--
-- Adds two columns used by:
--   src/shared/components/CostProjectionSection.jsx
-- Without these, clicking "Generate Projection" in the Financials tab errors out.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS cost_projection      JSONB,
  ADD COLUMN IF NOT EXISTS cost_projection_at   TIMESTAMP;

-- Confirmation query (should return 2 rows)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'jobs'
  AND column_name IN ('cost_projection', 'cost_projection_at')
ORDER BY column_name;
