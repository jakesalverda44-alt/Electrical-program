CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linked_id    TEXT,
  linked_name  TEXT,
  div          TEXT DEFAULT 'general',
  name         TEXT NOT NULL,
  display_name TEXT,
  category     TEXT DEFAULT 'other',
  file_size    INT DEFAULT 0,
  file_type    TEXT DEFAULT '',
  storage_url  TEXT,
  uploaded_by  TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_linked_idx ON documents(linked_id);
