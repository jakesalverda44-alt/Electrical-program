-- Takeoff accuracy (docs/superpowers/plans/2026-09-23-takeoff-accuracy.md),
-- Task 8 — account rules (Decision 8). Admin-editable in Settings → Account
-- Rules. Matched per bid by brand / owner aliases (case-insensitive) and
-- optionally project type; the Default row applies when nothing matches.
--
-- terms: { lighting | panels | disconnects | power_poles | other_equipment :
--          { "mode": "fixed", "furnishBy": "APT|GC|Owner|Vendor|Others",
--            "installBy": ..., "vendor"?: text, "contact"?: text }
--        | { "mode": "ask" } }   (a term left out = the rule says nothing)
-- `ask` = taken from an explicit statement on the drawings, else a scope
-- question for the estimator. A fixed value never silently overrides a
-- contrary drawing statement — that becomes a scope question too.
CREATE TABLE IF NOT EXISTS account_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL UNIQUE,
  is_default              BOOLEAN NOT NULL DEFAULT false,
  match_aliases           TEXT[] NOT NULL DEFAULT '{}',
  project_types           TEXT[] NOT NULL DEFAULT '{}',
  priority                INTEGER NOT NULL DEFAULT 100,
  terms                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_scope_bullets  JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_phrases       TEXT[] NOT NULL DEFAULT '{}',
  no_mdp_unless_on_drawings BOOLEAN NOT NULL DEFAULT false,
  notes                   TEXT NOT NULL DEFAULT '',
  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_rules_one_default ON account_rules (is_default) WHERE is_default;

-- The terms settled for one analysis run (rule matched, drawing statements,
-- open scope questions) — the snapshot Agents 2/4 and composeBidData read.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS account_terms JSONB;

-- ── Seed (insert-if-absent by name) ─────────────────────────────────────────
-- Default: lighting ECFECI through Southern Lighting Source — moved here out
-- of the Agent 2/4 prompt text (PROJECT_INSTRUCTIONS.md §1).
INSERT INTO account_rules (name, is_default, priority, terms, notes)
SELECT 'Default', true, 1000,
  '{"lighting": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Southern Lighting Source national account", "contact": "770-242-4000"}}'::jsonb,
  'Applies when no account rule matches. Lighting ECFECI, procured through the Southern Lighting Source national account (770-242-4000).'
WHERE NOT EXISTS (SELECT 1 FROM account_rules WHERE name = 'Default');

-- AutoZone (every AutoZone — Jake, 2026-09-23, corrected from the Kissimmee
-- Accubid BOM): fixtures owner-furnished via the Graybar national account, EC
-- receives and installs; panelboards owner-furnished, EC installs;
-- disconnects / safety switches APT furnishes and installs (the BOM priced the
-- 200A fused and 60A non-fused as APT's); power poles ASK (explicit drawing
-- statement wins, else the estimator answers); no MDP language unless an MDP
-- is on the drawings.
INSERT INTO account_rules (name, match_aliases, priority, terms, no_mdp_unless_on_drawings, notes)
SELECT 'AutoZone', ARRAY['AutoZone', 'Auto Zone', 'AutoZone Stores'], 100,
  '{"lighting": {"mode": "fixed", "furnishBy": "Owner", "installBy": "APT", "vendor": "Graybar national account"},
    "panels": {"mode": "fixed", "furnishBy": "Owner", "installBy": "APT"},
    "disconnects": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT"},
    "power_poles": {"mode": "ask"}}'::jsonb,
  true,
  'All AutoZone stores. Fixtures and panelboards furnished by AutoZone (fixtures via Graybar); EC receives and installs. Disconnects APT-furnished per the estimator''s BOM. Power poles: from the drawings, else ask.'
WHERE NOT EXISTS (SELECT 1 FROM account_rules WHERE name = 'AutoZone');

-- 7-Eleven (PROJECT_INSTRUCTIONS.md §1 / §14): Graybar national account
-- (Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com), furnish by GC,
-- install by EC ("price base = install-only"). NOTE: §1's sentence reads
-- "furnish by GC / install by GC"; the plan's Decision 8 and §14's
-- install-only base both say EC installs — seeded as install by EC and
-- flagged in the takeoff-accuracy report for Jake to confirm. Switchgear, SPD
-- and receptacles are also GC-furnished per §1 (no dedicated term; noted).
INSERT INTO account_rules (name, match_aliases, priority, terms, notes)
SELECT '7-Eleven', ARRAY['7-Eleven', '7 Eleven', 'Seven Eleven', '7Eleven'], 100,
  '{"lighting": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT", "vendor": "Graybar national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
    "panels": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT"},
    "disconnects": {"mode": "fixed", "furnishBy": "GC", "installBy": "APT"}}'::jsonb,
  'Graybar national account (Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com), furnish by GC / install by EC on fixtures, panels, switchgear, SPD, receptacles and disconnects. Price base = install-only; alternate = APT carries the buy.'
WHERE NOT EXISTS (SELECT 1 FROM account_rules WHERE name = '7-Eleven');
