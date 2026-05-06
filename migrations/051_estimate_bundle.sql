-- Migration 051: estimate bundles — multiple services sent together,
-- each requiring independent approval.
--
-- Different from multi-option (group_id): in a multi-option group the
-- customer picks ONE alternative and the others are auto-rejected.
-- In a bundle, every estimate must be approved individually — e.g.
-- a Kitchen estimate + Bathroom estimate sent in one email, both
-- needing the client's signature.
--
-- bundle_id  — UUID shared by all estimates in the same bundle.
--              NULL when the estimate is standalone or multi-option only.
-- bundle_label — human label for this estimate within the bundle,
--               e.g. "Kitchen Remodel", "Bathroom Renovation".
--               Shown to the client on the bundle page.

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS bundle_id    uuid;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS bundle_label text;

CREATE INDEX IF NOT EXISTS estimates_bundle_idx ON estimates (bundle_id);

notify pgrst, 'reload schema';
