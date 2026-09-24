-- Re-run reset, fix round (review 2026-09-24).
--
-- B1 — a kept (estimator-edited) line re-binds only on category + unit +
-- description. When sync-takeoff can't bind it confidently it says why:
-- 'no_confident_match' (nothing matched, or only the renumbered item key did)
-- or 'ambiguous_match' (two new rows matched equally). NULL once bound.
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS recheck_reason TEXT;
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_recheck_reason_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_recheck_reason_check
  CHECK (recheck_reason IS NULL OR recheck_reason IN ('no_confident_match', 'ambiguous_match'));

-- S4 — where each Scope of Work section came from, so a re-run clears only
-- the AI-filled ones: {"ai": {section: text-as-the-AI-wrote-it},
-- "recheck": [section, ...]} (sections kept from the previous run).
ALTER TABLE bid_workspaces ADD COLUMN IF NOT EXISTS scope_meta JSONB NOT NULL DEFAULT '{}';
