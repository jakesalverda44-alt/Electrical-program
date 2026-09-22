-- GENERATED FILE — do not hand-edit. Regenerate with:
--   npx tsx scripts/generateLaborSeedSql.ts > ../database/migrations/102_estimating_labor_seed.sql
-- from backend/, after changing src/estimating/seed/laborUnits.ts.
--
-- Task 2 of docs/superpowers/plans/2026-09-22-estimating-labor-engine-and-redesign.md.
-- Every seeded item/assembly/factor is source='seed': industry-typical starting
-- values authored for this app, NOT copied from the NECA Manual of Labor Units.
-- material_price_date is left NULL on every row (unverified).
-- Insert-if-absent by code, so re-running this file is idempotent and never
-- clobbers an estimator's edit (an edited row's source becomes 'manual').

-- ── Items ─────────────────────────────────────────────────────────────────
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-050', '1/2" EMT (incl. couplings/straps)', 'Branch Power', 'C', 45, NULL, 3.5, ARRAY['1/2" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-075', '3/4" EMT (incl. couplings/straps)', 'Branch Power', 'C', 60, NULL, 4, ARRAY['3/4" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-100', '1" EMT (incl. couplings/straps)', 'Branch Power', 'C', 85, NULL, 5, ARRAY['1" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-125', '1-1/4" EMT (incl. couplings/straps)', 'Branch Power', 'C', 115, NULL, 6, ARRAY['1-1/4" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-150', '1-1/2" EMT (incl. couplings/straps)', 'Branch Power', 'C', 145, NULL, 7, ARRAY['1-1/2" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-200', '2" EMT (incl. couplings/straps)', 'Branch Power', 'C', 195, NULL, 8.5, ARRAY['2" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-250', '2-1/2" EMT (incl. couplings/straps)', 'Branch Power', 'C', 320, NULL, 11, ARRAY['2-1/2" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-300', '3" EMT (incl. couplings/straps)', 'Branch Power', 'C', 410, NULL, 13, ARRAY['3" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('EMT-400', '4" EMT (incl. couplings/straps)', 'Branch Power', 'C', 560, NULL, 17, ARRAY['4" emt (incl. couplings/straps)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-050', '1/2" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 18, NULL, 3, ARRAY['1/2" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-075', '3/4" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 25, NULL, 3.5, ARRAY['3/4" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-100', '1" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 35, NULL, 4.3, ARRAY['1" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-125', '1-1/4" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 48, NULL, 5.2, ARRAY['1-1/4" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-150', '1-1/2" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 60, NULL, 6, ARRAY['1-1/2" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-200', '2" PVC Sch 40, underground (incl. fittings/glue)', 'Site / Underground / Allowances', 'C', 85, NULL, 7.5, ARRAY['2" pvc sch 40, underground (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-250', '2-1/2" PVC Sch 40, underground (incl. fittings/glue)', 'Site / Underground / Allowances', 'C', 140, NULL, 10, ARRAY['2-1/2" pvc sch 40, underground (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-300', '3" PVC Sch 40, underground (incl. fittings/glue)', 'Site / Underground / Allowances', 'C', 180, NULL, 12, ARRAY['3" pvc sch 40, underground (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVC-400', '4" PVC Sch 40, underground (incl. fittings/glue)', 'Site / Underground / Allowances', 'C', 250, NULL, 15.5, ARRAY['4" pvc sch 40, underground (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-075', '3/4" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 95, NULL, 6, ARRAY['3/4" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-100', '1" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 130, NULL, 7.5, ARRAY['1" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-125', '1-1/4" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 175, NULL, 9, ARRAY['1-1/4" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-150', '1-1/2" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 220, NULL, 10.5, ARRAY['1-1/2" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-200', '2" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 290, NULL, 13, ARRAY['2" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-250', '2-1/2" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 410, NULL, 15.5, ARRAY['2-1/2" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('RGD-300', '3" rigid steel conduit (incl. fittings)', 'Service & Distribution', 'C', 520, NULL, 18, ARRAY['3" rigid steel conduit (incl. fittings)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LFMC-050', '1/2" liquidtight flexible metal conduit', 'Branch Power', 'C', 55, NULL, 4.5, ARRAY['1/2" liquidtight flexible metal conduit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LFMC-075', '3/4" liquidtight flexible metal conduit', 'Branch Power', 'C', 75, NULL, 5.2, ARRAY['3/4" liquidtight flexible metal conduit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('MC-1202', '12/2 MC cable', 'Branch Power', 'C', 70, NULL, 2.5, ARRAY['12/2 mc cable','12-2 mc','mc cable 12/2']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('MC-1203', '12/3 MC cable', 'Branch Power', 'C', 95, NULL, 2.8, ARRAY['12/3 mc cable','12-3 mc']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('MC-1002', '10/2 MC cable', 'Branch Power', 'C', 110, NULL, 3, ARRAY['10/2 mc cable','10-2 mc']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('MC-1003', '10/3 MC cable', 'Branch Power', 'C', 145, NULL, 3.4, ARRAY['10/3 mc cable','10-3 mc']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-14', '#14 THHN/THWN copper conductor', 'Branch Power', 'M', 65, NULL, 3, ARRAY['#14 thhn','14 awg thhn','#14 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-12', '#12 THHN/THWN copper conductor', 'Branch Power', 'M', 95, NULL, 3.5, ARRAY['#12 thhn','12 awg thhn','#12 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-10', '#10 THHN/THWN copper conductor', 'Branch Power', 'M', 150, NULL, 4.2, ARRAY['#10 thhn','10 awg thhn','#10 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-8', '#8 THHN/THWN copper conductor', 'Branch Power', 'M', 240, NULL, 5.5, ARRAY['#8 thhn','8 awg thhn','#8 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-6', '#6 THHN/THWN copper conductor', 'Service & Distribution', 'M', 360, NULL, 7, ARRAY['#6 thhn','6 awg thhn','#6 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-4', '#4 THHN/THWN copper conductor', 'Service & Distribution', 'M', 560, NULL, 8.5, ARRAY['#4 thhn','4 awg thhn','#4 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-2', '#2 THHN/THWN copper conductor', 'Service & Distribution', 'M', 850, NULL, 10.5, ARRAY['#2 thhn','2 awg thhn','#2 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-1', '#1 THHN/THWN copper conductor', 'Service & Distribution', 'M', 1050, NULL, 12, ARRAY['#1 thhn','1 awg thhn','#1 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-1_0', '#1/0 THHN/THWN copper conductor', 'Service & Distribution', 'M', 1280, NULL, 13.5, ARRAY['#1/0 thhn','1/0 awg thhn','#1/0 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-2_0', '#2/0 THHN/THWN copper conductor', 'Service & Distribution', 'M', 1550, NULL, 15, ARRAY['#2/0 thhn','2/0 awg thhn','#2/0 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-3_0', '#3/0 THHN/THWN copper conductor', 'Service & Distribution', 'M', 1870, NULL, 16.5, ARRAY['#3/0 thhn','3/0 awg thhn','#3/0 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-4_0', '#4/0 THHN/THWN copper conductor', 'Service & Distribution', 'M', 2260, NULL, 18.5, ARRAY['#4/0 thhn','4/0 awg thhn','#4/0 thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-250', '#250 kcmil THHN/THWN copper conductor', 'Service & Distribution', 'M', 2650, NULL, 21, ARRAY['#250 kcmil thhn','250 kcmil awg thhn','#250 kcmil thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-350', '#350 kcmil THHN/THWN copper conductor', 'Service & Distribution', 'M', 3600, NULL, 25, ARRAY['#350 kcmil thhn','350 kcmil awg thhn','#350 kcmil thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-500', '#500 kcmil THHN/THWN copper conductor', 'Service & Distribution', 'M', 4950, NULL, 30, ARRAY['#500 kcmil thhn','500 kcmil awg thhn','#500 kcmil thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('THHN-600', '#600 kcmil THHN/THWN copper conductor', 'Service & Distribution', 'M', 5900, NULL, 34, ARRAY['#600 kcmil thhn','600 kcmil awg thhn','#600 kcmil thwn']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('FIT-CONDBODY', 'Conduit body (LB/T), EMT or rigid', 'Branch Power', 'EA', 14, NULL, 0.25, ARRAY['conduit body','lb fitting','condulet']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('FIT-EXPANSION', 'Expansion fitting, conduit', 'Branch Power', 'EA', 45, NULL, 0.4, ARRAY['expansion fitting','expansion joint conduit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-DUP', '20A 125V duplex receptacle, spec grade', 'Branch Power', 'EA', 6, NULL, 0.35, ARRAY['duplex receptacle, spec grade','duplex receptacle','20a 125v duplex receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-GFCI', 'GFCI receptacle', 'Branch Power', 'EA', 22, NULL, 0.4, ARRAY['gfci receptacle','gfi receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-WPGFCI', 'GFCI receptacle, weatherproof w/ in-use cover', 'Branch Power', 'EA', 45, NULL, 0.55, ARRAY['weatherproof gfci','wp gfci receptacle','in-use cover gfci']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-QUAD', 'Quad receptacle', 'Branch Power', 'EA', 14, NULL, 0.45, ARRAY['quad receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-DED20', 'Dedicated 20A circuit receptacle', 'Branch Power', 'EA', 10, NULL, 0.5, ARRAY['dedicated circuit receptacle','dedicated 20a receptacle','equipment connection']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-TL30', '30A twist-lock receptacle', 'Branch Power', 'EA', 35, NULL, 0.7, ARRAY['30a twist-lock receptacle','twist lock receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-RANGE50', '50A range/dryer receptacle', 'Branch Power', 'EA', 40, NULL, 0.8, ARRAY['50a range receptacle','dryer receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DEV-FLRBOX', 'Floor box, device + box', 'Branch Power', 'EA', 85, NULL, 1.5, ARRAY['floor box']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-1P', 'Single-pole switch, spec grade', 'Branch Power', 'EA', 6, NULL, 0.3, ARRAY['single pole switch','1-pole switch','switch, spec grade']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-2P', 'Double-pole switch, spec grade', 'Branch Power', 'EA', 9, NULL, 0.35, ARRAY['double pole switch','2-pole switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-3W', '3-way switch, spec grade', 'Branch Power', 'EA', 9, NULL, 0.35, ARRAY['3-way switch','three way switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-4W', '4-way switch, spec grade', 'Branch Power', 'EA', 14, NULL, 0.4, ARRAY['4-way switch','four way switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-DIM', 'Dimmer switch', 'Branch Power', 'EA', 28, NULL, 0.45, ARRAY['dimmer switch','dimmer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SW-COMBO', 'Combination switch/receptacle device', 'Branch Power', 'EA', 12, NULL, 0.4, ARRAY['switch/receptacle combo','combination device']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('BOX-4116', '4-11/16" square device box', 'Branch Power', 'EA', 8, NULL, 0.3, ARRAY['4-11/16" box','4-11/16 square box']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('BOX-4SQ', '4" square device box', 'Branch Power', 'EA', 5, NULL, 0.25, ARRAY['4" square box','j-box']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-30', 'Disconnect switch, 30A', 'Service & Distribution', 'EA', 95, NULL, 1.5, ARRAY['30a disconnect','disconnect switch, 30a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-60', 'Disconnect switch, 60A', 'Service & Distribution', 'EA', 145, NULL, 2, ARRAY['60a disconnect','disconnect switch, 60a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-100', 'Disconnect switch, 100A', 'Service & Distribution', 'EA', 240, NULL, 3, ARRAY['100a disconnect','disconnect switch, 100a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-200', 'Disconnect switch, 200A', 'Service & Distribution', 'EA', 420, NULL, 4.5, ARRAY['200a disconnect','disconnect switch, 200a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-400', 'Disconnect switch, 400A', 'Service & Distribution', 'EA', 950, NULL, 7, ARRAY['400a disconnect','disconnect switch, 400a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LC-OCCSW', 'Occupancy sensor, wall-switch type', 'Lighting Controls', 'EA', 35, NULL, 0.4, ARRAY['wall switch occupancy sensor','occupancy sensor switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LC-OCCCEIL', 'Ceiling-mount occupancy sensor w/ power pack', 'Lighting Controls', 'EA', 65, NULL, 0.6, ARRAY['ceiling-mount occupancy sensor w/ power pack','ceiling occupancy sensor']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LC-PHOTO', 'Photocell', 'Lighting Controls', 'EA', 30, NULL, 0.4, ARRAY['photocell','photo control']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LC-CONTACTOR', 'Lighting contactor', 'Lighting Controls', 'EA', 180, NULL, 2, ARRAY['lighting contactor']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LC-RELAYPANEL', 'Lighting relay/control panel', 'Lighting Controls', 'EA', 650, NULL, 4, ARRAY['lighting control panel','relay panel']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-TROF24', '2x4 LED recessed troffer', 'Interior Lighting', 'EA', 95, NULL, 0.75, ARRAY['type a - 2x4 led recessed troffer','2x4 led troffer','2x4 troffer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-TROF24E', '2x4 LED troffer w/ emergency battery pack', 'Interior Lighting', 'EA', 165, NULL, 0.9, ARRAY['type ae - 2x4 led troffer w/ emergency battery pack','2x4 troffer w/ emergency battery']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-TROF22', '2x2 LED troffer', 'Interior Lighting', 'EA', 85, NULL, 0.7, ARRAY['2x2 led troffer','2x2 troffer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-DOWN', 'LED downlight/can', 'Interior Lighting', 'EA', 55, NULL, 0.6, ARRAY['led downlight','recessed can light','downlight']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-STRIP4', 'LED strip fixture, 4ft', 'Interior Lighting', 'EA', 60, NULL, 0.65, ARRAY['led strip fixture','4ft strip light','strip fixture']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-HIBAY', 'LED high-bay fixture', 'Interior Lighting', 'EA', 210, NULL, 1.4, ARRAY['led high-bay fixture','high bay light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-VAPOR', 'LED vapor-tight fixture', 'Interior Lighting', 'EA', 110, NULL, 0.8, ARRAY['vapor tight fixture','vapor-tight light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-PENDANT', 'LED linear pendant fixture', 'Interior Lighting', 'EA', 180, NULL, 1.1, ARRAY['linear pendant','pendant fixture']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-TRACK', 'Track lighting head', 'Interior Lighting', 'EA', 65, NULL, 0.5, ARRAY['track light head','track lighting']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-EXIT', 'Exit sign, LED, battery backup', 'Interior Lighting', 'EA', 55, NULL, 0.6, ARRAY['exit sign','led exit sign']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-EM', 'Emergency egress light, wall-mount, battery', 'Interior Lighting', 'EA', 65, NULL, 0.6, ARRAY['emergency egress light','emergency light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-EMCOMBO', 'Combination exit/emergency light unit', 'Interior Lighting', 'EA', 95, NULL, 0.75, ARRAY['exit/emergency combo unit','combo exit emergency light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-WPACK', 'Wall pack, LED', 'Exterior / Site Lighting', 'EA', 145, NULL, 1, ARRAY['wall pack','led wall pack']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-CANOPY', 'Canopy light, LED (fuel canopy)', 'Exterior / Site Lighting', 'EA', 320, NULL, 1.8, ARRAY['canopy light','fuel canopy light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-POLEHEAD', 'Area/pole light fixture head, LED', 'Exterior / Site Lighting', 'EA', 385, NULL, 1.2, ARRAY['type j1 - led area light','led area light','pole light fixture head']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-POLE', 'Steel light pole on concrete base (base by others)', 'Exterior / Site Lighting', 'EA', 950, NULL, 4.5, ARRAY['steel square pole on concrete base','light pole, base by others']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-BOLLARD', 'Bollard light', 'Exterior / Site Lighting', 'EA', 220, NULL, 1.3, ARRAY['bollard light','bollard fixture']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-STEP', 'Step/path light', 'Exterior / Site Lighting', 'EA', 65, NULL, 0.6, ARRAY['step light','path light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LTG-FLOOD', 'Flood light, LED', 'Exterior / Site Lighting', 'EA', 110, NULL, 0.9, ARRAY['led flood light','flood light']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PNL-100', 'Panelboard, 100A, up to 24 circuits', 'Service & Distribution', 'EA', 650, NULL, 5, ARRAY['100a panelboard','panelboard, 100a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PNL-225', 'Panelboard, 225A MLO, up to 42 circuits', 'Service & Distribution', 'EA', 1450, NULL, 8, ARRAY['225a mlo branch panelboard, 42-circuit','225a panelboard','panelboard, 225a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PNL-400', 'Panelboard, 400A, up to 84 circuits', 'Service & Distribution', 'EA', 2650, NULL, 12, ARRAY['400a panelboard','panelboard, 400a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PNL-SUB100', 'Sub-panel / load center, 100A', 'Service & Distribution', 'EA', 320, NULL, 3.5, ARRAY['sub panel, 100a','load center']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-15', 'Transformer, dry-type, 15 kVA', 'Service & Distribution', 'EA', 1100, NULL, 4, ARRAY['15 kva transformer','dry-type transformer, 15kva']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-30', 'Transformer, dry-type, 30 kVA', 'Service & Distribution', 'EA', 1650, NULL, 5, ARRAY['30 kva transformer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-45', 'Transformer, dry-type, 45 kVA', 'Service & Distribution', 'EA', 2200, NULL, 6, ARRAY['45 kva transformer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-75', 'Transformer, dry-type, 75 kVA', 'Service & Distribution', 'EA', 3400, NULL, 8, ARRAY['75 kva transformer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-112', 'Transformer, dry-type, 112.5 kVA', 'Service & Distribution', 'EA', 4600, NULL, 10, ARRAY['112.5 kva transformer','112 kva transformer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('XFMR-150', 'Transformer, dry-type, 150 kVA', 'Service & Distribution', 'EA', 5800, NULL, 12, ARRAY['150 kva transformer']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('METERCT', 'Meter base / CT cabinet', 'Service & Distribution', 'EA', 450, NULL, 3, ARRAY['meter base','ct cabinet']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('METERCT-MULTI', 'Metering CT cabinet, multi-tenant', 'Service & Distribution', 'EA', 1450, NULL, 6, ARRAY['multi-tenant meter cabinet','multi-metering cabinet']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SWBD-ALLOW', 'Switchboard allowance', 'Service & Distribution', 'EA', 8500, NULL, 20, ARRAY['switchboard allowance','switchboard']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('ATS-200', 'Automatic transfer switch, 200A', 'Service & Distribution', 'EA', 3200, NULL, 6, ARRAY['ats, 200a','automatic transfer switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GEN-RECEPT', 'Generator receptacle/connection box', 'Service & Distribution', 'EA', 650, NULL, 3.5, ARRAY['generator receptacle','generator connection box']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPD-PNL', 'Surge protective device, panel-mounted', 'Service & Distribution', 'EA', 380, NULL, 1, ARRAY['surge protective device','spd']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('BUS-100SEC', 'Busway, 10ft section (100A)', 'Service & Distribution', 'EA', 420, NULL, 1.5, ARRAY['busway section','busway 100a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-TRENCH', 'Trenching & backfill allowance', 'Site / Underground / Allowances', 'LF', 2.5, NULL, 0.08, ARRAY['trenching allowance','trench and backfill','service feeder allowance']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-BORE', 'Directional bore allowance', 'Site / Underground / Allowances', 'LF', 4, NULL, 0.05, ARRAY['directional bore','bore allowance']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-PB1212', 'Pull box, underground, 12x12', 'Site / Underground / Allowances', 'EA', 180, NULL, 2, ARRAY['12x12 pull box','underground pull box, 12x12']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-PB2424', 'Pull box, underground, 24x24', 'Site / Underground / Allowances', 'EA', 420, NULL, 3.5, ARRAY['24x24 pull box','underground pull box, 24x24']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-HH', 'Handhole, precast', 'Site / Underground / Allowances', 'EA', 650, NULL, 4, ARRAY['handhole','precast handhole']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-PAD', 'Concrete pad, equipment (small)', 'Site / Underground / Allowances', 'EA', 320, NULL, 3, ARRAY['equipment pad','concrete equipment pad']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-TRCOVER', 'Traffic-rated cover, pull box', 'Site / Underground / Allowances', 'EA', 140, NULL, 0.5, ARRAY['traffic rated cover','traffic lid']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SITE-DUCTRACK', 'Underground duct spacer/rack, per 100 LF', 'Site / Underground / Allowances', 'C', 60, NULL, 1, ARRAY['duct spacer','duct rack']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-DATA', 'Data outlet rough-in (box + ring + pull string)', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 18, NULL, 0.5, ARRAY['3/4" emt + 4-11/16" box w/ pull string, data outlet','data outlet rough-in','data box rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-FA', 'Fire alarm device rough-in', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 16, NULL, 0.5, ARRAY['fire alarm rough-in','fa device rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-FACP', 'Fire alarm control panel power connection', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 45, NULL, 1.5, ARRAY['facp connection','fire alarm panel power']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-AV', 'CATV/AV rough-in', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 16, NULL, 0.45, ARRAY['catv rough-in','av rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-ACCESS', 'Access control device rough-in (reader/maglock)', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 22, NULL, 0.6, ARRAY['access control rough-in','card reader rough-in','maglock rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-CAMERA', 'Security camera rough-in', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 20, NULL, 0.55, ARRAY['camera rough-in','security camera rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('LV-INTERCOM', 'Intercom/paging rough-in', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 18, NULL, 0.5, ARRAY['intercom rough-in','paging rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-FUEL', 'Fuel dispenser/ESO rough-in', 'Branch Power', 'EA', 85, NULL, 2, ARRAY['fuel dispenser rough-in','eso rough-in','emergency shut-off rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-CARWASH', 'Car wash equipment connection', 'Branch Power', 'EA', 65, NULL, 1.8, ARRAY['car wash equipment connection']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-GATE', 'Gate operator rough-in', 'Branch Power', 'EA', 55, NULL, 1.5, ARRAY['gate operator rough-in','gate operator connection']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-EV', 'EV charger rough-in', 'Branch Power', 'EA', 75, NULL, 1.6, ARRAY['ev charger rough-in','electric vehicle charger rough-in']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-EVFINAL', 'EV charger final connection', 'Branch Power', 'EA', 120, NULL, 1.2, ARRAY['ev charger final connection','ev charger hookup']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-KITCHEN', 'Equipment connection — kitchen equipment schedule', 'Branch Power', 'EA', 45, NULL, 1.4, ARRAY['equipment connection - kitchen equipment schedule','kitchen equipment connection']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('SPEC-MOTOR', 'Motor combination starter/disconnect connection', 'Branch Power', 'EA', 320, NULL, 3, ARRAY['motor starter connection','combination starter/disconnect']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-ROD', '5/8" x 10'' copper-clad ground rod w/ exothermic connection', 'Grounding', 'EA', 45, NULL, 1, ARRAY['5/8" x 10'' copper-clad ground rod w/ exothermic connection','ground rod','copper-clad ground rod']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-BAR', 'Ground bar, panel', 'Grounding', 'EA', 35, NULL, 0.5, ARRAY['ground bar','panel ground bar']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-BOND', 'Bonding jumper, equipment', 'Grounding', 'EA', 12, NULL, 0.3, ARRAY['bonding jumper','equipment bonding jumper']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-RING', 'Ground ring conductor, bare copper', 'Grounding', 'C', 220, NULL, 4, ARRAY['ground ring','bare copper ground ring conductor']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-UFER', 'Ufer ground (concrete-encased electrode) connection', 'Grounding', 'EA', 25, NULL, 1, ARRAY['ufer ground','concrete-encased electrode']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('GND-LPS', 'Lightning protection air terminal allowance', 'Grounding', 'EA', 65, NULL, 1, ARRAY['lightning protection air terminal','lps allowance']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- ── Assemblies ───────────────────────────────────────────────────────────
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-SVCENT-400', '400A 3PH service entrance assembly, NEMA 3R', 'Service & Distribution', 'EA', ARRAY['400a service entrance assembly','service entrance assembly, 400a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-SVCENT-800', '800A 120/208V 3PH 4W service entrance assembly, NEMA 3R', 'Service & Distribution', 'EA', ARRAY['800a 120/208v 3ph 4w service entrance assembly, nema 3r','800a service entrance assembly']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-FEEDER-300KCMIL', 'Service feeder run, 3-1/2" conduit, 4#300 KCMIL + #2/0 GND (100 LF)', 'Service & Distribution', 'EA', ARRAY['service feeder, 3-1/2" conduit, 4#300 kcmil + #2/0 gnd','feeder run 300 kcmil']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-PNL-225', '225A MLO branch panelboard, 42-circuit, installed', 'Service & Distribution', 'EA', ARRAY['225a mlo branch panelboard, 42-circuit (ecfeci)','225a panelboard installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-PNL-400', '400A panelboard, installed', 'Service & Distribution', 'EA', ARRAY['400a panelboard installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-XFMR-75', 'Transformer, 75 kVA, installed', 'Service & Distribution', 'EA', ARRAY['75 kva transformer installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-XFMR-150', 'Transformer, 150 kVA, installed', 'Service & Distribution', 'EA', ARRAY['150 kva transformer installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-ATS-200', 'ATS, 200A, installed', 'Service & Distribution', 'EA', ARRAY['ats 200a installed','automatic transfer switch installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-SWBD', 'Switchboard allowance, installed', 'Service & Distribution', 'EA', ARRAY['switchboard allowance installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-DISC-100', 'Disconnect switch, 100A, installed', 'Service & Distribution', 'EA', ARRAY['100a disconnect installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-DISC-200', 'Disconnect switch, 200A, installed', 'Service & Distribution', 'EA', ARRAY['200a disconnect installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-METERCT', 'Meter base / CT cabinet, installed', 'Service & Distribution', 'EA', ARRAY['meter base installed','ct cabinet installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-BUS-SECTION', 'Busway section, installed', 'Service & Distribution', 'EA', ARRAY['busway section installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-DUPLEX', '20A duplex receptacle circuit, complete', 'Branch Power', 'EA', ARRAY['20a 125v duplex receptacle, spec grade','duplex receptacle circuit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-GFCI', 'GFCI receptacle circuit, complete', 'Branch Power', 'EA', ARRAY['gfci receptacle circuit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-WPGFCI', 'Weatherproof GFCI receptacle circuit, complete', 'Branch Power', 'EA', ARRAY['weatherproof gfci circuit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-KITCHEN-EQUIP', 'Equipment connection — kitchen equipment schedule, complete', 'Branch Power', 'EA', ARRAY['equipment connection - kitchen equipment schedule']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-FLOORBOX', 'Floor box circuit, complete', 'Branch Power', 'EA', ARRAY['floor box circuit']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-DATA-OUTLET', 'Data outlet rough-in, complete', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', ARRAY['3/4" emt + 4-11/16" box w/ pull string, data outlet','data outlet rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-FA-DEVICE', 'Fire alarm device rough-in, complete', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', ARRAY['fa device rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-ACCESS', 'Access control device rough-in, complete', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', ARRAY['access control device rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-CAMERA', 'Security camera rough-in, complete', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', ARRAY['security camera rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-OCC-CEIL', 'Ceiling-mount occupancy sensor w/ power pack, complete', 'Lighting Controls', 'EA', ARRAY['ceiling-mount occupancy sensor w/ power pack']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-TROFFER-24', '2x4 LED troffer, installed', 'Interior Lighting', 'EA', ARRAY['type a - 2x4 led recessed troffer','2x4 led troffer installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-TROFFER-24E', '2x4 LED troffer w/ emergency battery pack, installed', 'Interior Lighting', 'EA', ARRAY['type ae - 2x4 led troffer w/ emergency battery pack']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-HIBAY', 'LED high-bay fixture, installed', 'Interior Lighting', 'EA', ARRAY['led high-bay fixture installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-DOWNLIGHT', 'LED downlight, installed', 'Interior Lighting', 'EA', ARRAY['led downlight installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-STRIP4', 'LED strip fixture, installed', 'Interior Lighting', 'EA', ARRAY['led strip fixture installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-VAPOR', 'LED vapor-tight fixture, installed', 'Interior Lighting', 'EA', ARRAY['vapor tight fixture installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-EXIT', 'Exit sign, installed', 'Interior Lighting', 'EA', ARRAY['exit sign installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-EMLIGHT', 'Emergency egress light, installed', 'Interior Lighting', 'EA', ARRAY['emergency egress light installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-WPACK', 'Wall pack, installed', 'Exterior / Site Lighting', 'EA', ARRAY['wall pack installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-CANOPY', 'Canopy light, installed', 'Exterior / Site Lighting', 'EA', ARRAY['fuel canopy light installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-POLE-LIGHT', '17'' square steel pole on concrete base, w/ area light fixture', 'Exterior / Site Lighting', 'EA', ARRAY['17'' square steel pole on 3'' concrete base (base by others)','pole light assembly']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-BOLLARD', 'Bollard light, installed', 'Exterior / Site Lighting', 'EA', ARRAY['bollard light installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-FLOOD', 'Flood light, installed', 'Exterior / Site Lighting', 'EA', ARRAY['flood light installed']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-EV-ROUGHIN', 'EV charger rough-in, complete', 'Branch Power', 'EA', ARRAY['ev charger rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-FUEL-ROUGHIN', 'Fuel dispenser/ESO rough-in, complete', 'Branch Power', 'EA', ARRAY['fuel dispenser rough-in complete','eso rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-CARWASH', 'Car wash equipment connection, complete', 'Branch Power', 'EA', ARRAY['car wash equipment connection complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-GATE', 'Gate operator rough-in, complete', 'Branch Power', 'EA', ARRAY['gate operator rough-in complete']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-GROUND-ROD', '5/8" x 10'' copper-clad ground rod w/ exothermic connection, complete', 'Grounding', 'EA', ARRAY['5/8" x 10'' copper-clad ground rod w/ exothermic connection']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- ── Assembly components ──────────────────────────────────────────────────
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-400' AND it.code = 'METERCT'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-400' AND it.code = 'DISC-400'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.3
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-400' AND it.code = 'RGD-300'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.12
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-400' AND it.code = 'THHN-4_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-400' AND it.code = 'GND-ROD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-800' AND it.code = 'METERCT-MULTI'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-800' AND it.code = 'DISC-400'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.5
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-800' AND it.code = 'RGD-300'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.16
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-800' AND it.code = 'THHN-500'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 3
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SVCENT-800' AND it.code = 'GND-ROD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FEEDER-300KCMIL' AND it.code = 'RGD-300'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.4
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FEEDER-300KCMIL' AND it.code = 'THHN-250'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FEEDER-300KCMIL' AND it.code = 'THHN-2_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-225' AND it.code = 'PNL-225'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-225' AND it.code = 'DISC-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-225' AND it.code = 'RGD-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.08
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-225' AND it.code = 'THHN-2_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-400' AND it.code = 'PNL-400'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-400' AND it.code = 'DISC-400'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.25
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-400' AND it.code = 'RGD-300'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-PNL-400' AND it.code = 'THHN-4_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-75' AND it.code = 'XFMR-75'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-75' AND it.code = 'DISC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-75' AND it.code = 'RGD-150'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.06
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-75' AND it.code = 'THHN-2'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-150' AND it.code = 'XFMR-150'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-150' AND it.code = 'DISC-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-150' AND it.code = 'RGD-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.08
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-XFMR-150' AND it.code = 'THHN-4_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ATS-200' AND it.code = 'ATS-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ATS-200' AND it.code = 'RGD-150'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ATS-200' AND it.code = 'THHN-2_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SWBD' AND it.code = 'SWBD-ALLOW'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.4
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SWBD' AND it.code = 'RGD-300'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-100' AND it.code = 'DISC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.08
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-100' AND it.code = 'RGD-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.03
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-100' AND it.code = 'THHN-1'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-200' AND it.code = 'DISC-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-200' AND it.code = 'RGD-150'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DISC-200' AND it.code = 'THHN-2_0'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-METERCT' AND it.code = 'METERCT'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-METERCT' AND it.code = 'GND-ROD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-BUS-SECTION' AND it.code = 'BUS-100SEC'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DUPLEX' AND it.code = 'DEV-DUP'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DUPLEX' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.25
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DUPLEX' AND it.code = 'EMT-050'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.075
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DUPLEX' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GFCI' AND it.code = 'DEV-GFCI'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GFCI' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.25
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GFCI' AND it.code = 'EMT-050'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.075
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GFCI' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPGFCI' AND it.code = 'DEV-WPGFCI'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPGFCI' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.25
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPGFCI' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.075
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPGFCI' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-KITCHEN-EQUIP' AND it.code = 'SPEC-KITCHEN'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-KITCHEN-EQUIP' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-KITCHEN-EQUIP' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.06
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-KITCHEN-EQUIP' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOORBOX' AND it.code = 'DEV-FLRBOX'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.3
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOORBOX' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.09
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOORBOX' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DATA-OUTLET' AND it.code = 'LV-DATA'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DATA-OUTLET' AND it.code = 'BOX-4116'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DATA-OUTLET' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FA-DEVICE' AND it.code = 'LV-FA'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FA-DEVICE' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FA-DEVICE' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ACCESS' AND it.code = 'LV-ACCESS'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ACCESS' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-ACCESS' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CAMERA' AND it.code = 'LV-CAMERA'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CAMERA' AND it.code = 'BOX-4SQ'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CAMERA' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-OCC-CEIL' AND it.code = 'LC-OCCCEIL'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.03
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-OCC-CEIL' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-TROFFER-24' AND it.code = 'LTG-TROF24'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.03
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-TROFFER-24' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-TROFFER-24E' AND it.code = 'LTG-TROF24E'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.03
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-TROFFER-24E' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-HIBAY' AND it.code = 'LTG-HIBAY'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-HIBAY' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DOWNLIGHT' AND it.code = 'LTG-DOWN'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.02
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-DOWNLIGHT' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-STRIP4' AND it.code = 'LTG-STRIP4'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.02
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-STRIP4' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-VAPOR' AND it.code = 'LTG-VAPOR'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.03
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-VAPOR' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EXIT' AND it.code = 'LTG-EXIT'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.02
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EXIT' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EMLIGHT' AND it.code = 'LTG-EM'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.02
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EMLIGHT' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPACK' AND it.code = 'LTG-WPACK'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPACK' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-WPACK' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CANOPY' AND it.code = 'LTG-CANOPY'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CANOPY' AND it.code = 'RGD-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.05
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CANOPY' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-POLE-LIGHT' AND it.code = 'LTG-POLE'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-POLE-LIGHT' AND it.code = 'LTG-POLEHEAD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.15
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-POLE-LIGHT' AND it.code = 'RGD-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.06
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-POLE-LIGHT' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-POLE-LIGHT' AND it.code = 'GND-ROD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-BOLLARD' AND it.code = 'LTG-BOLLARD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-BOLLARD' AND it.code = 'PVC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-BOLLARD' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOOD' AND it.code = 'LTG-FLOOD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOOD' AND it.code = 'EMT-075'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.04
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FLOOD' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EV-ROUGHIN' AND it.code = 'SPEC-EV'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.4
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EV-ROUGHIN' AND it.code = 'PVC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.12
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-EV-ROUGHIN' AND it.code = 'THHN-8'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FUEL-ROUGHIN' AND it.code = 'SPEC-FUEL'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.3
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FUEL-ROUGHIN' AND it.code = 'PVC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.08
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-FUEL-ROUGHIN' AND it.code = 'THHN-10'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CARWASH' AND it.code = 'SPEC-CARWASH'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.2
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CARWASH' AND it.code = 'EMT-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.06
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-CARWASH' AND it.code = 'THHN-8'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GATE' AND it.code = 'SPEC-GATE'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.25
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GATE' AND it.code = 'PVC-100'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 0.06
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GATE' AND it.code = 'THHN-12'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GROUND-ROD' AND it.code = 'GND-ROD'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-GROUND-ROD' AND it.code = 'GND-BOND'
ON CONFLICT (assembly_id, item_id) DO NOTHING;

-- ── Labor factors ────────────────────────────────────────────────────────
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('HEIGHT-10-14', 'Working height 10–14 ft', 10, 'height', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('HEIGHT-14-20', 'Working height 14–20 ft', 20, 'height', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('HEIGHT-20-PLUS', 'Working height 20+ ft', 35, 'height', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('OCCUPIED', 'Occupied building / renovation', 15, 'occupied', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('CONGESTED-CEILING', 'Congested ceiling / above-ceiling obstructions', 10, 'congested', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('NIGHT-WORK', 'Night / after-hours work', 15, 'schedule', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('MULTI-STORY', 'Multi-story (per floor above 2)', 3, 'multistory', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('REMOTE-ACCESS', 'Remote / restricted site access', 5, 'access', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_labor_factors (code, label, pct, group_key, active)
VALUES ('PREVAILING-WAGE', 'Prevailing wage (placeholder)', 0, 'wage', true)
ON CONFLICT (code) DO NOTHING;
