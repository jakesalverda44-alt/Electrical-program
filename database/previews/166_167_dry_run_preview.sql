-- READ-ONLY dry-run preview for migrations 166 / 167 (gap-closing, review S6). Changes nothing.
-- Run against a copy of the live DB (psql -f) BEFORE deploying: it lists, per code, the row the migration WOULD move
-- (an untouched seed row: source = 'seed' and not Accubid-reconciled) and the old -> new value. Rows that show
-- would_move = false are skipped by the migration's guard (a manual / reconciled / already-at-value row).
-- Expect 19 unit rows (166, incl. LC-CONTACTOR 2.0 -> 1.0) and 10 price rows (167); after a real run in a transaction,
--   SELECT changed_by, count(*) FROM est_item_history GROUP BY 1;   -- 'migration 166 ...' / 'migration 167 ...'
-- gives the same counts, and ROLLBACK undoes it.

-- 166: labor-unit moves
SELECT m.code, i.labor_hours AS old_hours, m.new_hours,
       (i.source = 'seed' AND i.accubid_reconciled_at IS NULL AND i.labor_hours <> m.new_hours) AS would_move,
       i.source, i.accubid_reconciled_at IS NOT NULL AS reconciled
  FROM (VALUES
    ('THHN-3_0', 18.8::numeric),
    ('THHN-6', 8.9::numeric),
    ('PNL-225', 3.6::numeric),
    ('LTG-STRIP4', 0.75::numeric),
    ('LTG-DOWN', 0.9::numeric),
    ('LTG-EXIT', 0.55::numeric),
    ('LTG-TROF24', 0.7::numeric),
    ('LTG-TROF22', 0.6::numeric),
    ('DEV-DUP', 0.23::numeric),
    ('DEV-GFCI', 0.28::numeric),
    ('SW-1P', 0.21::numeric),
    ('SW-3W', 0.27::numeric),
    ('MC-1202', 1.52::numeric),
    ('DISC-30', 1.1::numeric),
    ('DISC-60', 1.55::numeric),
    ('DISC-200', 3.1::numeric),
    ('LTG-POLE', 4.8::numeric),
    ('LTG-POLEHEAD', 2.2::numeric),
    ('LC-CONTACTOR', 1.0::numeric)
  ) AS m(code, new_hours)
  LEFT JOIN est_items i ON i.code = m.code
 ORDER BY would_move DESC, m.code;

-- 167: material price refresh
SELECT m.code, i.material_cost AS old_cost, m.new_cost,
       (i.source = 'seed' AND i.accubid_reconciled_at IS NULL
         AND (i.material_cost <> m.new_cost OR i.material_price_date IS DISTINCT FROM DATE '2026-06-18')) AS would_move,
       i.source, i.accubid_reconciled_at IS NOT NULL AS reconciled
  FROM (VALUES
    ('THHN-12', 208.0::numeric),
    ('THHN-10', 329.7::numeric),
    ('THHN-6', 895.5::numeric),
    ('THHN-3_0', 4735.0::numeric),
    ('EMT-075', 92.38::numeric),
    ('EMT-100', 157.82::numeric),
    ('PVC-100', 51.82::numeric),
    ('PVC-200', 105.68::numeric),
    ('MC-1202', 74.52::numeric),
    ('LC-CONTACTOR', 133.33::numeric)
  ) AS m(code, new_cost)
  LEFT JOIN est_items i ON i.code = m.code
 ORDER BY would_move DESC, m.code;
