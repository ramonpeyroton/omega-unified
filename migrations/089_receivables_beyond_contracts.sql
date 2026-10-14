-- Migration 089: money the client owes that doesn't come from a contract.
--
-- Until now Finance only created installments from signed contracts, so
-- three kinds of approved work had nowhere to be marked as received
-- (Ramon, 14/10/26):
--   1. Survey & Building Plans — small, never get a contract. They become
--      their own signable document: a change_orders row with kind = 'plans'
--      (same editor, client page and signature as a change order).
--   2. A small service / upgrade sold on a normal estimate, without a
--      contract (Flax Hill #2124, Anthony Wills #2121): estimates.bill_direct.
--   3. Signed change orders.
-- Each one gets its own installments in payment_milestones, linked by
-- estimate_id or change_order_id instead of contract_id.
--
-- Idempotent. Safe to run before or after the app deploy.

-- ─── change_orders: kind, payment plan, updated_at ───────────────
ALTER TABLE public.change_orders ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'change_order';
ALTER TABLE public.change_orders ADD COLUMN IF NOT EXISTS payment_plan jsonb;
-- The editor and the Void button already write updated_at, but the
-- column never existed — saving or voiding a change order failed.
ALTER TABLE public.change_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- ─── estimates billed without a contract ─────────────────────────
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS bill_direct boolean NOT NULL DEFAULT false;

-- ─── installments linked to an estimate or a change order ────────
ALTER TABLE public.payment_milestones
  ADD COLUMN IF NOT EXISTS estimate_id uuid REFERENCES public.estimates(id) ON DELETE CASCADE;
ALTER TABLE public.payment_milestones
  ADD COLUMN IF NOT EXISTS change_order_id uuid REFERENCES public.change_orders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS payment_milestones_estimate_idx ON public.payment_milestones (estimate_id);
CREATE INDEX IF NOT EXISTS payment_milestones_change_order_idx ON public.payment_milestones (change_order_id);
-- Same guard as contracts (migration 068): one row per installment slot,
-- so two screens materializing at once can't double the plan.
CREATE UNIQUE INDEX IF NOT EXISTS payment_milestones_estimate_slot_uniq
  ON public.payment_milestones (estimate_id, order_idx) WHERE estimate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_milestones_change_order_slot_uniq
  ON public.payment_milestones (change_order_id, order_idx) WHERE change_order_id IS NOT NULL;
