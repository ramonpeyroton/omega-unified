-- Migration 084: version history for estimates.
--
-- Case #2104 (01/10/26): two people had the same estimate open and the
-- last Save silently replaced the other's prices. The builder now refuses
-- to save over a newer version without asking (no migration needed for
-- that), and every save keeps a copy here so any earlier version can be
-- restored from the History button.
--
-- saved_at is `timestamp` (no time zone) on purpose — same type as
-- estimates.updated_at, so the two compare as equal strings in the app.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.estimate_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  saved_at    timestamp NOT NULL DEFAULT now(),
  saved_by    text,
  data        jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS estimate_versions_estimate_idx
  ON public.estimate_versions (estimate_id, saved_at DESC);

-- Same open policy as the rest of the app (PIN login, no Supabase Auth).
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS estimate_versions_all ON public.estimate_versions;
CREATE POLICY estimate_versions_all ON public.estimate_versions
  FOR ALL USING (true) WITH CHECK (true);
