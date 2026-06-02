CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  loc TEXT,
  gc TEXT,
  due TEXT,
  due_days INT DEFAULT 14,
  amount NUMERIC(12,2) DEFAULT 0,
  sheets INT DEFAULT 0,
  contact TEXT,
  stage TEXT NOT NULL DEFAULT 'due' CHECK (stage IN ('due','submitted','awarded','lost')),
  salesperson_id UUID REFERENCES users(id),
  salesperson_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
