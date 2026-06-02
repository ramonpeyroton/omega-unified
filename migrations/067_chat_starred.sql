-- Migration 067: per-user starred chats.
--
-- Adds a boolean to the chat_reads pivot so each user can pin a
-- favourite set of chats to the top of the Daily Logs screen (the
-- new full-screen surface that replaces the sidebar cascade).
--
-- Idempotent.

ALTER TABLE public.chat_reads
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS chat_reads_starred_idx
  ON public.chat_reads (user_name)
  WHERE is_starred = true;
