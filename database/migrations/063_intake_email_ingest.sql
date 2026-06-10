-- 063_intake_email_ingest.sql
-- Automates the Intake Inbox by ingesting "new bid"-tagged Outlook emails. Adds the
-- columns needed to store the source email (for dedupe + one-click open) and the
-- lightly-parsed review fields. Dedupe is enforced on the Graph message id so the same
-- email is never imported twice.
ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS graph_message_id TEXT,
  ADD COLUMN IF NOT EXISTS web_link         TEXT,
  ADD COLUMN IF NOT EXISTS from_email       TEXT,
  ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS body_snippet     TEXT,
  ADD COLUMN IF NOT EXISTS attachment_names TEXT[],
  ADD COLUMN IF NOT EXISTS sq_ft            INTEGER;

-- Never import the same Outlook message twice (the dedupe key).
CREATE UNIQUE INDEX IF NOT EXISTS intake_graph_message_id_key
  ON intake_items (graph_message_id) WHERE graph_message_id IS NOT NULL;

-- Keep the source email's webLink on the resulting bid so it can be reopened in Outlook.
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS source_email_link TEXT;
