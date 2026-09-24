-- Takeoff accuracy (docs/superpowers/plans/2026-09-23-takeoff-accuracy.md),
-- Task 9 — output hygiene: what the deterministic clean-up changed on each
-- run (GC vs. what the drawings print, "missing" sheets that were in the set,
-- not-found values downgraded from VERIFIED, conflicting square footages), so
-- the estimator sees it instead of it happening silently.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS hygiene JSONB;
