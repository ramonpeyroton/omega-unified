-- 075 — Throttle "client opened" notifications to at most once per 30 min
-- per document.
--
-- Standard: every time the client OPENS or SIGNS an estimate, contract or
-- change order, the office (sales + operations + owner) gets ONE in-app
-- notification each + an email. To keep a page refresh from blasting the
-- whole team, "opened" fires at most once per 30 minutes per document —
-- gated by this timestamp. Signing is one-time (no throttle needed).

alter table public.estimates      add column if not exists last_open_notified_at timestamptz;
alter table public.change_orders  add column if not exists last_open_notified_at timestamptz;
alter table public.contracts      add column if not exists last_open_notified_at timestamptz;
