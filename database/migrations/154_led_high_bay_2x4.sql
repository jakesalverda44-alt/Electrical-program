-- Price accuracy round (docs/superpowers/plans/2026-09-29-price-accuracy-round.md),
-- Builder C, C2 — a 2x4 LED high-bay unit for the fixture the estimator
-- names in the takeoff review (36th Street type H: "LED high bay 2x4").
-- Labor straight off Chris's 36th Street BOM row "2' x 4' Luminaire Modular
-- Flat Lens - LED Integral Lamp (High Bay)" at 1.000 h/E. Same row as
-- backend/src/estimating/seed/laborUnits.ts LTG-HIBAY24. Insert-only.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LTG-HIBAY24', 'LED high bay, 2x4 flat lens', 'Interior Lighting', 'EA', 175, NULL, 1.0,
   ARRAY['led high bay 2x4','2x4 led high bay','high bay 2x4','2x4 high bay','luminaire modular flat lens led integral lamp high bay']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
