-- 067_lead_nudge_and_refuse_email.sql
--
-- 1) nudge_sent_at: one-shot stamp for the automated day-2 engagement email sent to
--    Kohler leads that never responded after first contact.
-- 2) Backfill: leads carrying a Kohler "refused to share email" placeholder address
--    (e.g. refuse@kohler.com) can never be emailed — flag the active, un-engaged ones
--    for a call so they surface on the Command Center.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ;

UPDATE leads
   SET needs_call = true, contact_method = 'phone'
 WHERE deleted_at IS NULL
   AND stage NOT IN ('won','lost','converted')
   AND lower(coalesce(email,'')) LIKE '%@kohler.com'
   AND NOT EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id = leads.id AND a.direction = 'in')
   AND NOT EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id = leads.id AND a.kind IN ('call','voicemail'));
