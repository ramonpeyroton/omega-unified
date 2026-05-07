-- Migration 055: convert audit_log.timestamp to timestamptz.
--
-- The Admin → Audit Logs screen was rendering each event 4 hours ahead
-- of local time for users in Connecticut (EDT, UTC-4). Root cause: the
-- `timestamp` column was defined as `timestamp without time zone`, so
-- Supabase returned ISO strings without a `Z` suffix. JavaScript's
-- `new Date(...)` then treated the value as LOCAL time instead of UTC,
-- skipping the timezone conversion entirely. Result: an action at 5pm
-- EDT showed up as 9pm.
--
-- Fix: switch the column to `timestamptz`. Existing rows were inserted
-- via Postgres `default now()` running on Supabase (UTC), so their
-- literal values *already* represent UTC instants — we just need to
-- tell Postgres that explicitly during the cast (the `AT TIME ZONE
-- 'UTC'` clause). Without it, Postgres would assume the session
-- timezone, which is not guaranteed to be UTC.
--
-- After this runs, the frontend keeps using `new Date(ts).toLocaleString()`
-- and gets the right local time on every machine, because the API now
-- returns the value with an offset / `Z` suffix.
--
-- Idempotent: rerun is safe because the second run sees the column is
-- already `timestamptz` and the `USING` clause is a no-op cast.

DO $$
BEGIN
  -- Only convert if the column is still `timestamp without time zone`.
  -- This guards against a re-run after the migration has already been
  -- applied (Postgres would otherwise raise on the AT TIME ZONE cast).
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'audit_log'
       AND column_name  = 'timestamp'
       AND data_type    = 'timestamp without time zone'
  ) THEN
    ALTER TABLE public.audit_log
      ALTER COLUMN "timestamp" TYPE timestamptz
      USING "timestamp" AT TIME ZONE 'UTC';
  END IF;
END $$;

-- Re-affirm the default. `now()` on a timestamptz column returns
-- `timestamptz` with the session's TZ baked in (Supabase runs in UTC).
ALTER TABLE public.audit_log
  ALTER COLUMN "timestamp" SET DEFAULT now();
