-- Migration 092: Follow Up events on the calendar (Attila, 2026-10-29).
--
-- A follow-up is a calendar_events row with kind = 'follow_up', always tied
-- to a client (job_id). The client is never notified; the salespeople get a
-- WhatsApp + bell reminder the business day before and on the day
-- (api/_lib/teamAlerts.js). The Follow Up screen (sales + owner) lists them:
-- red = past and not done, yellow = this week, green = later.
--
-- "Done" reuses visit_status = 'completed' and adds who/when/what happened.
-- Same pattern as 080 for the kind CHECK. Idempotent.

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
    'media_visit',
    'material_delivery',
    'cabinet_delivery',
    'follow_up'
  ));

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS done_at   timestamptz,
  ADD COLUMN IF NOT EXISTS done_by   text,
  ADD COLUMN IF NOT EXISTS done_note text;

CREATE INDEX IF NOT EXISTS calendar_events_follow_up_idx
  ON public.calendar_events (starts_at)
  WHERE kind = 'follow_up';

-- ROLLBACK (delete or re-kind follow-ups first):
-- DELETE FROM public.calendar_events WHERE kind = 'follow_up';
-- DROP INDEX IF EXISTS public.calendar_events_follow_up_idx;
-- ALTER TABLE public.calendar_events DROP COLUMN IF EXISTS done_at,
--   DROP COLUMN IF EXISTS done_by, DROP COLUMN IF EXISTS done_note;
-- ALTER TABLE public.calendar_events DROP CONSTRAINT IF EXISTS calendar_events_kind_check;
-- ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_kind_check
--   CHECK (kind IN ('sales_visit','job_start','service_day','inspection','meeting',
--                   'media_visit','material_delivery','cabinet_delivery'));
