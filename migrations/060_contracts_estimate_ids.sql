-- Migration 060: track which estimates a contract was built from.
--
-- The new EstimateFlow picker (replacing the manual Payment Plan
-- editor) lets Attila select one or more approved estimates to feed
-- the contract. We store those ids as a jsonb array so:
--   * We can re-derive the merged Schedule A / total / plan at any
--     time without guessing what was picked.
--   * The "Re-pick estimates" button knows which were originally
--     selected and can pre-check those checkboxes.
--   * Legacy contracts (no estimate_ids set) keep their old behavior
--     untouched — backward compatible by design.
--
-- Idempotent.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS estimate_ids jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS contracts_estimate_ids_idx
  ON public.contracts USING gin (estimate_ids);
