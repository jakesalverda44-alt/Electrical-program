-- Remodel + footage round (docs/superpowers/plans/2026-09-29-remodel-footage-round.md),
-- Builder B.
--
-- B3 — demolition labor units, straight off Chris's 36th Street BOM
-- demolition rows (4/9/2024): fluorescent up to 2x4 0.31 h/E, HID high bay
-- 0.58, exit/emergency 0.50, junction box 0.24; receptacle 13.2 h/C,
-- 1-pole switch 12.8 h/C, 3-way switch 15.5 h/C (stored per EA: a takeoff
-- counts devices in EA). Material $0. Same rows as
-- backend/src/estimating/seed/laborUnits.ts DEMOLITION_ITEMS. Insert-only:
-- an existing row with the same code (an estimator's edit) is never touched.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('DEMO-FLUOR24', 'Demolition — fluorescent fixture up to 2x4', 'Demolition', 'EA', 0, NULL, 0.31,
   ARRAY['demolition — 2x4 fluorescent fixture','demolition — 2x4 fluorescent','demolition — fluorescent fixture','demolition — lighting fixture','demolition — light fixture','demolition - luminaire modular fluorescent up to 2x4','demo fluorescent fixture']::text[], 'seed', true),
  ('DEMO-HIDHB', 'Demolition — HID high bay fixture', 'Demolition', 'EA', 0, NULL, 0.58,
   ARRAY['demolition — hid high bay','demolition — high bay fixture','demolition — high bay','demolition - luminaire high bay w/ lens hid','demo hid high bay']::text[], 'seed', true),
  ('DEMO-EXITEM', 'Demolition — exit/emergency light', 'Demolition', 'EA', 0, NULL, 0.5,
   ARRAY['demolition — exit sign','demolition — exit light','demolition — emergency light','demolition — exit/emergency','demolition - exit light w/ head(s) & battery unit emergency lighting']::text[], 'seed', true),
  ('DEMO-RECEPT', 'Demolition — receptacle', 'Demolition', 'EA', 0, NULL, 0.132,
   ARRAY['demolition — receptacle','demolition — duplex receptacle','demolition — gfci receptacle','demolition - receptacle 3 wire up to 20a','demo receptacle']::text[], 'seed', true),
  ('DEMO-SW1P', 'Demolition — single-pole switch', 'Demolition', 'EA', 0, NULL, 0.128,
   ARRAY['demolition — single pole switch','demolition — 1-pole switch','demolition — switch 1 pole','demolition - switch 1 pole']::text[], 'seed', true),
  ('DEMO-SW3W', 'Demolition — 3-way switch', 'Demolition', 'EA', 0, NULL, 0.155,
   ARRAY['demolition — 3-way switch','demolition — three way switch','demolition — switch 3 way','demolition - switch 3 way']::text[], 'seed', true),
  ('DEMO-JBOX', 'Demolition — junction box', 'Demolition', 'EA', 0, NULL, 0.24,
   ARRAY['demolition — junction box','demolition — j-box','demolition - junction box']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- B2 — the footage allowance's calibrated ratios (editable in Settings >
-- Labor Library > Allowances). Same JSON as
-- backend/src/estimating/footageAllowance.ts DEFAULT_FOOTAGE_SETTINGS;
-- footageCalibration.test.ts re-derives the numbers from Chris's five BOMs.
-- Insert-if-absent: an edited value is never overwritten.
INSERT INTO app_settings (key, value)
SELECT 'est_footage_ratios', '{"version":1,"emtPerPoint":{"fixture":6.6,"device":6.6,"equipment":6.6},"mcPerFixture":7.89,"wirePerConduitFt":5.54,"baseConductors":3,"wire10Share":0.47,"pvcSitePerPole":130,"v2DisagreePct":40,"pointsPerCircuit":8,"items":{"emt":"3/4\" EMT (incl. couplings/straps)","wire12":"#12 THHN/THWN copper conductor","wire10":"#10 THHN/THWN copper conductor","mc":"12/2 MC cable","pvcSite":"1\" PVC Sch 40 (incl. fittings/glue)"},"calibratedOn":"5 of Chris''s jobs","looErrorPct":{"emt":35,"mc":22,"wire":37,"pvcSite":130}}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_footage_ratios');
