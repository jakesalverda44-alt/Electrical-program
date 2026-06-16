-- 074_bids_team_notified.sql
-- Tracks whether a bid's "new commercial bid" email was sent to the team (via the
-- "Email Bid to Team" button on the pipeline detail drawer), so it can show a
-- "Sent to team" mark and support resending after the fact.
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS team_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS team_notified_to TEXT[];
