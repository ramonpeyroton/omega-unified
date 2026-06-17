-- Migration 072: job_reviews — client testimonials / reviews hub.
--
-- Marketing (Ramon) collects client testimonials here and marks the
-- approved ones, turning them into ready-to-post case studies. A review
-- can be tied to a job (optional) so it inherits the service + town,
-- or stand alone (e.g. a Google review pasted in by hand).
--
-- rating is 1–5 stars. `approved` gates whether a testimonial is
-- considered ready to show publicly. Free-text `source` matches the
-- lead-source catalog vibe (Google, Houzz, Referral, Manual…).

create table if not exists public.job_reviews (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references public.jobs(id) on delete set null,
  client_name  text,
  rating       int  not null default 5 check (rating between 1 and 5),
  testimonial  text not null,
  source       text default 'Manual',
  service      text,
  city         text,
  approved     boolean not null default false,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists job_reviews_created_idx on public.job_reviews (created_at desc);

alter table public.job_reviews enable row level security;

create policy "allow all" on public.job_reviews
  for all using (true) with check (true);
