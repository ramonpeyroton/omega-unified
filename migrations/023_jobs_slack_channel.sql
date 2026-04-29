-- Migration 023: link a Slack channel to each job.
--
-- Powers the redesigned "Daily Logs" tab inside JobFullView. Sprint 2
-- of the Slack chat feature ships the backend (api/slack/get-messages
-- and api/slack/send-message); Sprint 3 swaps the existing daily_logs
-- table render for a Slack-driven chat. The legacy daily_logs table
-- (migration 007) is intentionally NOT dropped — historical entries
-- stay readable / migrate-able.
--
-- Channel IDs in Slack look like `C0123ABCDEF` (uppercase Cxxxxxxxxx).
-- They're stable: renaming a channel doesn't change its ID. So we
-- store the ID, not the name.
--
-- Existing jobs get NULL. The frontend renders a "Channel not
-- connected yet" empty state for those. Connecting a channel to a job
-- is a Sprint 3/4 UX (likely a small picker in JobFullView).

alter table public.jobs
  add column if not exists slack_channel_id text;

-- Force PostgREST to refresh its schema cache so the API knows about
-- the new column without a service restart.
notify pgrst, 'reload schema';
