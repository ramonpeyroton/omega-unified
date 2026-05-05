-- Migration 048: monthly marketing spend by channel.
--
-- Stores how much Omega invested in each lead source per month so
-- the Owner Dashboard can compute Cost per Lead = spend / leads.
--
-- One row per (channel, period_start). period_start is the first
-- day of the calendar month — keeps lookups simple and unambiguous
-- (no off-by-one timezone surprises).
--
-- channel values match the catalog used by NewLead's Lead Source
-- dropdown (Google, Houzz, HomeAdvisor, Angi, Mr.NailEdit, etc).
-- Stored free-text so the catalog can grow without a migration.

CREATE TABLE IF NOT EXISTS public.marketing_spend (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text        NOT NULL,
  period_start date        NOT NULL,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, period_start)
);

CREATE INDEX IF NOT EXISTS marketing_spend_period_idx
  ON public.marketing_spend (period_start DESC);

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
