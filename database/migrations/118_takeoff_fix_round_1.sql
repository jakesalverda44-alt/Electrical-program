-- Takeoff accuracy, fix round 1 (review 2026-09-23).
--
-- B5 — every analysis run gets an id. Agent 4's output, the pre-bid draft and
-- each filed proposal document remember the run they came from; a new
-- /analyze clears the previous run's Agent 4 output and draft and puts the
-- review in 'pending' (blocks every GC document) until the counting stage
-- writes the new review. "Draft email to GC" attaches only a PDF filed from
-- the CURRENT run.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS run_id UUID;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS agent4_run_id UUID;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_run_id UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS takeoff_run_id UUID;

ALTER TABLE takeoff_results DROP CONSTRAINT IF EXISTS takeoff_results_review_status_check;
ALTER TABLE takeoff_results ADD CONSTRAINT takeoff_results_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('clear', 'needs_review', 'pending'));

-- B2 — fixture/device types the estimator entered when the drawing analysis
-- found no schedule or legend; the next analysis run counts them.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS manual_count_targets JSONB;
