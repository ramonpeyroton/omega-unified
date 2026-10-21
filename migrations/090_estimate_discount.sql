-- Migration 090: discount on an estimate (Ramon, 20/10/26).
--
-- One discount on the estimate total — a % or a fixed $ — with an optional
-- name the client sees ("Fall promotion"). total_amount keeps meaning "what
-- the client pays", i.e. AFTER the discount, so contract, payment plan,
-- invoices and Finance need no change. The client pages and the contract
-- show Subtotal / discount / Total (src/shared/lib/estimatePricing.js).
--
-- Idempotent.

ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS discount_type text;     -- 'percent' | 'amount' | null
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS discount_value numeric;  -- 5 (= 5%) or 2000 (= $2,000)
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS discount_label text;     -- shown to the client
