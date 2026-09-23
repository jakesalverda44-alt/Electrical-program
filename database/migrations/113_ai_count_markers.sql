-- Takeoff accuracy (docs/superpowers/plans/2026-09-23-takeoff-accuracy.md),
-- Task 6 — the counting stage's located symbols become SUGGESTED markers in
-- the Phase B Plans view ("AI" badge). They never roll up until the estimator
-- confirms them (rollupLines already ignores status <> 'confirmed').
--
-- source: NULL for every estimator-created / text-layer-suggested marker
-- (all rows before this migration), 'ai_count' for a marker written by the
-- counting stage. Set only by the server (never from a client batch), and
-- kept when the estimator confirms the marker, so provenance survives.
ALTER TABLE est_markups ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_source_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_source_check
  CHECK (source IS NULL OR source IN ('ai_count'));
CREATE INDEX IF NOT EXISTS idx_est_markups_bid_source ON est_markups (bid_id, source) WHERE source IS NOT NULL;
