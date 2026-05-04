-- Migration 036: support multi-assignee calendar events.
--
-- A sales visit (or any other event) can now be booked for two or
-- more people at once — e.g. Inácio + Ramon doing a courtesy visit
-- together, or Attila + Gabriel walking a job before kickoff. We
-- keep the existing `assigned_to_name` (text) column for backward
-- compat: it stays as the PRIMARY assignee (first name in the list)
-- so old read paths (Sales Home filter, jarvisTools, audit_log) keep
-- working without any code change. The new `assigned_to_names`
-- array carries the full roster.
--
-- Display & conflict logic in the app reads from the array when
-- present and falls back to the scalar column for events written
-- before this migration shipped.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS assigned_to_names text[];

-- GIN index so per-person filters (`assigned_to_names @> ARRAY[name]`)
-- stay fast as the calendar grows.
CREATE INDEX IF NOT EXISTS calendar_events_assigned_names_idx
  ON public.calendar_events
  USING GIN (assigned_to_names);
