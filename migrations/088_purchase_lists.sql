-- 088 — client purchase lists (Ramon + Attila, 13/10/26)
--
-- When a bathroom / kitchen / renovation contract is signed, the app drafts
-- the list of things the CLIENT has to buy before work starts. Attila reviews
-- it and sends it (SMS from the toll-free number + email). The client opens a
-- public page and marks each item: not purchased / ordered (arrives on…) /
-- at the house. Everyone with the link sees the same list, live.
--
--   purchase_list_templates  the default items per service (editable in the
--                            app by sales / owner / operations)
--   purchase_lists           one per job
--   purchase_list_items      the job's items + their status
--   purchase_list_events     every status change (who, when) — feeds the
--                            3pm team digest on WhatsApp
--
-- RLS: permissive like the rest of the app (PIN login, see CLAUDE.md).

create table if not exists public.purchase_list_templates (
  id          uuid primary key default gen_random_uuid(),
  service     text not null check (service in ('bathroom', 'kitchen')),
  kind        text not null default 'item' check (kind in ('item', 'notice')),
  label       text not null,
  note        text,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.purchase_list_templates enable row level security;
create policy "allow all" on public.purchase_list_templates for all using (true) with check (true);

create table if not exists public.purchase_lists (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'complete')),
  services          text[] not null default '{}',
  notices           text[] not null default '{}',
  sent_at           timestamptz,
  sent_by           text,
  completed_at      timestamptz,
  last_reminder_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists purchase_lists_job_uniq on public.purchase_lists (job_id);
alter table public.purchase_lists enable row level security;
create policy "allow all" on public.purchase_lists for all using (true) with check (true);

create table if not exists public.purchase_list_items (
  id               uuid primary key default gen_random_uuid(),
  list_id          uuid not null references public.purchase_lists(id) on delete cascade,
  label            text not null,
  note             text,
  position         int  not null default 0,
  status           text not null default 'not_purchased'
                     check (status in ('not_purchased', 'ordered', 'at_house')),
  arrives_on       date,
  arrival_unknown  boolean not null default false,
  updated_by       text,
  updated_by_kind  text check (updated_by_kind in ('client', 'team')),
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists purchase_list_items_list_idx on public.purchase_list_items (list_id, position);
alter table public.purchase_list_items enable row level security;
create policy "allow all" on public.purchase_list_items for all using (true) with check (true);

create table if not exists public.purchase_list_events (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.purchase_lists(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete cascade,
  item_id      uuid references public.purchase_list_items(id) on delete set null,
  item_label   text,
  from_status  text,
  to_status    text,
  arrives_on   date,
  by_name      text,
  by_kind      text check (by_kind in ('client', 'team')),
  created_at   timestamptz not null default now()
);
create index if not exists purchase_list_events_created_idx on public.purchase_list_events (created_at);
alter table public.purchase_list_events enable row level security;
create policy "allow all" on public.purchase_list_events for all using (true) with check (true);

-- The client page updates live when someone else marks an item.
alter publication supabase_realtime add table public.purchase_list_items;

-- Attila's default lists (13/10/26). Editable afterwards in the app.
insert into public.purchase_list_templates (service, kind, label, position)
select * from (values
  ('bathroom', 'item', 'Shower fixtures', 1),
  ('bathroom', 'item', 'Shower valves', 2),
  ('bathroom', 'item', 'Sink fixtures', 3),
  ('bathroom', 'item', 'Vanity', 4),
  ('bathroom', 'item', 'Medicine cabinet', 5),
  ('bathroom', 'item', 'Tile', 6),
  ('bathroom', 'item', 'Grout', 7),
  ('bathroom', 'item', 'Niche', 8),
  ('bathroom', 'item', 'Toilet', 9),
  ('bathroom', 'item', 'Bidet', 10),
  ('bathroom', 'item', 'LED vanity mirror', 11),
  ('bathroom', 'item', 'Shower glass / shower glass installation', 12),
  ('bathroom', 'item', 'Bathtub', 13),
  ('bathroom', 'item', 'Free-standing bathtub', 14),
  ('bathroom', 'item', 'Sconces', 15),
  ('bathroom', 'item', 'Light fixtures', 16),
  ('bathroom', 'item', 'Window shades', 17),
  ('kitchen', 'item', 'Tile and grout for backsplash', 1),
  ('kitchen', 'item', 'Pendant lights', 2),
  ('kitchen', 'item', 'Light fixtures', 3),
  ('kitchen', 'item', 'Hardware for cabinets', 4),
  ('kitchen', 'item', 'Window shades', 5),
  ('kitchen', 'notice', 'All appliances are purchased by the client.', 1),
  ('kitchen', 'notice', 'All appliances must be installed by the company the client purchases them from, for liability and insurance reasons.', 2)
) as v(service, kind, label, position)
where not exists (select 1 from public.purchase_list_templates);
