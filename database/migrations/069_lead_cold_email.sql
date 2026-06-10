-- 069_lead_cold_email.sql
--
-- cold_email_sent_at: one-shot stamp for the automated "going cold" final touch sent to
-- Kohler email leads that never responded after BOTH the first-contact email and the
-- day-2 nudge. Like nudge_sent_at, it is claimed atomically so the email goes out at
-- most once per lead. A lead is eligible only if it still has no inbound reply and no
-- human outreach logged (call / voicemail / text / manual email) several days after the
-- nudge — i.e. it has truly gone quiet.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS cold_email_sent_at TIMESTAMPTZ;
