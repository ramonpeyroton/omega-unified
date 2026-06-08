-- 070 — Login history / sessions.
--
-- Records WHO logged in, WHEN, from WHAT device, and WHERE (IP + IP-geo
-- city/region/country). Written server-side by the daily-owner-update
-- function (?task=login), which reads Vercel's request headers
-- (x-forwarded-for + x-vercel-ip-*). The id doubles as a session_id the
-- client keeps to stamp later actions (Stage 2).
--
-- APPEND-ONLY by design: the app (anon key) can SELECT (for the Admin
-- "Login History" screen) but has NO insert/update/delete policy, so a
-- malicious insider can't forge or scrub their own login trail. Only the
-- server (service role) inserts — it bypasses RLS.

create table if not exists public.user_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_name   text,
  user_role   text,
  ip          text,
  city        text,
  region      text,
  country     text,
  user_agent  text,
  device      text,          -- friendly label, e.g. "iPhone · Safari"
  created_at  timestamptz not null default now()
);

create index if not exists idx_user_sessions_created on public.user_sessions (created_at desc);
create index if not exists idx_user_sessions_user    on public.user_sessions (user_name);

alter table public.user_sessions enable row level security;

-- Read-only for the app (Admin screen lists sessions via the anon key).
drop policy if exists "user_sessions select" on public.user_sessions;
create policy "user_sessions select" on public.user_sessions
  for select to anon, authenticated using (true);

-- Intentionally NO insert/update/delete policies for anon/authenticated.
-- Inserts happen server-side with the service role (bypasses RLS); the
-- absence of update/delete policies makes the table append-only.
