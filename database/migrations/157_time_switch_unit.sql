-- Price accuracy round (docs/superpowers/plans/2026-09-29-price-accuracy-round.md),
-- Builder C, fix round 3 (review 1602517 N6 / N7). 156 is final as the test
-- DB ran it; this unit lands here. Insert-only, idempotent.
--
-- A 24-hour time switch (Chris's own row on the 36th Street BOM: "Time
-- Switch 24-Hour 120V DPST", 1.650 h/E, $150), so a "time switch / time
-- clock / astronomic" row has a control unit to match. No bare "timer
-- switch" alias: a countdown or fan timer is not this unit.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LC-TIMESW', 'Time switch, 24-hour', 'Lighting Controls', 'EA', 150, NULL, 1.65,
   ARRAY['time switch','time clock','24-hour time switch','astronomic','astronomic time switch','time switch 24-hour 120v dpst']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
