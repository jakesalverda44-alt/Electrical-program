CREATE TABLE IF NOT EXISTS takeoff_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id        UUID REFERENCES bids(id) ON DELETE CASCADE,
  scope         JSONB DEFAULT '[]',
  materials     JSONB DEFAULT '[]',
  rfis          JSONB DEFAULT '[]',
  labor_estimate JSONB DEFAULT '{}',
  risk_flags    JSONB DEFAULT '[]',
  raw_response  TEXT,
  status        TEXT DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bid_id)
);
