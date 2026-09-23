-- Closes the gap flagged in the Part 1 report: bid_estimates.line_items was
-- written with `item` = the line's description, but composeBidData's
-- per-line confidence lookup (preconstruction.ts ~1841, SavedConfidenceItem)
-- keys on Agent 4's short takeoff item id (e.g. "5.1"), which est_bid_lines
-- never stored. Migration 101 is already applied on the test DB, so this is
-- a new migration rather than an edit to 101.
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS takeoff_item_id TEXT;
