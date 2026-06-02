CREATE TABLE won_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_name TEXT NOT NULL,
  customer TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('Electrical','Generator')),
  value NUMERIC(12,2) DEFAULT 0,
  date_won DATE NOT NULL DEFAULT CURRENT_DATE,
  salesperson_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proposal_id)
);
