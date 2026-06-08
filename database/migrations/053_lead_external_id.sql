-- External lead reference (e.g. the Kohler dealer-portal lead id) used as a
-- dedupe key for automated intake: re-pulling the same portal lead updates the
-- existing row instead of creating a duplicate.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_lead_id TEXT;

-- Partial unique index: the id must be unique when present, but manually-entered
-- leads (NULL external_lead_id) are not constrained — Postgres allows many NULLs
-- and this lets ON CONFLICT (external_lead_id) target the upsert.
CREATE UNIQUE INDEX IF NOT EXISTS leads_external_lead_id_key
  ON leads (external_lead_id) WHERE external_lead_id IS NOT NULL;
