-- Remodel + footage round, Builder B — review fix rounds. The amendments
-- that used to be edited INTO 150/151 live here instead: the migration
-- runner keys on filename, so a database that already ran 150/151 (the test
-- DB; any dev DB) would never have received them. Idempotent: every
-- statement is a no-op the second time.

-- 1. SF-1 — the demolition items' bare-noun aliases ('fluorescent',
--    'receptacle', …). Safe because the mapper only ever considers a
--    demolition item for a demolition line. Adds only the missing aliases
--    to an untouched seed row (an estimator-edited row — source <> 'seed' —
--    is never changed).
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['fluorescent','demolition — 2x4 fluorescent fixture','demolition — 2x4 fluorescent','demolition — fluorescent fixture','demolition — lighting fixture','demolition — light fixture','demolition - luminaire modular fluorescent up to 2x4','demo fluorescent fixture']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-FLUOR24' AND source = 'seed' AND NOT (aliases @> ARRAY['fluorescent','demolition — 2x4 fluorescent fixture','demolition — 2x4 fluorescent','demolition — fluorescent fixture','demolition — lighting fixture','demolition — light fixture','demolition - luminaire modular fluorescent up to 2x4','demo fluorescent fixture']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['hid','high bay','demolition — hid high bay','demolition — high bay fixture','demolition — high bay','demolition - luminaire high bay w/ lens hid','demo hid high bay']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-HIDHB' AND source = 'seed' AND NOT (aliases @> ARRAY['hid','high bay','demolition — hid high bay','demolition — high bay fixture','demolition — high bay','demolition - luminaire high bay w/ lens hid','demo hid high bay']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['exit','emergency','demolition — exit sign','demolition — exit light','demolition — emergency light','demolition — exit/emergency','demolition - exit light w/ head(s) & battery unit emergency lighting']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-EXITEM' AND source = 'seed' AND NOT (aliases @> ARRAY['exit','emergency','demolition — exit sign','demolition — exit light','demolition — emergency light','demolition — exit/emergency','demolition - exit light w/ head(s) & battery unit emergency lighting']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['receptacle','gfci','demolition — receptacle','demolition — duplex receptacle','demolition — gfci receptacle','demolition - receptacle 3 wire up to 20a','demo receptacle']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-RECEPT' AND source = 'seed' AND NOT (aliases @> ARRAY['receptacle','gfci','demolition — receptacle','demolition — duplex receptacle','demolition — gfci receptacle','demolition - receptacle 3 wire up to 20a','demo receptacle']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['single pole','1-pole','demolition — single pole switch','demolition — 1-pole switch','demolition — switch 1 pole','demolition - switch 1 pole']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-SW1P' AND source = 'seed' AND NOT (aliases @> ARRAY['single pole','1-pole','demolition — single pole switch','demolition — 1-pole switch','demolition — switch 1 pole','demolition - switch 1 pole']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['3-way','three way','demolition — 3-way switch','demolition — three way switch','demolition — switch 3 way','demolition - switch 3 way']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-SW3W' AND source = 'seed' AND NOT (aliases @> ARRAY['3-way','three way','demolition — 3-way switch','demolition — three way switch','demolition — switch 3 way','demolition - switch 3 way']::text[]);
UPDATE est_items SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || ARRAY['junction box','j-box','demolition — junction box','demolition — j-box','demolition - junction box']::text[]) AS a ORDER BY a), updated_at = now()
 WHERE code = 'DEMO-JBOX' AND source = 'seed' AND NOT (aliases @> ARRAY['junction box','j-box','demolition — junction box','demolition — j-box','demolition - junction box']::text[]);

-- 2. Q5 — the equipment / general-expense default rule refitted on the
--    2025–26 breakdowns only (Jake's rule). Replaces the value 151 seeded
--    ONLY when it is still exactly that original seed (an edited rule is
--    never overwritten).
UPDATE app_settings
   SET value = '{"version":1,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500}}'
 WHERE key = 'est_cost_line_defaults'
   AND value = '{"version":1,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":4.03,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":290,"perHour":0,"minimum":3060}}';

-- 3. BL-1 — every bid that exists now is marked "defaults handled" for both
--    kinds, so an equipment / general-expense default is only ever seeded on
--    a bid created afterwards (the code also gates on bids.stage = 'due').
INSERT INTO est_bid_cost_line_seeds (bid_id, kind)
SELECT b.id, k.kind FROM bids b CROSS JOIN (VALUES ('equipment'), ('general_expense')) AS k(kind)
ON CONFLICT (bid_id, kind) DO NOTHING;
