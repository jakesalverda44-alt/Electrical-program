-- Price accuracy round (docs/superpowers/plans/2026-09-29-price-accuracy-round.md),
-- Builder C. Insert-only: an existing row with the same code (an
-- estimator's edit) is never touched.
--
-- C3 — boxes / fittings / support hardware allowance units, one per driver
-- (a device/fixture point, 100 ft of a raceway, a fixture), at the rates
-- backend/src/estimating/boxFittingCalibration.ts fits on Chris's five BOMs
-- (leave-one-out ±19% on the four groups' hours together). EMT/PVC fitting
-- hours are what Chris carries on top of the seed EMT/PVC items, which
-- already include couplings/straps (fittings/glue). Same rows as
-- seed/laborUnits.ts BOX_FITTING_ITEMS.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('ALW-BOX', 'Box allowance — box, ring or cover, bracket, ground screw (per point)', 'Branch Power', 'EA', 2.29, NULL, 0.19, ARRAY[]::text[], 'seed', true),
  ('ALW-FIT-EMT', 'EMT fittings allowance — couplings, connectors, straps (per 100 ft)', 'Branch Power', 'C', 9.88, NULL, 1.13, ARRAY[]::text[], 'seed', true),
  ('ALW-FIT-PVC', 'PVC fittings allowance — elbows, couplings, adapters (per 100 ft)', 'Branch Power', 'C', 23.04, NULL, 1.2, ARRAY[]::text[], 'seed', true),
  ('ALW-FIT-MC', 'MC / flex connector allowance (per 100 ft)', 'Branch Power', 'C', 12.3, NULL, 2.2, ARRAY[]::text[], 'seed', true),
  ('ALW-HW-RACEWAY', 'Support hardware allowance — anchors, clips, hangers, screws (per 100 ft)', 'Branch Power', 'C', 27.01, NULL, 2.68, ARRAY[]::text[], 'seed', true),
  ('ALW-HW-FIXTURE', 'Support hardware allowance — per fixture', 'Branch Power', 'EA', 2.49, NULL, 0, ARRAY[]::text[], 'seed', true),
  -- C7 — twist-on wire connectors per point (Chris: 15.2 h on 36th Street).
  ('ALW-SPLICE', 'Wire connector allowance — twist-on splices (per point)', 'Branch Power', 'EA', 0.76, NULL, 0.27, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- C5 — demolition units for the classes that had none. Chris's 36th Street
-- BOM carries none of these, so they are NECA-style defaults, named
-- "default — confirm" so the estimator sees they are not from his data.
-- Same rows as seed/laborUnits.ts DEMOLITION_DEFAULT_ITEMS; the names are
-- the ones the AI demolition reading (ai/remodel/demolition.ts) writes.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('DEMO-EQUIP', 'Demolition — equipment connection / disconnect (default — confirm)', 'Demolition', 'EA', 0, NULL, 0.75,
   ARRAY['demolition — equipment connection / disconnect','demolition — disconnect','demolition — equipment connection','demolition — safety switch','demo disconnect']::text[], 'seed', true),
  ('DEMO-DEVICE', 'Demolition — device, other (default — confirm)', 'Demolition', 'EA', 0, NULL, 0.15,
   ARRAY['demolition — device (other)','demolition — device','demolition — telephone outlet','demolition — data outlet']::text[], 'seed', true),
  ('DEMO-SITEPOLE', 'Demolition — site pole light, pole and fixture (default — confirm)', 'Demolition', 'EA', 0, NULL, 3.0,
   ARRAY['demolition — site pole light','demolition — pole light','demolition — light pole']::text[], 'seed', true),
  ('DEMO-EXTFIX', 'Demolition — building-mounted exterior fixture (default — confirm)', 'Demolition', 'EA', 0, NULL, 0.5,
   ARRAY['demolition — building-mounted exterior fixture','demolition — exterior fixture','demolition — wall pack','demolition — canopy light']::text[], 'seed', true),
  ('DEMO-CONTROL', 'Demolition — lighting control device, sensor / timer (default — confirm)', 'Demolition', 'EA', 0, NULL, 0.25,
   ARRAY['demolition — lighting control device (sensor / timer)','demolition — occupancy sensor','demolition — time clock','demolition — photocell','demolition — lighting control device']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- Price accuracy round, decision 2 (Jake's rule: labor units match Chris's
-- Accubid) — #12 / #10 THHN at Chris's 5.150 / 5.650 h per M (every one of
-- his five BOMs). Only an untouched seed row moves: a manual or calibrated
-- row (source <> 'seed') is never changed.
UPDATE est_items SET labor_hours = 5.15, updated_at = now() WHERE code = 'THHN-12' AND source = 'seed' AND labor_hours <> 5.15;
UPDATE est_items SET labor_hours = 5.65, updated_at = now() WHERE code = 'THHN-10' AND source = 'seed' AND labor_hours <> 5.65;

-- Price accuracy round, decision 3 — a vendor quote flagged as the FIXTURE
-- PACKAGE (the lighting package is quoted, as on Chris's 36th Street): the
-- bid's fixture lines then price material at $0 and keep their labor. Set
-- only by the estimator (never inferred); default false, so no existing
-- bid changes price.
ALTER TABLE est_bid_quotes ADD COLUMN IF NOT EXISTS fixture_package BOOLEAN NOT NULL DEFAULT false;

-- Price accuracy round, decision 5 — a pole-head alias so a site-lighting
-- "fixture heads (N per pole)" row comes back as a held (confirm) suggestion
-- of the pole head. Untouched seed row only.
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['pole fixture head']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'LTG-POLEHEAD' AND source = 'seed' AND NOT (aliases @> ARRAY['pole fixture head']::text[]);
