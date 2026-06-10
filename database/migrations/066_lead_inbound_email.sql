-- 066_lead_inbound_email.sql
-- Auto-logged inbound lead emails (replies to our first-contact message). The Command
-- Center scans the unread inbox and logs a matching lead's reply to its timeline; deduping
-- on the Graph message id makes that scan idempotent across reloads (same pattern as the
-- intake_items dedupe in 063). The activity row itself is the processing record, and the
-- 058 trigger updates leads.last_activity_at for free.
ALTER TABLE lead_activity
  ADD COLUMN IF NOT EXISTS graph_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS lead_activity_graph_message_id_key
  ON lead_activity (graph_message_id) WHERE graph_message_id IS NOT NULL;
