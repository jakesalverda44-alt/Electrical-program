-- 085_lead_outlook_event.sql
-- Dedupe key for a lead created from an Outlook calendar appointment (the
-- Survey-from-Calendar picker): a repeat tap on the same event, or two reps hitting
-- it at once, must land on the same lead instead of creating a duplicate.
ALTER TABLE leads ADD COLUMN outlook_event_id text;
CREATE UNIQUE INDEX leads_outlook_event_id_key
  ON leads (outlook_event_id) WHERE outlook_event_id IS NOT NULL;
