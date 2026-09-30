-- Price accuracy round (docs/superpowers/plans/2026-09-29-price-accuracy-round.md),
-- Builder C, C1 — matcher safety. A fuzzy match into gear, or one above
-- $250 material / 2 h per unit, is held for the estimator: the line keeps
-- the suggested item with match_confidence 'confirm' and prices at $0 / 0 h
-- until it is confirmed. Existing rows are untouched (no backfill): a saved
-- bid's lines keep the confidence they were saved with, so no existing or
-- submitted bid changes price.
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_match_confidence_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_match_confidence_check
  CHECK (match_confidence IS NULL OR match_confidence IN ('exact','alias','fuzzy','none','confirm'));
