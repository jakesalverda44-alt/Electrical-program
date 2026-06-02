CREATE TABLE IF NOT EXISTS project_sections (
  project_id   UUID NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'electrical',
  section      TEXT NOT NULL,
  data         JSONB DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, section)
);
