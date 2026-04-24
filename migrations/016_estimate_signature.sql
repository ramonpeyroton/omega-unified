-- Migration 016: estimate signatures (customer e-sign for estimates)
--
-- Replaces the previous "reply yes" back-and-forth with an in-browser
-- canvas signature + printed name + ESIGN consent. The *final* binding
-- contract still goes through DocuSign — this just gates the estimate
-- approval step so Brenda knows to prepare the contract.
--
-- Columns added to public.estimates:
--   signature_png      — data: URL of the canvas (PNG base64)
--   signed_by          — name the customer typed
--   signed_at          — server-side timestamp when /api/sign-estimate saved it
--   signed_ip          — IP captured from x-forwarded-for / x-real-ip
--   signed_user_agent  — browser UA string (audit trail)
--
-- Existing rows keep all nulls; new signatures populate all 5 fields
-- atomically. Once signed, the row is treated as locked in the API —
-- re-signing requires creating a new estimate.

alter table public.estimates
  add column if not exists signature_png      text,
  add column if not exists signed_by          text,
  add column if not exists signed_at          timestamptz,
  add column if not exists signed_ip          text,
  add column if not exists signed_user_agent  text;

-- Helpful index for the audit / reporting screens.
create index if not exists estimates_signed_at_idx
  on public.estimates (signed_at)
  where signed_at is not null;
