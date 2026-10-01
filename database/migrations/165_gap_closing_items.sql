-- Gap-closing round T4 / T5 / T9 / T10 / J6 / J7 (docs/superpowers/plans/2026-09-30-gap-closing.md).
-- INSERT-ONLY: new library items at Chris's units, every one reached BY CODE only (mapper.ts ALIAS_ONLY_CODE_RE:
-- the mapper never lands on them by name or alias), so no existing row's mapping or price moves. Each value is
-- cited in backend/src/estimating/seed/laborUnits.ts (GAP_CLOSING_ITEMS) and checked by seedUnitsVsChris.test.ts.
-- They are created now (created_at), so a bid submitted before this migration never sees them (libraryAsOf).
-- Idempotent: ON CONFLICT DO NOTHING.

-- kissimmee: Polaris Taps 8 E x 1.2 h, $45.00
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('TAP-POLARIS', 'Polaris tap connector (Chris BOM)', 'Service & Distribution', 'EA', 45, NULL, 1.2, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- T4 (J4): the underground PVC labor adjustment row
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('ADJ-UG-HR', 'Labor adjustment — 1 EA = 1 h', 'Site / Underground / Allowances', 'EA', 0, NULL, 1, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Service Gutter 1 E x 6.0 h, $600.00
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('SVC-GUTTER', 'Service gutter / wireway (Chris BOM)', 'Service & Distribution', 'EA', 600, NULL, 6, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Grounding Materials 1 E x 6.0 h, $890.00
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('GND-SVC', 'Grounding materials, service (Chris BOM)', 'Grounding', 'EA', 890, NULL, 6, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Fire Rated Playwood 1 E x 4.0 h, $250.00
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('BKBD-FRT', 'Fire-rated plywood backboard (Chris BOM)', 'Low Voltage Infrastructure (Conduit & Boxes Only)', 'EA', 250, NULL, 4, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: #6 Wire Lug Compression 6 C x 15 h/C, $136.76/C
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LUG-6', '#6 compression lug, 1-hole (Chris BOM)', 'Service & Distribution', 'EA', 1.3676, NULL, 0.15, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- J6: flush 225A panel 4.5 h (Q8)
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('PNL-225F', 'Panelboard, 225A MLO, up to 42 circuits, flush mount', 'Service & Distribution', 'EA', 1450, NULL, 4.5, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Luminaire Wall Mount LED up to 175W 1.1 h (Quoted)
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LTG-WM175', 'Wall-mount LED luminaire, up to 175 W (Chris BOM)', 'Exterior / Site Lighting', 'EA', 145, NULL, 1.1, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Luminaire Wall Mount LED up to 250W 1.6 h (Quoted)
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LTG-WM250', 'Wall-mount LED luminaire, up to 250 W (Chris BOM)', 'Exterior / Site Lighting', 'EA', 145, NULL, 1.6, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: CMP #24-4 Pair 1,000 M x 8.6 h/M, $230/M (Quoted)
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LV-CMP244', 'Communication & control cable, CMP #24 4-pair (Chris BOM)', 'Lighting Controls', 'M', 230, NULL, 8.6, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- kissimmee: Misc Materials 1 E x 16.0 h, $1,500.00 (Q6)
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('ALW-MISC', 'Misc materials & labor allowance (Chris Kissimmee)', 'Branch Power', 'EA', 1500, NULL, 16, ARRAY[]::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
