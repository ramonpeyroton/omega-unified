-- Migration 041: keep calendar_events in sync when the linked job's
-- client_name or address changes.
--
-- The story: Rafa created a lead, scheduled a visit, then noticed
-- the client name was misspelled. She fixed it in My Leads — that
-- updated jobs.client_name — but the calendar still showed the old
-- spelling, because the EventForm had snapshotted the title and
-- location into calendar_events at create time.
--
-- Two simple rules, both opt-in by exact match so user-customized
-- titles / locations are never silently overwritten:
--
--   1. TITLE: if the event title CONTAINS the old client_name, do
--      a string replace to the new client_name. Auto-generated
--      titles always include the client name; custom titles
--      typically don't, so the heuristic is safe in both directions.
--
--   2. LOCATION: if the event location is EXACTLY the old address,
--      replace with the new address. If the user typed something
--      different (e.g. "back parking lot"), leave it alone.
--
-- Both predicates also short-circuit when the field is unchanged.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.jobs_propagate_to_calendar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- ─── Client name → event title ──────────────────────────────
  IF NEW.client_name IS DISTINCT FROM OLD.client_name
     AND OLD.client_name IS NOT NULL
     AND length(OLD.client_name) > 0 THEN
    UPDATE public.calendar_events
       SET title = replace(title, OLD.client_name, COALESCE(NEW.client_name, '')),
           updated_at = now()
     WHERE job_id = NEW.id
       AND title IS NOT NULL
       AND position(OLD.client_name IN title) > 0;
  END IF;

  -- ─── Address → event location ───────────────────────────────
  IF NEW.address IS DISTINCT FROM OLD.address
     AND OLD.address IS NOT NULL THEN
    UPDATE public.calendar_events
       SET location = NEW.address,
           updated_at = now()
     WHERE job_id = NEW.id
       AND location = OLD.address;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_propagate_to_calendar_trg ON public.jobs;
CREATE TRIGGER jobs_propagate_to_calendar_trg
  AFTER UPDATE OF client_name, address ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_propagate_to_calendar();
