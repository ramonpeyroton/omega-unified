-- 069_push_subscriptions.sql
-- Web Push (PWA) — stores one row per subscribed device/browser, and adds a
-- dedupe flag to calendar_events for the "2 hours before" reminder.
--
-- Auth model matches the rest of the app: no Supabase Auth, permissive RLS so
-- the PIN-logged client can insert/read/delete its own subscriptions with the
-- anon key. Sending pushes is server-side (service role) and bypasses RLS.

create table if not exists public.user_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  user_name   text,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subs_user_name on public.user_push_subscriptions (user_name);
create index if not exists idx_push_subs_user_id   on public.user_push_subscriptions (user_id);

alter table public.user_push_subscriptions enable row level security;

-- Permissive policies (same posture as the rest of the app until Supabase Auth
-- is turned on). Drop-if-exists keeps the migration re-runnable.
drop policy if exists push_subs_all on public.user_push_subscriptions;
create policy push_subs_all on public.user_push_subscriptions
  for all using (true) with check (true);

-- Dedupe flag for the 2h-before reminder cron.
alter table public.calendar_events
  add column if not exists reminder_sent_at timestamptz;
