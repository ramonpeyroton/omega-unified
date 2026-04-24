-- Migration 015: auto-assign estimate_number starting at 2000.
-- Every new row in `estimates` gets a sequential number so the PDF the
-- client receives carries an Omega-style identifier (OM-2001, OM-2002,
-- ...). Existing rows keep whatever number they already have.
--
-- Uses a plain sequence + trigger so the logic lives in Postgres —
-- clients don't need to coordinate numbering in application code.

create sequence if not exists public.estimates_number_seq
  start with 2000
  increment by 1
  minvalue 2000
  no cycle;

-- Fast-forward the sequence past any existing estimate_number so we
-- never collide with a manually-entered higher number.
select setval(
  'public.estimates_number_seq',
  greatest(
    2000 - 1,  -- so the next nextval() returns 2000 at minimum
    coalesce((select max(estimate_number) from public.estimates), 0)
  ),
  true
);

create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
as $fn$
begin
  if new.estimate_number is null then
    new.estimate_number := nextval('public.estimates_number_seq');
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_assign_estimate_number on public.estimates;
create trigger trg_assign_estimate_number
  before insert on public.estimates
  for each row
  execute function public.assign_estimate_number();
