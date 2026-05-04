-- Migration 038: in_pipeline flag — separates "is this lead visible
-- in Attila's kanban?" from pipeline_status (where it sits in the
-- funnel).
--
-- Why a separate flag instead of repurposing pipeline_status:
--   • The kanban needs to STAY visually clean. Importing 200 cold
--     leads as 'new_lead' would bury the real new leads. Importing
--     them as 'estimate_rejected' would lie about what happened.
--   • Rafaela tags the lead's life-cycle in `lead_status` — that's
--     her thing, also independent.
--   • `in_pipeline` is the single dimension the kanban filters on.
--
-- Default true so EXISTING rows keep showing up in the kanban
-- (current behavior preserved). Cold-import scripts will set this
-- to false explicitly.
--
-- Trigger: when pipeline_status flips to 'estimate_rejected', the
-- lead auto-leaves the kanban. To revive it Rafaela toggles it back
-- on from My Leads (which also resets pipeline_status to 'new_lead'
-- via app code so it lands in Attila's New Lead column).
--
-- Idempotent.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS in_pipeline boolean NOT NULL DEFAULT true;

-- Helps the kanban .eq('in_pipeline', true) query stay fast as the
-- cold-leads pile grows.
CREATE INDEX IF NOT EXISTS jobs_in_pipeline_idx
  ON public.jobs (in_pipeline)
  WHERE in_pipeline = true;

-- ─── Auto-eject on estimate_rejected ─────────────────────────────
-- Trigger fires only when pipeline_status actually changes to
-- 'estimate_rejected'. Other transitions are untouched (so an
-- 'in_progress' job that you manually pulled from the pipeline
-- doesn't get yanked back in by some unrelated update).

CREATE OR REPLACE FUNCTION public.jobs_auto_eject_on_rejected()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'UPDATE'
      AND NEW.pipeline_status = 'estimate_rejected'
      AND COALESCE(OLD.pipeline_status, '') <> 'estimate_rejected') THEN
    NEW.in_pipeline := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_auto_eject_on_rejected_trg ON public.jobs;
CREATE TRIGGER jobs_auto_eject_on_rejected_trg
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_auto_eject_on_rejected();
