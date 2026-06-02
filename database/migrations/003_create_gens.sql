CREATE TABLE generator_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer TEXT NOT NULL,
  loc TEXT,
  mfr TEXT,
  model TEXT,
  kw NUMERIC(8,2),
  amount NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'building' CHECK (stage IN ('building','sent','awarded')),
  built_on TEXT DEFAULT 'Just now',
  addons INT DEFAULT 0,
  salesperson_id UUID REFERENCES users(id),
  salesperson_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
