-- Migration 044: backfill bulk-imported leads to estimate_rejected.
--
-- The CSV import landed all 200+ historical leads in pipeline_status =
-- 'new_lead', which then polluted Attila's kanban (and the New Lead
-- column specifically). They're cold by nature — old leads kept warm
-- by Rafa's follow-ups but already past the active funnel — so the
-- correct resting state is 'estimate_rejected'.
--
-- The auto-eject trigger from migration 038 fires on this UPDATE and
-- flips in_pipeline=false for every row, so they leave the kanban
-- entirely. The kanban's Estimate Rejected column displays only the
-- 10 most recent rejected jobs (frontend rule), so the bulk doesn't
-- pile up visually. Older ones live in My Leads.
--
-- Idempotent: filters by created_by='import' AND current status =
-- 'new_lead' so re-running doesn't bulldoze leads that have already
-- been categorized manually.

UPDATE public.jobs
   SET pipeline_status = 'estimate_rejected'
 WHERE created_by = 'import'
   AND pipeline_status = 'new_lead';
