-- Plans view "Pick a scale" dropdown: a scale the estimator picked from the
-- standard architectural / engineering list is saved with scale_source
-- 'standard'. Widens the CHECK from migration 108 (idempotent: drop + re-add).
ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_scale_source_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_scale_source_check
  CHECK (scale_source IS NULL OR scale_source IN ('calibrated', 'titleblock', 'standard'));
