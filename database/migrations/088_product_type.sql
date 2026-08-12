-- A proposal row can now describe a Tesla Wall Connector install as well as a generator.
-- The two share this table (and with it e-signature, countersignature, snapshots, Drive
-- folders, the award kickoff and the won-job handoff) because all of that machinery works
-- off the row and its stored totals, not off generator-specific form fields.
--
-- The table keeps its name: renaming a live table that holds signed contracts buys nothing.
-- Existing rows backfill to 'generator' through the default, so no data migration runs.

ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'generator';

ALTER TABLE generator_proposals DROP CONSTRAINT IF EXISTS generator_proposals_product_type_check;
ALTER TABLE generator_proposals ADD CONSTRAINT generator_proposals_product_type_check
  CHECK (product_type IN ('generator', 'ev_charger'));

-- The pipeline filters by type, so the list query has an index to use once EV volume grows.
CREATE INDEX IF NOT EXISTS idx_generator_proposals_product_type
  ON generator_proposals(product_type);
