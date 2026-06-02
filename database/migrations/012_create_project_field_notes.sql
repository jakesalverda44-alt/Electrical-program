CREATE TABLE IF NOT EXISTS project_field_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'electrical',
  note_date    DATE DEFAULT CURRENT_DATE,
  author       TEXT NOT NULL,
  note         TEXT NOT NULL,
  weather      TEXT DEFAULT '',
  crew_size    INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fn_project_idx ON project_field_notes(project_id);
