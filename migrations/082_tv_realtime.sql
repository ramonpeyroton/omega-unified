-- Migration 082: stream the tables the office TV slideshow reads.
--
-- The TV (src/apps/marketing/screens/PipelineTV.jsx) refreshes every
-- minute anyway, but realtime makes it update within ~2 s and powers the
-- live toasts ("Payment received", "Bill paid"). `jobs` and `contracts`
-- were added in earlier migrations; this adds the rest. Idempotent — each
-- table is only added if it isn't in the publication yet.

do $$
declare
  t text;
begin
  foreach t in array array[
    'bills', 'payment_milestones', 'sub_payments', 'job_expenses',
    'subcontractor_agreements', 'calendar_events', 'estimates'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ROLLBACK (per table):
-- alter publication supabase_realtime drop table public.bills;
