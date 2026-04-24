-- Migration 017: multi-option estimates (send 3 alternatives in one link)
--
-- Adds a grouping layer on top of the existing `estimates` table so
-- Attila can send a single email with N alternatives the customer can
-- compare side-by-side and sign in one go.
--
-- Schema:
--   group_id      — every estimate belongs to a group. Lone estimates
--                   (the default, single-option case) have group_id = id
--                   (self-reference). Alternatives share the same uuid.
--   option_label  — human-readable label the customer sees on each card
--                   ("Basic", "Standard", "Premium", "With Hardwood"…).
--                   Defaults to "Option 1" / "Option 2" etc. on create.
--   option_order  — ordinal (0-based) controlling left-to-right layout
--                   on the multi-option view.
--
-- The client-facing page:
--   /estimate-view/:id           → single estimate (unchanged)
--   /estimate-options/:group_id  → side-by-side picker + single signature
-- The API decides which link to email based on whether the group has
-- more than one row.
--
-- Backfill: every existing row becomes its own group (group_id = id,
-- option_order = 0) so nothing about the current UX changes until
-- someone explicitly clicks "+ Add Alternative".

alter table public.estimates
  add column if not exists group_id     uuid,
  add column if not exists option_label text,
  add column if not exists option_order integer not null default 0;

-- Self-reference any row that doesn't yet belong to a group.
update public.estimates
   set group_id = id
 where group_id is null;

-- From now on, new inserts default to "self-group" too. The client code
-- overrides this when duplicating an alternative.
alter table public.estimates
  alter column group_id set default null;

-- Lookup index — /estimate-options/:group_id does a hot read here.
create index if not exists estimates_group_id_idx
  on public.estimates (group_id);
