-- 064_intake_read_state.sql
-- Read/unread state for Intake Inbox items. An item is unread (read_at IS NULL) until it's
-- opened in the review pane, which stamps read_at. Existing rows predate the feature, so
-- mark them read to keep the unread count meaningful (only new arrivals show as unread).
ALTER TABLE intake_items
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

UPDATE intake_items SET read_at = now() WHERE read_at IS NULL;
