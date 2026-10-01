-- Gap-closing round T12 (J11, Jake 2026-10-01 "Do default") — library material prices from ONE dated source: Chris's
-- Kissimmee Accubid BOM net costs, 6/18/2026 (the import's own rule B1), for the APPROVED list only: THHN, EMT, PVC,
-- MC and the lighting contactor. Prices only (labor untouched here); material_price_date = 2026-06-18.
-- Only an untouched seed row moves (source = 'seed', never Accubid-reconciled — the 156 guard). Migration 164's
-- trigger writes the old row to history first, so submitted / sold bids keep their prices (libraryAsOf). Never a
-- Quoted row, never a $0 overwrite. Idempotent. Chris's 36th Street prices are lower (listed in the report for the
-- record). The replay mirrors this list exactly (eval/gapMigrations.ts GAP_PRICE_MOVES); the diff table for Jake is
-- printed by backend/src/eval/priceRefreshPreview.test.ts.
SELECT set_config('app.library_change', 'migration 167 (Kissimmee BOM 2026-06-18 price refresh)', true);

-- kissimmee: #12 Black Wire THHN net $208.00/M
UPDATE est_items SET material_cost = 208.0, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'THHN-12' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 208.0 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: #10 Black Wire THHN net $329.70/M
UPDATE est_items SET material_cost = 329.7, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'THHN-10' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 329.7 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: #6 Black Wire THHN net $895.50/M
UPDATE est_items SET material_cost = 895.5, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'THHN-6' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 895.5 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: #3/0 Black Wire THHN net $4,735.00/M
UPDATE est_items SET material_cost = 4735.0, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'THHN-3_0' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 4735.0 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: 3/4" Conduit - EMT net $92.38/C
UPDATE est_items SET material_cost = 92.38, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'EMT-075' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 92.38 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: 1" Conduit - EMT net $157.82/C
UPDATE est_items SET material_cost = 157.82, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'EMT-100' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 157.82 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: 1" Conduit - PVC 40 net $51.82/C
UPDATE est_items SET material_cost = 51.82, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'PVC-100' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 51.82 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: 2" Conduit - PVC 40 net $105.68/C
UPDATE est_items SET material_cost = 105.68, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'PVC-200' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 105.68 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: #12/2C MC Cable net $745.20/M = $74.52/C
UPDATE est_items SET material_cost = 74.52, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'MC-1202' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 74.52 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');

-- kissimmee: Lighting Contactor 1 E net $800.00 (Chris's lump for the 6-contactor enclosure — confirm on a job with single contactors)
UPDATE est_items SET material_cost = 800.0, material_price_date = DATE '2026-06-18', updated_at = now()
 WHERE code = 'LC-CONTACTOR' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (material_cost <> 800.0 OR material_price_date IS DISTINCT FROM DATE '2026-06-18');
