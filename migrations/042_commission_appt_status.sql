-- Migration 042: per-commission appointment status, Rafa-editable.
--
-- Mirrors the "appt STATUS" column in Rafaela's old commissions
-- spreadsheet. Five lifecycle values she flips by hand as the
-- appointment progresses:
--   • booked    — visit scheduled
--   • held      — visit happened, payment pending
--   • canceled  — appointment cancelled before it happened
--   • no_show   — client didn't show up
--   • paid      — Rafa was already paid out for the visit
--
-- Independent of the existing `paid` boolean, which is the admin
-- ledger checkbox. `appt_status='paid'` and `paid=true` are
-- expected to converge for cleared rows but Rafa can flip her tag
-- before / without admin involvement.
--
-- Idempotent.

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS appt_status text;

ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_appt_status_check;

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_appt_status_check
  CHECK (appt_status IS NULL OR appt_status IN (
    'booked', 'held', 'canceled', 'no_show', 'paid'
  ));

CREATE INDEX IF NOT EXISTS commissions_appt_status_idx
  ON public.commissions (appt_status)
  WHERE appt_status IS NOT NULL;
