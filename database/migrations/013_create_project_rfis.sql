CREATE TABLE IF NOT EXISTS project_rfis (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL,
  project_type   TEXT NOT NULL DEFAULT 'electrical',
  rfi_number     TEXT NOT NULL,
  question       TEXT NOT NULL,
  submitted_to   TEXT DEFAULT '',
  submitted_date DATE,
  due_date       DATE,
  status         TEXT DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  answer         TEXT DEFAULT '',
  answered_date  DATE,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfi_project_idx ON project_rfis(project_id);
