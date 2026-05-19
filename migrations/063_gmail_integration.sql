-- Migration 063: Gmail integration tables
-- Stores OAuth tokens for monitored Gmail accounts and logs every
-- processed email (matched → auto-uploaded; pending_review → awaits
-- manual confirmation by Brenda in the Invoice Inbox screen).

-- ── OAuth tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email            text        NOT NULL UNIQUE,
  access_token     text        NOT NULL,
  refresh_token    text        NOT NULL,
  expires_at       timestamptz NOT NULL,
  -- Last Gmail historyId we successfully processed.
  -- Used as the starting point on next push notification.
  watch_history_id text,
  -- When the Gmail push watch expires (renew before this).
  watch_expiration timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE gmail_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_gmail_tokens"
  ON gmail_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Email processing log ──────────────────────────────────────────
-- One row per email that had a PDF / image attachment.
CREATE TABLE IF NOT EXISTS email_processing_log (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  gmail_message_id  text        NOT NULL UNIQUE,
  from_address      text,
  subject           text,
  -- Matched job (may be null for pending / unmatched rows)
  job_id            uuid        REFERENCES jobs(id) ON DELETE SET NULL,
  confidence        float,
  -- matched       → auto-uploaded to job_documents
  -- pending_review → low-confidence, awaiting Brenda's confirmation
  -- unmatched      → Claude couldn't find a job (no attachments acted on)
  -- error          → processing failed
  status            text        NOT NULL DEFAULT 'unmatched'
                    CHECK (status IN ('matched','pending_review','unmatched','error')),
  -- References job_documents(id) once uploaded
  doc_id            uuid,
  -- Claude-extracted invoice data
  invoice_info      jsonb,
  -- Short email excerpt shown in the review UI
  raw_snippet       text,
  attachment_name   text,
  -- Path in Supabase Storage (even before job match, so we never lose the file)
  storage_path      text,
  processed_at      timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  error_message     text
);

ALTER TABLE email_processing_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_email_log"
  ON email_processing_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── updated_at triggers ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_gmail_tokens_updated_at
  BEFORE UPDATE ON gmail_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_email_log_updated_at
  BEFORE UPDATE ON email_processing_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
