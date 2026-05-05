-- Migration 046: backfill chat_members on existing pipeline projects.
--
-- Migration 043 added the trigger that seeds chat_members on INSERT —
-- but the 200+ historical jobs created before 043 still have NULL,
-- so they don't show up in anyone's Daily Logs sidebar.
--
-- This one-shot UPDATE fills chat_members on every job that's
-- currently in the active pipeline (in_pipeline = true) using the
-- same default roster the trigger uses: every active user whose role
-- is in {owner, operations, sales, receptionist, marketing}. Brenda
-- adds Gabriel manually per project once it moves to In Progress —
-- same workflow we agreed on.
--
-- Cold imports (in_pipeline = false, pipeline_status = estimate_rejected)
-- are skipped on purpose. They've already lost the funnel; opening
-- chat access for all of them would just clutter every team member's
-- sidebar with rejected leads.
--
-- Idempotent: WHERE chat_members IS NULL keeps existing values.

UPDATE public.jobs
   SET chat_members = (
         SELECT array_agg(name)
           FROM public.users
          WHERE active = true
            AND role IN ('owner', 'operations', 'sales', 'receptionist', 'marketing')
       )
 WHERE in_pipeline = true
   AND chat_members IS NULL;

-- Flip use_native_chat=true on the same set if they don't already
-- have a Slack channel. Cards with a slack_channel_id stay on Slack
-- until the import script runs (Sprint 6 of the chat replacement).
UPDATE public.jobs
   SET use_native_chat = true
 WHERE in_pipeline = true
   AND use_native_chat = false
   AND (slack_channel_id IS NULL OR slack_channel_id = '');
