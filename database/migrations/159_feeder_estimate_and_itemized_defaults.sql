-- Accuracy round (docs/superpowers/plans/2026-09-30-accuracy-round.md),
-- Builder P — settings. Idempotent.
--
-- C5 — the feeder estimate's heights and factors (Settings, editable):
-- gear exit 7 ft AFF, default deck 14 ft (flagged when used), wall equipment
-- 5 ft, roof penetration +3 ft, underground 2 ft burial + 3 ft stub-up per
-- end, makeup 3 ft per end, site route factor 1.15, gear closer than 15 ft
-- runs at the gear. Insert-if-absent.
INSERT INTO app_settings (key, value)
SELECT 'est_feeder_estimate', '{"version":1,"panelExitFt":7,"defaultDeckFt":14,"wallMountFt":5,"roofPenetrationFt":3,"burialFt":2,"stubUpFt":3,"makeupFt":3,"siteRouteFactor":1.15,"adjacentGearFt":15}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_feeder_estimate');

-- E4 — the default equipment / general-expense lines, itemized (settings
-- v2): scissor lift $1,250 always; towable boom lift $950 with site poles or
-- exterior mounting over 20 ft; mini excavator $2,150 with underground site
-- work; permits $270; temporary power $1,800 + temporary lighting $950 on a
-- new build or a job over 300 h (Chris's 2025–26 breakdowns; Kissimmee
-- reproduces $4,350 and $3,020 of $3,770 — the $750 camera pole is AutoZone's).
-- Only the untouched v1 value migration 151 seeded moves to v2 (an edited
-- setting stays the estimator's); the parser keeps reading v1.
UPDATE app_settings SET value = '{"version":2,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500},"items":{"scissorLift":1250,"boomLift":950,"miniExcavator":2150,"permits":270,"tempPower":1800,"tempLighting":950,"tempOverHours":300}}'
 WHERE key = 'est_cost_line_defaults' AND value::jsonb = '{"version":1,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500}}'::jsonb;
INSERT INTO app_settings (key, value)
SELECT 'est_cost_line_defaults', '{"version":2,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500},"items":{"scissorLift":1250,"boomLift":950,"miniExcavator":2150,"permits":270,"tempPower":1800,"tempLighting":950,"tempOverHours":300}}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_cost_line_defaults');
