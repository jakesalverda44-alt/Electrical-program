-- 065_intake_pending_unread.sql
-- 064 backfilled EVERY existing intake item as read, which left the inbox with nothing
-- unread to show (no badge, no bold/dot). Pending bids are precisely the "unopened" items
-- the unread state is meant to highlight, so reset those to unread. Processed (accepted /
-- declined) items stay read.
UPDATE intake_items SET read_at = NULL WHERE status = 'pending';
