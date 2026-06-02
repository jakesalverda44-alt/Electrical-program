CREATE TABLE IF NOT EXISTS communications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  div         TEXT NOT NULL DEFAULT 'general',
  subject     TEXT NOT NULL,
  body        TEXT DEFAULT '',
  linked_id   TEXT,
  linked_name TEXT,
  author      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comms_created_idx ON communications(created_at DESC);
