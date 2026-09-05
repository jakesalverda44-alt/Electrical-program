-- Audit batch 3, Task 11 ("Pricing fields join the workspace autosave" —
-- struck from Batch 2). bid_workspaces gains the three pricing fields the
-- estimator already edits live in PcWorkspace, so the continuous autosave
-- (PUT /:bidId/workspace) captures them too, not only the "Save Estimate"
-- action (bid_estimates). Estimate math and what /estimates stores are
-- unchanged — this is a second, additional persistence point, not a
-- replacement.
ALTER TABLE bid_workspaces ADD COLUMN IF NOT EXISTS overhead_pct numeric;
ALTER TABLE bid_workspaces ADD COLUMN IF NOT EXISTS profit_pct numeric;
ALTER TABLE bid_workspaces ADD COLUMN IF NOT EXISTS estimate_overrides jsonb DEFAULT '{}';
