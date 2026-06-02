CREATE TABLE IF NOT EXISTS project_change_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'electrical',
  number       INT NOT NULL,
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) DEFAULT 0,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS co_project_idx ON project_change_orders(project_id);
