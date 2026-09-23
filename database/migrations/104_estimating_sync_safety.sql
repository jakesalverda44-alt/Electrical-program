-- Fix round 1 / B5 — sync-takeoff safety. Two gaps the adversarial review
-- (docs/superpowers/plans/2026-09-22-estimating-review.md) flagged:
--
-- 1. syncTakeoff() overwrote every surviving line's qty unconditionally on
--    every re-run, silently discarding an estimator's manual qty correction
--    the moment Agent 2/4 re-ran. qty_overridden marks a line whose qty the
--    ESTIMATOR set by hand (via the pricing UI) rather than the takeoff —
--    sync only refreshes qty/unit/description for lines where this is false.
--
-- 2. A single boolean `excluded` conflated two different reasons a line is
--    excluded: the estimator deliberately excluded it (a user decision that
--    must survive a re-sync), vs sync itself excluding a line because it
--    vanished from the current takeoff (a fact that should reverse itself if
--    the line reappears in a later takeoff run). sync_excluded distinguishes
--    the two: on reappearance, a sync_excluded line un-excludes; a plain
--    (user-)excluded line stays excluded.
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS qty_overridden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS sync_excluded BOOLEAN NOT NULL DEFAULT false;
