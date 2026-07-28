-- Bid comparison: store parsed takeoff quantities and Accubid cost breakdowns per bid
-- so a new bid can be compared against similar past jobs (same brand/type, nearest sq ft).

-- Brand / prototype (e.g. "AutoZone", "7-Eleven", "El Car Wash"). Chain stores are built
-- to near-identical prototypes, so a same-brand comp is far more accurate than same-type.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS brand TEXT;
CREATE INDEX IF NOT EXISTS idx_bids_brand ON bids (brand) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bids_project_type ON bids (project_type) WHERE deleted_at IS NULL;

-- Parsed quantity takeoff. categories holds the per-category rollup used for the
-- comparison table; line_items holds every parsed row for the drill-down view.
CREATE TABLE IF NOT EXISTS bid_takeoffs (
  bid_id        UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  categories    JSONB NOT NULL DEFAULT '[]',
  line_items    JSONB NOT NULL DEFAULT '[]',
  item_count    INTEGER DEFAULT 0,
  source_file   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Cost breakdown parsed from an Accubid "Breakdown" PDF export. Optional — bids
-- without one still compare on total, sq ft and takeoff quantities.
CREATE TABLE IF NOT EXISTS bid_cost_breakdown (
  bid_id            UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  material_total    NUMERIC(12,2),
  labor_total       NUMERIC(12,2),
  equipment_total   NUMERIC(12,2),
  quotes_total      NUMERIC(12,2),
  prime_cost        NUMERIC(12,2),
  total_overhead    NUMERIC(12,2),
  total_markup      NUMERIC(12,2),
  selling_price     NUMERIC(12,2),
  labor_hours       NUMERIC(10,2),
  journeyman_hours  NUMERIC(10,2),
  apprentice_hours  NUMERIC(10,2),
  avg_labor_rate    NUMERIC(8,2),
  avg_crew_size     NUMERIC(6,2),
  labor_risk_ratio  NUMERIC(6,2),
  source_file       TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
