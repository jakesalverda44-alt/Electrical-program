-- Next round Part B, Task 2/3 — the Accubid-style recap mode and the
-- Labor & Pricing screen's Crew / Quotes / Equipment / General Expenses /
-- Alternates sections. All additive.

-- ── Pricing mode (Decision B2: accubid is the default for a NEW bid; an
-- existing saved estimate keeps phase_a unless the estimator switches it) ───
ALTER TABLE est_bid_settings ADD COLUMN IF NOT EXISTS pricing_mode TEXT;
-- Backfill BEFORE setting a default, so ADD COLUMN's own backfill (which
-- would apply the eventual default to every existing row) never runs —
-- every row that already exists predates the new engine and stays phase_a.
UPDATE est_bid_settings SET pricing_mode = 'phase_a' WHERE pricing_mode IS NULL;
ALTER TABLE est_bid_settings ALTER COLUMN pricing_mode SET DEFAULT 'accubid';
ALTER TABLE est_bid_settings ALTER COLUMN pricing_mode SET NOT NULL;
ALTER TABLE est_bid_settings DROP CONSTRAINT IF EXISTS est_bid_settings_pricing_mode_check;
ALTER TABLE est_bid_settings ADD CONSTRAINT est_bid_settings_pricing_mode_check
  CHECK (pricing_mode IN ('phase_a', 'accubid'));

-- ── Per-bid Accubid settings: crew (day/night), burden/fringe, and the
-- overhead/markup/adjustment/sales-markup percentages the recap uses. ───────
CREATE TABLE IF NOT EXISTS est_accubid_settings (
  bid_id                  UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  shift                   TEXT NOT NULL DEFAULT 'day',
  journeyman_count        NUMERIC(6,2) NOT NULL DEFAULT 1,
  journeyman_rate         NUMERIC(8,2) NOT NULL DEFAULT 37.00,
  apprentice_count        NUMERIC(6,2) NOT NULL DEFAULT 2,
  apprentice_rate         NUMERIC(8,2) NOT NULL DEFAULT 27.00,
  foreman_count           NUMERIC(6,2) NOT NULL DEFAULT 0,
  foreman_rate            NUMERIC(8,2) NOT NULL DEFAULT 45.00,
  night_journeyman_rate   NUMERIC(8,2),
  night_apprentice_rate   NUMERIC(8,2),
  night_foreman_rate      NUMERIC(8,2),
  burden_pct              NUMERIC(6,2) NOT NULL DEFAULT 4,
  fringe_per_hr           NUMERIC(8,2) NOT NULL DEFAULT 1.50,
  material_tax_pct        NUMERIC(6,2) NOT NULL DEFAULT 0,
  labor_overhead_pct      NUMERIC(6,2) NOT NULL DEFAULT 38, -- Decision 5
  material_markup_pct     NUMERIC(6,2) NOT NULL DEFAULT 20,
  labor_markup_pct        NUMERIC(6,2) NOT NULL DEFAULT 20,
  quote_markup_default_pct NUMERIC(6,2) NOT NULL DEFAULT 18,
  adjustment_markup_pct   NUMERIC(6,2) NOT NULL DEFAULT 0,
  sales_markup_pct        NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE est_accubid_settings DROP CONSTRAINT IF EXISTS est_accubid_settings_shift_check;
ALTER TABLE est_accubid_settings ADD CONSTRAINT est_accubid_settings_shift_check
  CHECK (shift IN ('day', 'night'));

-- ── Vendor quotes: budget-pending blocks send (Chris's "hold until CES
-- gets back"). ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS est_bid_quotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_pct      NUMERIC(6,2) NOT NULL DEFAULT 0,
  markup_pct   NUMERIC(6,2) NOT NULL DEFAULT 18,
  status       TEXT NOT NULL DEFAULT 'budget_pending',
  vendor       TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE est_bid_quotes DROP CONSTRAINT IF EXISTS est_bid_quotes_status_check;
ALTER TABLE est_bid_quotes ADD CONSTRAINT est_bid_quotes_status_check
  CHECK (status IN ('firm', 'budget_pending'));
ALTER TABLE est_bid_quotes DROP CONSTRAINT IF EXISTS est_bid_quotes_amount_check;
ALTER TABLE est_bid_quotes ADD CONSTRAINT est_bid_quotes_amount_check CHECK (amount >= 0);
CREATE INDEX IF NOT EXISTS idx_est_bid_quotes_bid_id ON est_bid_quotes (bid_id);

-- ── Equipment and General Expenses (lifts, excavator, permits, temp power…). ─
CREATE TABLE IF NOT EXISTS est_bid_cost_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_pct      NUMERIC(6,2) NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE est_bid_cost_lines DROP CONSTRAINT IF EXISTS est_bid_cost_lines_kind_check;
ALTER TABLE est_bid_cost_lines ADD CONSTRAINT est_bid_cost_lines_kind_check
  CHECK (kind IN ('equipment', 'general_expense'));
ALTER TABLE est_bid_cost_lines DROP CONSTRAINT IF EXISTS est_bid_cost_lines_amount_check;
ALTER TABLE est_bid_cost_lines ADD CONSTRAINT est_bid_cost_lines_amount_check CHECK (amount >= 0);
CREATE INDEX IF NOT EXISTS idx_est_bid_cost_lines_bid_id ON est_bid_cost_lines (bid_id);

-- ── Alternates (add/deduct) — printed as separate proposal lines, never
-- change the base price. `auto`/`source_rule` mark a system-computed one
-- (e.g. the 7-Eleven Graybar-package auto deduct) so a re-sync can find and
-- refresh it without disturbing the estimator's own manual alternates. ──────
CREATE TABLE IF NOT EXISTS est_bid_alternates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  auto         BOOLEAN NOT NULL DEFAULT false,
  source_rule  TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE est_bid_alternates DROP CONSTRAINT IF EXISTS est_bid_alternates_kind_check;
ALTER TABLE est_bid_alternates ADD CONSTRAINT est_bid_alternates_kind_check
  CHECK (kind IN ('add', 'deduct'));
ALTER TABLE est_bid_alternates DROP CONSTRAINT IF EXISTS est_bid_alternates_amount_check;
ALTER TABLE est_bid_alternates ADD CONSTRAINT est_bid_alternates_amount_check CHECK (amount >= 0);
CREATE INDEX IF NOT EXISTS idx_est_bid_alternates_bid_id ON est_bid_alternates (bid_id);
-- At most one AUTO alternate per (bid, source_rule) — a re-sync updates it
-- in place instead of accumulating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_est_bid_alternates_auto_unique
  ON est_bid_alternates (bid_id, source_rule) WHERE auto;

-- ── Per-GC overhead default table (Settings — all 38% today, Decision 5). ───
CREATE TABLE IF NOT EXISTS est_gc_overhead_defaults (
  gc_name      TEXT PRIMARY KEY,
  overhead_pct NUMERIC(6,2) NOT NULL DEFAULT 38,
  updated_at   TIMESTAMPTZ DEFAULT now()
);
