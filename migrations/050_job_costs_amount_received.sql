-- Migration 050: add amount_received to job_costs
-- Tracks how much the client has already paid on a job.
-- Used by Brenda (operations) to log payments; visible to Inácio on the dashboard.

ALTER TABLE job_costs
  ADD COLUMN IF NOT EXISTS amount_received numeric(12,2) NOT NULL DEFAULT 0;
