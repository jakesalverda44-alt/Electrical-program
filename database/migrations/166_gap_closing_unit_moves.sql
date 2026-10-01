-- Gap-closing round T11 — the approved labor-unit moves (Jake 2026-10-01 "Do default": J5, J6, J7 (strip, downlight,
-- exit, troffers), J8 (duplex, GFCI, toggles), J10 (MC-1202), and the five accuracy-round decision-1 moves carried
-- here so they land AFTER the library history (migration 164) exists).
-- Every row: only an untouched seed row moves (source = 'seed', never Accubid-reconciled — the 156 guard); migration
-- 164's trigger writes the old row to est_item_history first, so a submitted / sold bid keeps pricing at the old unit
-- (getLibraryForBid → libraryAsOf). Idempotent (the `<> new` guard). Each value is cited per row in
-- backend/src/estimating/seed/laborUnits.ts and checked by seedUnitsVsChris.test.ts; the replay mirrors this list
-- exactly (eval/gapMigrations.ts GAP_UNIT_MOVES, checked by gapMigrations.test.ts).
SELECT set_config('app.library_change', 'migration 166 (gap-closing unit moves)', true);

-- J5 — kissimmee: #3/0 Black Wire THHN 872 M × 18.8 h/M: 16.5 → 18.8
UPDATE est_items SET labor_hours = 18.8, updated_at = now()
 WHERE code = 'THHN-3_0' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 18.8;

-- J5 — kissimmee: #6 Black / Green Wire THHN 8.9 h/M: 7.0 → 8.9
UPDATE est_items SET labor_hours = 8.9, updated_at = now()
 WHERE code = 'THHN-6' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 8.9;

-- J6 — kissimmee: 225A 42-Circuit Panelboard MLO Surface Mount 3.6 h (flush = PNL-225F 4.5 h, migration 165): 8.0 → 3.6
UPDATE est_items SET labor_hours = 3.6, updated_at = now()
 WHERE code = 'PNL-225' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 3.6;

-- J7 — kissimmee: 4' Luminaire Linear Wraparound 0.75 h: 0.65 → 0.75
UPDATE est_items SET labor_hours = 0.75, updated_at = now()
 WHERE code = 'LTG-STRIP4' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.75;

-- J7 — kissimmee: 5" Luminaire Recessed Downlight 0.9 h: 0.6 → 0.9
UPDATE est_items SET labor_hours = 0.9, updated_at = now()
 WHERE code = 'LTG-DOWN' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.9;

-- J7 — kissimmee / 36th: Exit Light Single Face Surface Mount 0.55 h: 0.6 → 0.55
UPDATE est_items SET labor_hours = 0.55, updated_at = now()
 WHERE code = 'LTG-EXIT' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.55;

-- J7 — 36th: 2x4 recessed troffer 0.7 h: 0.75 → 0.7
UPDATE est_items SET labor_hours = 0.7, updated_at = now()
 WHERE code = 'LTG-TROF24' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.7;

-- J7 — 36th: 2x2 troffer 0.6 h: 0.7 → 0.6
UPDATE est_items SET labor_hours = 0.6, updated_at = now()
 WHERE code = 'LTG-TROF22' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.6;

-- J8 — kissimmee: Duplex Receptacle 20 h/C + Duplex Receptacle Wallplate 3 h/C: 0.35 → 0.23
UPDATE est_items SET labor_hours = 0.23, updated_at = now()
 WHERE code = 'DEV-DUP' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.23;

-- J8 — kissimmee: GFCI Duplex Receptacle 25 h/C + Decorator Wallplate 3 h/C: 0.4 → 0.28
UPDATE est_items SET labor_hours = 0.28, updated_at = now()
 WHERE code = 'DEV-GFCI' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.28;

-- J8 — 36th: 20A Toggle Switch Single Pole 18 h/C + Toggle Switch Wallplate 3 h/C: 0.3 → 0.21
UPDATE est_items SET labor_hours = 0.21, updated_at = now()
 WHERE code = 'SW-1P' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.21;

-- J8 — orlando-clubhouse: 20A Toggle Switch Three Way 24 h/C + Toggle Switch Wallplate 3 h/C: 0.35 → 0.27
UPDATE est_items SET labor_hours = 0.27, updated_at = now()
 WHERE code = 'SW-3W' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 0.27;

-- J10 — kissimmee / 36th: #12/2C MC Cable 15.2 h/M = 1.52 h/C: 2.5 → 1.52
UPDATE est_items SET labor_hours = 1.52, updated_at = now()
 WHERE code = 'MC-1202' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 1.52;

-- decision 1 (accuracy round) — Chris 30A safety switch 1.10 h: 1.5 → 1.1
UPDATE est_items SET labor_hours = 1.1, updated_at = now()
 WHERE code = 'DISC-30' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 1.1;

-- decision 1 — kissimmee: 60A Safety Switch NF 3R 1.55 h: 2.0 → 1.55
UPDATE est_items SET labor_hours = 1.55, updated_at = now()
 WHERE code = 'DISC-60' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 1.55;

-- decision 1 — kissimmee: 200A Safety Switch Fusible 3.1 h: 4.5 → 3.1
UPDATE est_items SET labor_hours = 3.1, updated_at = now()
 WHERE code = 'DISC-200' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 3.1;

-- decision 1 — kissimmee: 20' Pole Round Steel 4.8 h: 4.5 → 4.8
UPDATE est_items SET labor_hours = 4.8, updated_at = now()
 WHERE code = 'LTG-POLE' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 4.8;

-- decision 1 — kissimmee: Luminaire Pole Top/Arm Mount up to 250W 2.2 h: 1.2 → 2.2
UPDATE est_items SET labor_hours = 2.2, updated_at = now()
 WHERE code = 'LTG-POLEHEAD' AND source = 'seed' AND accubid_reconciled_at IS NULL AND labor_hours <> 2.2;
