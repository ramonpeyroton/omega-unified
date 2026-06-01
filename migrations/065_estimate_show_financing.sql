-- Migration 065: add `show_financing` flag to estimates.
--
-- When true (the default), the customer-facing EstimateView shows a
-- discreet "Need Flexible Payments?" card linking to the contractor's
-- Acorn Finance pre-qualification page, with the estimate total
-- pre-filled. Brenda/Attila can toggle it OFF per estimate in the
-- EstimateBuilder when the offering doesn't make sense for that job
-- (commercial work, client paying cash, sub-only scope, etc.).
--
-- Defaulting to TRUE so every existing estimate immediately starts
-- offering financing without anyone having to opt in. Idempotent.

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS show_financing boolean NOT NULL DEFAULT true;

-- Force PostgREST schema reload so the client can read the new column
-- immediately (no waiting for the periodic refresh).
NOTIFY pgrst, 'reload schema';
