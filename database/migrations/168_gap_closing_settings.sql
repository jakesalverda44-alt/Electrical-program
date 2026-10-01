-- Gap-closing round (docs/superpowers/plans/2026-09-30-gap-closing.md) — settings, Jake's decisions J9 / J10 / J13
-- (2026-10-01 "Do default"). Idempotent; an estimator-edited setting is never touched (only the untouched seeded
-- value moves, the 150 / 159 precedent). Every one of these rules applies only to a bid being estimated (due, or a
-- Calibration job): the code keeps submitted / sold bids on the rules they were priced with.
-- The replay mirrors this file exactly (eval/replayEval.ts settingAfterMigrations; gapMigrations.test.ts checks it).

-- J9 (T7) — receptacles map to the bare device when the branch footage allowance carries their raceway / wire / box.
INSERT INTO app_settings (key, value)
SELECT 'est_receptacle_device_only', 'true'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_receptacle_device_only');

-- J10 (T8) — MC whips per interior luminaire at Chris's 2026 practice (13.3 ft; Kissimmee 13.49, 36th 13.02), only
-- on the untouched migration-150 ratios.
UPDATE app_settings
   SET value = (value::jsonb || '{"mcBasis":"luminaire","mcPerLuminaire":13.3,"mcLuminaireSource":"Chris 2026 jobs (Kissimmee 13.49, 36th 13.02 ft per luminaire)"}'::jsonb)::text
 WHERE key = 'est_footage_ratios'
   AND value::jsonb = '{"version":1,"emtPerPoint":{"fixture":6.6,"device":6.6,"equipment":6.6},"mcPerFixture":7.89,"wirePerConduitFt":5.54,"baseConductors":3,"wire10Share":0.47,"pvcSitePerPole":130,"v2DisagreePct":40,"pointsPerCircuit":8,"items":{"emt":"3/4\" EMT (incl. couplings/straps)","wire12":"#12 THHN/THWN copper conductor","wire10":"#10 THHN/THWN copper conductor","mc":"12/2 MC cable","pvcSite":"1\" PVC Sch 40 (incl. fittings/glue)"},"calibratedOn":"5 of Chris''s jobs","looErrorPct":{"emt":35,"mc":22,"wire":37,"pvcSite":130}}'::jsonb;

-- J10 (T8) — the MC connector allowance per luminaire (ALW-FIT-MCLUM, migration 165), when the box / fitting setting
-- was never set (absent = the code defaults).
INSERT INTO app_settings (key, value)
SELECT 'est_box_fitting_allowance', '{"version":1,"mcConnectorBasis":"luminaire"}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_box_fitting_allowance');

-- J13 (T10) — the OxBlue construction-camera support GE line ($750, Chris Kissimmee) when a furnish statement says
-- the contractor provides the camera support; only on the untouched migration-159 v2 defaults.
UPDATE app_settings
   SET value = '{"version":2,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500},"items":{"scissorLift":1250,"boomLift":950,"miniExcavator":2150,"permits":270,"tempPower":1800,"tempLighting":950,"tempOverHours":300,"oxblueSupport":750}}'
 WHERE key = 'est_cost_line_defaults'
   AND value::jsonb = '{"version":2,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500},"items":{"scissorLift":1250,"boomLift":950,"miniExcavator":2150,"permits":270,"tempPower":1800,"tempLighting":950,"tempOverHours":300}}'::jsonb;
