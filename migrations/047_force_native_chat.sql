-- Migration 047: switch every job to the native chat backend.
--
-- Until now, jobs that were created with a slack_channel_id stayed
-- on the Slack render path (use_native_chat = false). Ramon wants
-- to cut over fully — every card from this point on uses the
-- native chat, even if it was originally wired to Slack.
--
-- We deliberately PRESERVE the slack_channel_id values: tomorrow's
-- import script (sprint 6, scripts/import-slack.js) needs them to
-- match Slack channels back to jobs and seed chat_messages with
-- the historical conversation. Once the import succeeds we'll wipe
-- slack_channel_id in a follow-up migration.
--
-- Idempotent — only touches rows that aren't already on native.

UPDATE public.jobs
   SET use_native_chat = true
 WHERE use_native_chat = false;
