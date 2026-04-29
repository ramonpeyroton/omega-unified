-- Migration 021: cover photo for the Pipeline kanban card.
-- Adds a single optional URL column on jobs that the redesigned
-- PipelineKanban renders as a landscape banner at the top of each card,
-- and that JobFullView's Info tab lets the user upload.
--
-- Storage:
--   * Bucket: `job-covers` (PUBLIC) — must be created manually in
--     Supabase Dashboard → Storage → "New bucket" → name `job-covers`
--     → toggle PUBLIC = ON.
--     Files inside live at:  job-covers/<job_id>/<timestamp>-<filename>
--
-- The frontend (`JobCoverPhotoUpload.jsx`) handles the upload + setting
-- this column. Cards with a null value fall back to a soft illustrated
-- placeholder so the kanban looks complete from day one.

alter table public.jobs
  add column if not exists cover_photo_url text;


-- ─── Storage policies for the `job-covers` bucket ──────────────────
-- Marking the bucket as PUBLIC in the Supabase dashboard only enables
-- reads (the <img src="..."/> tag works without auth). Uploads, updates
-- and deletes still go through Row-Level Security on storage.objects,
-- and a brand-new bucket has no policies — so the first upload attempt
-- fails with: "new row violates row-level security policy".
--
-- These four policies match the rest of the app's permissive RLS model
-- (everything is gated client-side by the PIN-login role, not by
-- Supabase Auth). Run AFTER you create the bucket.
--
-- Idempotent: drops first so re-running the file is safe.

drop policy if exists "job_covers_anon_select" on storage.objects;
create policy "job_covers_anon_select" on storage.objects
  for select using (bucket_id = 'job-covers');

drop policy if exists "job_covers_anon_insert" on storage.objects;
create policy "job_covers_anon_insert" on storage.objects
  for insert with check (bucket_id = 'job-covers');

drop policy if exists "job_covers_anon_update" on storage.objects;
create policy "job_covers_anon_update" on storage.objects
  for update using (bucket_id = 'job-covers');

drop policy if exists "job_covers_anon_delete" on storage.objects;
create policy "job_covers_anon_delete" on storage.objects
  for delete using (bucket_id = 'job-covers');


-- ─── Reload PostgREST schema cache ─────────────────────────────────
-- Without this, the API can keep returning "Could not find the
-- 'cover_photo_url' column of 'jobs' in the schema cache" for a few
-- minutes after the ALTER TABLE — even though the column exists.
-- This NOTIFY tells PostgREST to refresh immediately.
notify pgrst, 'reload schema';
