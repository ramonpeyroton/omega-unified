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

-- That's it. No constraint, no default — null means "no photo yet".
