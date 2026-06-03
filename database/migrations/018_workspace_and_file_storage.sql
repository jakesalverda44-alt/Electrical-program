-- P0: Persist preconstruction workspace state across page refreshes
CREATE TABLE IF NOT EXISTS bid_workspaces (
  bid_id             UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  step               TEXT    DEFAULT 'intake',
  active_tab         TEXT    DEFAULT 'overview',
  notes              TEXT    DEFAULT '',
  scope              JSONB   DEFAULT '{}',
  rfis               JSONB   DEFAULT '[]',
  files              JSONB   DEFAULT '[]',
  ai_done            BOOLEAN DEFAULT false,
  proposal_generated BOOLEAN DEFAULT false,
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- P0: Add file binary storage to documents (base64-encoded)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data TEXT;
