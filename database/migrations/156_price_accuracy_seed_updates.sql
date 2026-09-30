-- Price accuracy round (docs/superpowers/plans/2026-09-29-price-accuracy-round.md),
-- Builder C, fix round (review ceba1a4 S6 / S7). 155 is frozen; every later
-- change lands here. Idempotent: every statement is a no-op the second time.
--
-- Decision 2 (Jake's rule: labor units match Chris's Accubid) — #12 / #10
-- THHN at Chris's 5.150 / 5.650 h per M (every one of his five BOMs). Only an
-- untouched seed row moves: never a manual or calibrated row, and never a
-- row an Accubid import reconciled from a real BOM (accubid_reconciled_at —
-- that import keeps source = 'seed' on purpose, review round 2 N-R2-2).
UPDATE est_items SET labor_hours = 5.15, updated_at = now()
 WHERE code = 'THHN-12' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 5.15;
UPDATE est_items SET labor_hours = 5.65, updated_at = now()
 WHERE code = 'THHN-10' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 5.65;

-- Decision 5 — a pole-head alias so a site-lighting "fixture heads (N per
-- pole)" row comes back as a held (confirm) suggestion of the pole head.
-- Same guard.
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['pole fixture head']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'LTG-POLEHEAD' AND source = 'seed' AND accubid_reconciled_at IS NULL AND NOT (aliases @> ARRAY['pole fixture head']::text[]);

-- Fix round N1 — a time switch / time clock unit (Chris's own row on the
-- 36th Street BOM: "Time Switch 24-Hour 120V DPST", 1.650 h/E, $150), so a
-- "time switch for … lights" row has a control unit to match. Insert-only.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active) VALUES
  ('LC-TIMESW', 'Time switch, 24-hour', 'Lighting Controls', 'EA', 150, NULL, 1.65,
   ARRAY['time switch','time clock','timer switch','time switch 24-hour 120v dpst']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;
