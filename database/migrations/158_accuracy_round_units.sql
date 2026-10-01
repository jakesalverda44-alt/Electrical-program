-- Accuracy round (docs/superpowers/plans/2026-09-30-accuracy-round.md),
-- Builder P, D3 / D4 — Chris's own units for equipment connections, power
-- poles, simplex receptacles, ceiling fans, site poles / heads / anchor
-- bolts, and the 200A fusible switch with fuses. Every value is cited per
-- row in backend/src/estimating/seed/laborUnits.ts (ACCURACY_ROUND_ITEMS,
-- ASM-SW200F); the seed TS and this file agree (seedUnitsVsChris.test.ts).
-- Idempotent: inserts are ON CONFLICT DO NOTHING; the updates only move an
-- untouched seed row (never a manual / calibrated / Accubid-reconciled row)
-- and are no-ops the second time.
--
-- Jake's decision 1 (2026-09-30, "YES — change existing seed rows to
-- Chris's units"): DISC-30 / DISC-60 / DISC-200 labor 1.5 / 2.0 / 4.5 →
-- 1.10 / 1.55 / 3.1 (Chris: north-port 30A NF 3R 1.10, kissimmee 60A NF 3R
-- 1.55, kissimmee 200A fusible 3.1), LTG-POLE 4.5 → 4.8 (kissimmee 20' pole
-- 4.8), LTG-POLEHEAD 1.2 → 2.2 (kissimmee / north-port pole-top head 2.2),
-- (the site pole / fixture heads rows are reached by code, stage-gated.)
UPDATE est_items SET labor_hours = 1.1, updated_at = now()
 WHERE code = 'DISC-30' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 1.1;
UPDATE est_items SET labor_hours = 1.55, updated_at = now()
 WHERE code = 'DISC-60' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 1.55;
UPDATE est_items SET labor_hours = 3.1, updated_at = now()
 WHERE code = 'DISC-200' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 3.1;
UPDATE est_items SET labor_hours = 4.8, updated_at = now()
 WHERE code = 'LTG-POLE' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 4.8;
UPDATE est_items SET labor_hours = 2.2, updated_at = now()
 WHERE code = 'LTG-POLEHEAD' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 2.2;
-- No generic 'site pole' / 'fixture heads' aliases (review B1/B2: a token-subset
-- alias re-prices submitted bids and reaches emergency / track heads). Rows reach
-- LTG-POLE / LTG-POLEHEAD through the stage-gated equipment rules only. This
-- also strips them from a DB that applied the first draft of this migration.
UPDATE est_items SET aliases = ARRAY(SELECT a FROM unnest(aliases) AS a WHERE a NOT IN ('site pole','pole (site lighting)') ORDER BY a), updated_at = now()
 WHERE code = 'LTG-POLE' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (aliases && ARRAY['site pole','pole (site lighting)']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT a FROM unnest(aliases) AS a WHERE a NOT IN ('fixture heads','pole top fixture head') ORDER BY a), updated_at = now()
 WHERE code = 'LTG-POLEHEAD' AND source = 'seed' AND accubid_reconciled_at IS NULL AND (aliases && ARRAY['fixture heads','pole top fixture head']::text[]);

INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-10', 'Equipment termination, #10 and smaller (Chris BOM)', 'Branch Power', 'EA', 0, NULL, 0.72, ARRAY['#10 motor termination','motor termination #10','equipment termination #10']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-8', 'Equipment termination, #8 (Chris BOM)', 'Branch Power', 'EA', 0, NULL, 0.79, ARRAY['#8 motor termination','motor termination #8']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-6', 'Equipment termination, #6 (Chris BOM)', 'Branch Power', 'EA', 0, NULL, 1.12, ARRAY['#6 motor termination','motor termination #6']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-4', 'Equipment termination, #4 (default — confirm)', 'Branch Power', 'EA', 0, NULL, 1.45, ARRAY['#4 motor termination','motor termination #4']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-2', 'Equipment termination, #2 (Chris BOM)', 'Branch Power', 'EA', 0, NULL, 1.75, ARRAY['#2 motor termination','motor termination #2']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-1', 'Equipment termination, #1 (Chris BOM)', 'Branch Power', 'EA', 0, NULL, 2.08, ARRAY['#1 motor termination','motor termination #1']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TERM-1_0', 'Equipment termination, #1/0 (default — confirm)', 'Branch Power', 'EA', 0, NULL, 2.4, ARRAY['#1/0 motor termination','motor termination #1/0']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('FUSE-200', '200A fuse, 250V time delay class RK5 (Chris BOM)', 'Service & Distribution', 'EA', 61.72, NULL, 0.1, ARRAY['200a fuse','200a fuse 250v time delay - class rk5']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('PP-SET', 'Power pole — set and wire (Chris BOM)', 'Branch Power', 'EA', 650, NULL, 3.5, ARRAY['power pole set and wire','power pole, set and wire']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('DEV-SIMPLEX', 'Single (simplex) receptacle 20A w/ plate (Chris BOM)', 'Branch Power', 'EA', 20.31, NULL, 0.23, ARRAY['simplex','simplex receptacle','single receptacle','20a single receptacle']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('FAN-CEIL', 'Ceiling fan — hang and connect (Chris BOM)', 'Branch Power', 'EA', 65, NULL, 2.5, ARRAY['ceiling fan','ceiling fans','hang fans','hang fan','ceiling fans w/ wall speed controller']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LTG-POLE-30', 'Steel light pole, 30 ft and taller, on base (Chris BOM; material — confirm)', 'Exterior / Site Lighting', 'EA', 0, NULL, 6.8, ARRAY['30 ft light pole','30'' light pole','light pole 30 ft']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('POLE-ANCHOR', 'Pole anchor-bolt set + template, base by others (Chris BOM)', 'Exterior / Site Lighting', 'EA', 0, NULL, 1.18, ARRAY['anchor bolt set','pole anchor bolts','anchor bolt template']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('RISER-PIPEPOLE', 'Pipe pole / raceway riser, 3" PVC to deck (default — confirm)', 'Branch Power', 'EA', 0, NULL, 1.5, ARRAY['pipe pole','3" pvc data/security pipes','pvc data/security pipes','data/security pipe pole']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assemblies (code, name, category, unit, aliases, source, active)
VALUES ('ASM-SW200F', '200A fusible safety switch w/ 3 fuses, installed (Chris BOM)', 'Service & Distribution', 'EA', ARRAY['200a fused switch','200a fusible switch','200a fused disconnect','200a fused switch nema 3r','200a fusible safety switch']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 1
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SW200F' AND it.code = 'DISC-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
SELECT asm.id, it.id, 3
FROM est_assemblies asm, est_items it
WHERE asm.code = 'ASM-SW200F' AND it.code = 'FUSE-200'
ON CONFLICT (assembly_id, item_id) DO NOTHING;
