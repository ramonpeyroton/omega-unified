-- Migration 043: native per-project chat (Sprint 1 of replacing Slack).
--
-- Story: Ramon is canceling the Slack subscription at the end of the
-- month. Existing projects that already have a slack_channel_id stay
-- on Slack until the import script runs (Sprint 6); every NEW project
-- created from this migration onward defaults to the native chat.
--
-- Tables:
--   chat_messages   — single source of truth for messages.
--                     attachments JSONB so we can stuff
--                     [{url, mime, size, slack_file_id?}] in there
--                     without joining a side table for every render.
--   chat_reads      — per-user last-read timestamp per job. Drives
--                     the bold/badge state in the sidebar cascade.
--
-- jobs gains:
--   chat_members    text[]  — ACL. Only users named here see this
--                              project's chat in their sidebar.
--   use_native_chat boolean — switch between native and Slack render.
--                              Trigger sets it to TRUE for new rows.
--
-- A BEFORE INSERT trigger seeds chat_members with every active user
-- whose role is in {owner, operations, sales, receptionist, marketing}
-- — i.e. everyone except Gabriel (manager) and admin / screen. Brenda
-- expands the list manually as projects move to In Progress (Sprint 4).
--
-- Backfill rule: existing jobs without a Slack channel get
-- use_native_chat=true so cold imports / future-promoted leads land
-- straight on the native chat. Jobs WITH a slack_channel_id keep
-- use_native_chat=false until the migration script flips them.
--
-- Realtime: chat_messages is added to the supabase_realtime
-- publication so the frontend can subscribe to INSERTs and update
-- the UI without polling.
--
-- Idempotent.

-- ─── chat_messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  author_name       text,
  author_role       text,
  body              text,
  attachments       jsonb,
  mentions          text[],
  slack_message_ts  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS chat_messages_job_idx
  ON public.chat_messages (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_slack_ts_idx
  ON public.chat_messages (slack_message_ts)
  WHERE slack_message_ts IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_mentions_idx
  ON public.chat_messages USING GIN (mentions)
  WHERE mentions IS NOT NULL;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_messages_anon_all ON public.chat_messages;
CREATE POLICY chat_messages_anon_all
  ON public.chat_messages
  FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

-- Add to realtime publication so the frontend can subscribe.
-- Wrapped in DO block because ALTER PUBLICATION isn't idempotent
-- and a re-run would error on "relation already member".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

-- ─── chat_reads ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_reads (
  job_id        uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_name     text        NOT NULL,
  last_read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_name)
);

CREATE INDEX IF NOT EXISTS chat_reads_user_idx
  ON public.chat_reads (user_name);

ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_reads_anon_all ON public.chat_reads;
CREATE POLICY chat_reads_anon_all
  ON public.chat_reads
  FOR ALL
  TO anon, authenticated
  USING (true) WITH CHECK (true);

-- ─── jobs.chat_members + use_native_chat ──────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS chat_members text[];

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS use_native_chat boolean NOT NULL DEFAULT false;

-- Backfill: jobs without a Slack channel land on native chat. Jobs
-- linked to Slack stay there until the import script runs (Sprint 6).
UPDATE public.jobs
   SET use_native_chat = true
 WHERE use_native_chat = false
   AND (slack_channel_id IS NULL OR slack_channel_id = '');

CREATE INDEX IF NOT EXISTS jobs_chat_members_idx
  ON public.jobs USING GIN (chat_members);

-- ─── Default chat_members + use_native_chat on INSERT ─────────────
-- Fires only when chat_members is NULL so manual inserts that opt in
-- to a custom roster (e.g. the Slack import script seeding history)
-- aren't overridden.

CREATE OR REPLACE FUNCTION public.jobs_set_default_chat_members()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.chat_members IS NULL THEN
    SELECT array_agg(name) INTO NEW.chat_members
      FROM public.users
     WHERE active = true
       AND role IN ('owner', 'operations', 'sales', 'receptionist', 'marketing');
  END IF;
  -- New rows that don't explicitly opt out land on the native chat.
  IF NEW.use_native_chat IS NULL THEN
    NEW.use_native_chat := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_set_default_chat_members_trg ON public.jobs;
CREATE TRIGGER jobs_set_default_chat_members_trg
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_set_default_chat_members();
