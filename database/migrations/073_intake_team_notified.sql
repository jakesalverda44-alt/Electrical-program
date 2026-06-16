-- 073_intake_team_notified.sql
-- Tracks whether an accepted intake item's "new commercial bid" email was sent to the
-- team (from the Accept panel), so the inbox can show a "Sent to team" checkmark.
ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS team_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS team_notified_to TEXT[];
