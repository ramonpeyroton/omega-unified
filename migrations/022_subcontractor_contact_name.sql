-- Migration 022: split "name" into "company name" + "contact name" on
-- subcontractors. The day-to-day workflow at Omega uses the contact's
-- personal name (the actual person they call), not the registered LLC,
-- so the redesigned card and add/edit form treat the contact as the
-- primary identifier and the company as a secondary line.
--
-- Backwards compatible:
--   * `name` keeps its current meaning ("whatever was typed in the
--     existing single field" — sometimes a person, sometimes an LLC).
--   * `contact_name` is a new optional column. NULL on every existing
--     row; the UI handles that case by falling back to `name` only.
--   * No data is auto-migrated — there's no reliable way to tell if
--     "Pedro Silva" was a person or a company. Operations updates the
--     records as they edit them.

alter table public.subcontractors
  add column if not exists contact_name text;

-- Force PostgREST to refresh its schema cache so the API knows about
-- the new column without a service restart.
notify pgrst, 'reload schema';
