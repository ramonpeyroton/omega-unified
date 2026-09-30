-- Migration 080: add 'material_delivery' and 'cabinet_delivery' to
-- calendar_events.kind.
--
-- Deliveries to the job site get their own kinds (and colors) on the
-- calendar instead of being booked as meetings: Material Delivery (teal)
-- for lumber/tile/fixtures, Cabinet Delivery (wood brown) for the cabinet
-- drops (Fabuwood etc.) the crew has to be on site for.
--
-- Same pattern as 037: drop the CHECK constraint and recreate it with the
-- expanded list. Idempotent.

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
    'cabinet_delivery'
  ));

-- ROLLBACK (move any delivery events to 'meeting' first):
-- UPDATE public.calendar_events SET kind = 'meeting'
--  WHERE kind IN ('material_delivery', 'cabinet_delivery');
-- ALTER TABLE public.calendar_events DROP CONSTRAINT IF EXISTS calendar_events_kind_check;
-- ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_kind_check
--   CHECK (kind IN ('sales_visit','job_start','service_day','inspection','meeting','media_visit'));
