-- Migration 052: estimate display_mode
-- Controls how prices appear on the client-facing estimate page.
--   'breakdown' — client sees every line item with its individual price (default)
--   'single'    — client sees only the grand total; no per-item prices shown
-- Existing estimates without the column get 'breakdown' automatically.

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS display_mode text DEFAULT 'breakdown';

notify pgrst, 'reload schema';
