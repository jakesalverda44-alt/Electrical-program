-- Next round Part B, coordinator follow-up (Jake, mid-run) — the 7-Eleven
-- account rule default changes: fixtures, panels, switchgear, SPD,
-- receptacles and disconnects are now APT furnish & install, procured
-- through the Graybar 7-Eleven national account (Anson Sauce, 817-475-0178,
-- 7-eleven.national@graybar.com). The prior "furnished by GC" wording is
-- gone. Switchgear/SPD/receptacles have no dedicated term key (see
-- bidstd/accountRules.ts's TermKey) — carried on `other_equipment`, same as
-- migration 114's original note did for switchgear/SPD.
--
-- Guarded exactly like every other seed tweak in this codebase: the UPDATE
-- only fires when the row's terms are STILL the migration-114 original — an
-- admin's own edit (Settings -> Account Rules) is never overwritten.
ALTER TABLE account_rules ADD COLUMN IF NOT EXISTS auto_deduct_alternate JSONB;

UPDATE account_rules
   SET terms = '{
         "lighting": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "panels": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "disconnects": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
         "other_equipment": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"}
       }'::jsonb,
       auto_deduct_alternate = '{
         "enabled": true,
         "termKeys": ["lighting", "panels", "disconnects", "other_equipment"],
         "taxable": false,
         "label": "If the Graybar package (fixtures, panels, switchgear, SPD, receptacles, disconnects) is furnished by others through the Graybar 7-Eleven national account, deduct %AMOUNT% — installation remains in APT scope."
       }'::jsonb,
       notes = 'Graybar 7-Eleven national account (Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com): fixtures, panels, switchgear, SPD, receptacles and disconnects are APT furnish & install. An auto deduct alternate prices the option of the Graybar package being furnished by others instead (material + material markup + tax of those items; installation labor is never deducted).',
       updated_at = now()
 WHERE name = '7-Eleven'
   AND terms = '{"lighting": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT", "vendor": "Graybar national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
    "panels": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT"},
    "disconnects": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT"}}'::jsonb;
