-- 058_lead_activity_v2.sql
-- Extend lead_activity with direction + created_by, add last_activity_at to leads (kept
-- current by trigger), and open tasks.linked_type to accept 'lead'.

-- Extend existing lead_activity table
ALTER TABLE lead_activity
  ADD COLUMN IF NOT EXISTS direction  TEXT CHECK (direction IN ('in','out')),
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Composite index for reverse-chronological timeline queries
CREATE INDEX IF NOT EXISTS lead_activity_lead_id_at_idx
  ON lead_activity (lead_id, created_at DESC);

-- Track last activity time on the lead itself for overdue detection
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- Backfill from existing activity rows
UPDATE leads l
   SET last_activity_at = (
     SELECT MAX(a.created_at) FROM lead_activity a WHERE a.lead_id = l.id
   )
 WHERE last_activity_at IS NULL;

-- Trigger: update last_activity_at automatically on every new activity row
CREATE OR REPLACE FUNCTION update_lead_last_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE leads SET last_activity_at = NEW.created_at WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_activity_after_insert ON lead_activity;
CREATE TRIGGER lead_activity_after_insert
  AFTER INSERT ON lead_activity
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_activity();

-- Allow tasks to link to leads (safe re-create: drops old constraint if it exists)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_linked_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_linked_type_check
  CHECK (linked_type IN ('bid','gen','customer','lead') OR linked_type IS NULL);
