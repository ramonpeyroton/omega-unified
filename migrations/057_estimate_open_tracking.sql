-- Migration 057: track when the client opens an estimate.
--
-- The send-estimate flow now mails a SUMMARY with a "Review Estimate"
-- button. When the client clicks the button and lands on
-- /estimate-view/:id, the frontend fires /api/estimate-opened which
-- stamps the row below. On the first open we also email Omega so the
-- salesperson knows the client engaged with the proposal.
--
-- Idempotent.

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS client_opened_at      timestamptz,
  ADD COLUMN IF NOT EXISTS client_last_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_open_count     int not null default 0;

CREATE INDEX IF NOT EXISTS estimates_client_opened_idx
  ON public.estimates (client_opened_at);
