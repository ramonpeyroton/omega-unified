-- Migration 066: replace jobs.slack_last_message_at with the native
-- equivalent (jobs.last_chat_message_at) maintained by a trigger on
-- chat_messages. Drives the "unread dot" in the Pipeline kanban.
--
-- The previous column was kept current by the Slack webhook flow.
-- Now that the Slack integration has been removed, we need a trigger
-- on the native chat_messages table to do the same thing.
--
-- Idempotent.

-- ─── jobs.last_chat_message_at ────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS last_chat_message_at timestamptz;

-- ─── Trigger: bump jobs.last_chat_message_at on every chat insert ─
CREATE OR REPLACE FUNCTION public.chat_messages_bump_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.jobs
     SET last_chat_message_at = NEW.created_at
   WHERE id = NEW.job_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_bump_last_message_at_trg ON public.chat_messages;
CREATE TRIGGER chat_messages_bump_last_message_at_trg
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_messages_bump_last_message_at();

-- ─── Backfill from existing chat history ─────────────────────────
-- One-shot fill so jobs that already have native chat messages
-- show their "unread dot" correctly right after this migration.
UPDATE public.jobs j
   SET last_chat_message_at = sub.last_at
  FROM (
    SELECT job_id, MAX(created_at) AS last_at
      FROM public.chat_messages
     GROUP BY job_id
  ) sub
 WHERE sub.job_id = j.id
   AND (j.last_chat_message_at IS NULL OR j.last_chat_message_at < sub.last_at);

-- ─── (Optional) drop the now-defunct Slack column ────────────────
-- Slack integration is fully removed; this column was only updated by
-- the Slack webhook flow. Safe to drop. Wrapped in DO block so the
-- migration is idempotent if the column has already been dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'jobs'
       AND column_name  = 'slack_last_message_at'
  ) THEN
    ALTER TABLE public.jobs DROP COLUMN slack_last_message_at;
  END IF;
END $$;
