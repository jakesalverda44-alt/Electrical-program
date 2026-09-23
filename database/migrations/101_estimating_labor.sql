-- Estimating labor engine (Phase A), Task 1 — schema only, no data.
-- See docs/superpowers/plans/2026-09-22-estimating-labor-engine-and-redesign.md.
--
-- est_items / est_assemblies / est_assembly_components / est_labor_factors form
-- the labor+material library. est_bid_lines is a bid's own priced lines (built
-- from the takeoff via the mapper, or added manually). est_bid_settings holds
-- the per-bid pricing knobs (labor rate, factors, tax/OH/profit). None of this
-- replaces bid_estimates / bids.amount — the new engine WRITES those, same as
-- today's flat-rate estimates.ts does (see Task 5).

-- ── Library: items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS est_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  unit                TEXT NOT NULL,
  material_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
  material_price_date DATE,
  labor_hours         NUMERIC(10,4) NOT NULL DEFAULT 0,
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  source              TEXT NOT NULL DEFAULT 'manual',
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE est_items DROP CONSTRAINT IF EXISTS est_items_source_check;
ALTER TABLE est_items ADD CONSTRAINT est_items_source_check
  CHECK (source IN ('seed','accubid','manual','calibrated'));

ALTER TABLE est_items DROP CONSTRAINT IF EXISTS est_items_unit_check;
ALTER TABLE est_items ADD CONSTRAINT est_items_unit_check
  CHECK (unit IN ('EA','LF','C','M'));

ALTER TABLE est_items DROP CONSTRAINT IF EXISTS est_items_labor_hours_check;
ALTER TABLE est_items ADD CONSTRAINT est_items_labor_hours_check
  CHECK (labor_hours >= 0);

-- ── Library: assemblies ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS est_assemblies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'manual',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE est_assemblies DROP CONSTRAINT IF EXISTS est_assemblies_source_check;
ALTER TABLE est_assemblies ADD CONSTRAINT est_assemblies_source_check
  CHECK (source IN ('seed','accubid','manual','calibrated'));

ALTER TABLE est_assemblies DROP CONSTRAINT IF EXISTS est_assemblies_unit_check;
ALTER TABLE est_assemblies ADD CONSTRAINT est_assemblies_unit_check
  CHECK (unit IN ('EA','LF','C','M'));

-- ── Library: assembly components (qty of an item per 1 assembly unit) ───────
CREATE TABLE IF NOT EXISTS est_assembly_components (
  assembly_id UUID NOT NULL REFERENCES est_assemblies(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES est_items(id) ON DELETE CASCADE,
  qty_per     NUMERIC(12,4) NOT NULL,
  PRIMARY KEY (assembly_id, item_id)
);

ALTER TABLE est_assembly_components DROP CONSTRAINT IF EXISTS est_assembly_components_qty_per_check;
ALTER TABLE est_assembly_components ADD CONSTRAINT est_assembly_components_qty_per_check
  CHECK (qty_per >= 0);

-- ── Library: named labor multipliers ────────────────────────────────────────
-- Factors sharing a group_key are mutually exclusive (e.g. working-height
-- bands) — enforced in the pricing engine / UI, not by a DB constraint, since
-- SQL can't cheaply express "at most one active selection per group" across
-- an ad-hoc factor_ids[] selection on est_bid_settings.
CREATE TABLE IF NOT EXISTS est_labor_factors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  pct        NUMERIC(6,2) NOT NULL,
  group_key  TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Per-bid priced lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS est_bid_lines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id                 UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  sort                   INTEGER NOT NULL DEFAULT 0,
  category               TEXT NOT NULL,
  description            TEXT NOT NULL,
  qty                    NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit                   TEXT NOT NULL,
  assembly_id            UUID REFERENCES est_assemblies(id) ON DELETE SET NULL,
  item_id                UUID REFERENCES est_items(id) ON DELETE SET NULL,
  -- Stable key back to the takeoff line this row was built from:
  -- `${category}||${item}`, same shape as bid_workspaces.estimate_overrides —
  -- lets sync-takeoff (Task 5) re-match a row after a re-run without losing
  -- the estimator's edits.
  takeoff_key            TEXT,
  material_unit_override NUMERIC(12,4),
  labor_hours_override   NUMERIC(10,4),
  confidence             TEXT,
  excluded               BOOLEAN NOT NULL DEFAULT false,
  source                 TEXT NOT NULL DEFAULT 'manual',
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- Exactly one or neither of assembly_id/item_id — never both. A line with
-- neither is a manual, typed-in line (material_unit_override /
-- labor_hours_override carry its numbers) or an unmatched takeoff line
-- awaiting resolution.
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_one_ref_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_one_ref_check
  CHECK (NOT (assembly_id IS NOT NULL AND item_id IS NOT NULL));

ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_confidence_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_confidence_check
  CHECK (confidence IS NULL OR confidence IN ('FIRM','APPROX','VERIFY'));

ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_source_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_source_check
  CHECK (source IN ('takeoff','manual'));

CREATE INDEX IF NOT EXISTS idx_est_bid_lines_bid_id ON est_bid_lines (bid_id);

-- ── Per-bid pricing settings ─────────────────────────────────────────────────
-- crew_size isn't in the plan's explicit field list for this table but is
-- required by the pricing engine's crew_weeks output (Task 3: "crew_size from
-- settings (default 3)") — added here as a per-bid override of the same shape
-- as labor_rate, rather than inventing a separate app_settings key for it.
CREATE TABLE IF NOT EXISTS est_bid_settings (
  bid_id           UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  labor_rate       NUMERIC(8,2) NOT NULL DEFAULT 38.00,
  factor_ids       UUID[] NOT NULL DEFAULT '{}',
  material_tax_pct NUMERIC(6,2) NOT NULL DEFAULT 7,
  small_tools_pct  NUMERIC(6,2) NOT NULL DEFAULT 3,
  supervision_pct  NUMERIC(6,2) NOT NULL DEFAULT 0,
  consumables_pct  NUMERIC(6,2) NOT NULL DEFAULT 2,
  overhead_pct     NUMERIC(6,2) NOT NULL DEFAULT 10,
  profit_pct       NUMERIC(6,2) NOT NULL DEFAULT 15,
  crew_size        NUMERIC(6,2) NOT NULL DEFAULT 3,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── App settings defaults (insert-if-absent; never overwrite an existing value) ──
INSERT INTO app_settings (key, value)
SELECT 'est_default_labor_rate',
       COALESCE(
         (SELECT ROUND(AVG(avg_labor_rate), 2)::text FROM bid_cost_breakdown WHERE avg_labor_rate IS NOT NULL),
         '38.00'
       )
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_labor_rate');

INSERT INTO app_settings (key, value)
SELECT 'est_default_material_tax_pct', '7'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_material_tax_pct');

INSERT INTO app_settings (key, value)
SELECT 'est_default_small_tools_pct', '3'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_small_tools_pct');

INSERT INTO app_settings (key, value)
SELECT 'est_default_supervision_pct', '0'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_supervision_pct');

INSERT INTO app_settings (key, value)
SELECT 'est_default_consumables_pct', '2'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_consumables_pct');
