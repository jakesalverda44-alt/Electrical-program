CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  div TEXT,
  text TEXT NOT NULL,
  time_label TEXT DEFAULT 'Just now',
  created_at TIMESTAMPTZ DEFAULT now()
);
