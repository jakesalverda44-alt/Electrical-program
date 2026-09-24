-- Fix round (review a479103, B2) — a gap-fill-suggested marker is written
-- to est_markups the same way the counter's own suggestions are (status
-- 'suggested', never 'confirmed' until the estimator says so), tagged with
-- its own source so it's never confused with an AI-counter suggestion, and
-- so a labeled-data consumer can tell a gap-fill confirmation apart from an
-- ordinary one (N6).
ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_source_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_source_check
  CHECK (source IS NULL OR source IN ('ai_count', 'gap_fill'));
CREATE INDEX IF NOT EXISTS idx_est_markups_bid_source_gap_fill ON est_markups (bid_id, source) WHERE source = 'gap_fill';
