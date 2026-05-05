-- Migration 049: simplify marketing_spend to a monthly-recurring model.
--
-- Migration 048 modeled spend as one row per (channel, period_start)
-- so each month had its own number. Ramon confirmed his investment
-- is linear — the same amount per channel every month — so we drop
-- the per-month dimension and store one row per channel with the
-- recurring monthly_amount.
--
-- The Owner Dashboard's CPL calculation now reads this single row
-- per channel and applies it to every month's leads count.
-- Overrides (a one-off heavy-spend month) can come back later as a
-- separate feature without changing this base table.
--
-- Idempotent: drops the previous table if it exists (it had no
-- production data yet — Ramon mentioned he was about to fill it in
-- when we changed approach).

DROP TABLE IF EXISTS public.marketing_spend;

CREATE TABLE public.marketing_spend (
  channel        text          PRIMARY KEY,
  monthly_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_spend_anon_all ON public.marketing_spend;
CREATE POLICY marketing_spend_anon_all
  ON public.marketing_spend
  FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.marketing_spend_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketing_spend_touch_updated_at_trg ON public.marketing_spend;
CREATE TRIGGER marketing_spend_touch_updated_at_trg
  BEFORE UPDATE ON public.marketing_spend
  FOR EACH ROW
  EXECUTE FUNCTION public.marketing_spend_touch_updated_at();
