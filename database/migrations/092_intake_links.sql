-- 092_intake_links.sql
-- Format-specific parsers (Procore today) pull real links out of the invitation email that
-- the generic snippet-only import discarded — "View in Procore" and "Download Documents"
-- (the plans!). `links` stores whatever a format parser found, keyed by link kind, so the
-- Intake Inbox detail pane can offer them as buttons. `due_time` carries a parsed
-- clock-reading ("3:00 PM") alongside the existing `due` date column — bids have no time
-- field (out of scope), so this lives on intake_items only.
ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS links    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS due_time TEXT;
