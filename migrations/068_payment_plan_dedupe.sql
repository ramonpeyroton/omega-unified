-- Migration 068 — stop payment plans from materializing twice
--
-- Symptom (reported 2026-06): a signed $45,000 contract showed 8 installments
-- summing to $90,000 — each milestone (Deposit / Upon start / After painting /
-- Upon completion) duplicated, so both the count (4→8) and the total (2×) were
-- wrong.
--
-- Root cause: ensureMilestonesForContract() / ensureSubPaymentsForAgreement()
-- in src/shared/lib/finance.js used a non-atomic check-then-insert ("if no rows
-- exist, insert the plan"). When the DocuSign webhook (on signing) and the
-- Finance / EstimateFlow loader both ran inside the same brief window, BOTH
-- passed the existence check and BOTH inserted order_idx 0..3 — yielding two
-- interleaved sets once ordered by order_idx.
--
-- Fix: (1) collapse the existing duplicates, keeping the row that already has
-- money recorded against it (never drop a payment), and (2) add a unique index
-- so the database itself rejects the second insert. The app code now treats the
-- resulting unique-violation (23505) as "already materialized" — a clean no-op.

BEGIN;

-- 1. payment_milestones — keep one row per (contract_id, order_idx).
--    Priority: most received first, then lowest id.
DELETE FROM payment_milestones pm
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY contract_id, order_idx
           ORDER BY COALESCE(received_amount, 0) DESC, id ASC
         ) AS rn
  FROM payment_milestones
) d
WHERE pm.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payment_milestones_contract_order_uniq
  ON payment_milestones (contract_id, order_idx);

-- 2. sub_payments — same fix on the subcontractor side.
--    Priority: most paid first, then lowest id.
DELETE FROM sub_payments sp
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY agreement_id, order_idx
           ORDER BY COALESCE(paid_amount, 0) DESC, id ASC
         ) AS rn
  FROM sub_payments
) d
WHERE sp.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sub_payments_agreement_order_uniq
  ON sub_payments (agreement_id, order_idx);

COMMIT;
