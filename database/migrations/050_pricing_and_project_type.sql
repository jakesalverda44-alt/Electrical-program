-- Add project type and square footage to bids
ALTER TABLE bids ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS sq_ft INTEGER;

-- Store Pricing step output per bid
CREATE TABLE IF NOT EXISTS bid_estimates (
  bid_id         UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  overhead_pct   NUMERIC(5,2)  NOT NULL DEFAULT 10,
  profit_pct     NUMERIC(5,2)  NOT NULL DEFAULT 15,
  line_items     JSONB NOT NULL DEFAULT '[]',
  subtotals      JSONB NOT NULL DEFAULT '{}',
  total_direct   NUMERIC(12,2) DEFAULT 0,
  total_overhead NUMERIC(12,2) DEFAULT 0,
  total_profit   NUMERIC(12,2) DEFAULT 0,
  grand_total    NUMERIC(12,2) DEFAULT 0,
  comp_count     INTEGER DEFAULT 0,
  confidence     TEXT DEFAULT 'LOW',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
