-- Migration 037: add 'media_visit' to calendar_events.kind.
--
-- Marketing (Ramon) books photo/video runs to the field — the calendar
-- needs a dedicated kind so the crew (and sales) can see media is
-- coming. Pink color in the UI keeps it distinct from sales_visit
-- (orange) and the rest of the kinds.
--
-- The original CHECK constraint from migration 008 was inline with
-- the table create, which means it has the auto-generated name
-- `calendar_events_kind_check`. We drop and recreate it with the
-- expanded list. Idempotent — DROP IF EXISTS handles a fresh DB
-- where the old constraint doesn't exist yet.

ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_kind_check;

ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_kind_check
  CHECK (kind IN (
    'sales_visit',
    'job_start',
    'service_day',
    'inspection',
    'meeting',
    'media_visit'
  ));
