-- Fix round 1 / N3 — the seed's MULTI-STORY labor factor ("per floor above
-- 2") was applied as a flat pct whenever selected, with no way to say HOW
-- MANY floors above 2 the building actually has. Adds the count as a normal
-- per-bid setting; pricing.ts's effectiveFactorPct() multiplies the
-- multistory group's pct by it.
ALTER TABLE est_bid_settings ADD COLUMN IF NOT EXISTS floors_above_2 INTEGER NOT NULL DEFAULT 0;

ALTER TABLE est_bid_settings DROP CONSTRAINT IF EXISTS est_bid_settings_floors_above_2_check;
ALTER TABLE est_bid_settings ADD CONSTRAINT est_bid_settings_floors_above_2_check
  CHECK (floors_above_2 >= 0);
