-- Fix round 2 / S16 + N13 — the 7-Eleven auto-deduct alternate's own label
-- (migration 129) said "...deduct %AMOUNT%..." INSIDE its text, but
-- composeProposal.ts's formatAlternateBullet already prefixes every
-- deduct-kind alternate with "DEDUCT $X.XX — " before printing the
-- description — so the proposal printed "DEDUCT $X.XX — ... deduct $X.XX
-- ..." with the dollar figure (and the word) twice. The label is reworded
-- to describe the scenario without stating the amount itself; %AMOUNT% is
-- dropped from the text entirely (formatAutoDeductLabel's replace() is a
-- safe no-op on a label with no token to replace).
--
-- N13 — guarded on `terms`, `notes` AND the auto_deduct_alternate label
-- ALL still matching the migration 129 seed, not `terms` alone the way
-- 129's own guard did: an admin who hand-edited any one of these three
-- fields (Settings -> Account Rules) since 129 ran keeps their edit; this
-- only touches a row that's untouched since then. Migration 129 itself is
-- left alone (already applied everywhere; migrations are never edited after
-- release) — this is the going-forward pattern for a guarded seed update
-- that changes one field of a JSONB blob without silently overwriting a
-- hand edit to any of its siblings.
UPDATE account_rules
   SET auto_deduct_alternate = jsonb_set(
         auto_deduct_alternate,
         '{label}',
         '"If the Graybar package (fixtures, panels, switchgear, SPD, receptacles, disconnects) is furnished by others through the Graybar 7-Eleven national account instead of APT — installation remains in APT scope."'::jsonb
       ),
       updated_at = now()
 WHERE name = '7-Eleven'
   AND terms = '{
         "lighting": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "panels": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "disconnects": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "other_equipment": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"}
       }'::jsonb
   AND notes = 'Graybar 7-Eleven national account (Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com): fixtures, panels, switchgear, SPD, receptacles and disconnects are APT furnish & install. An auto deduct alternate prices the option of the Graybar package being furnished by others instead (material + material markup + tax of those items; installation labor is never deducted).'
   AND auto_deduct_alternate->>'label' = 'If the Graybar package (fixtures, panels, switchgear, SPD, receptacles, disconnects) is furnished by others through the Graybar 7-Eleven national account, deduct %AMOUNT% — installation remains in APT scope.';
