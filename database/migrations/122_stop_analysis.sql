-- Stop analysis (docs/superpowers/plans/2026-09-24-rerun-reset-report.md).
--
-- A running analysis, Agent 4 run or pre-bid draft can be stopped from the
-- UI. The run keeps its run_id and is marked 'cancelled' (status for the
-- analysis, agent4_status / draft_status for the others); every write of the
-- pipeline is guarded so a cancelled run never writes results afterwards.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

-- Live progress for the UI ("Agent 1: batch 3 of 14", "Counting sheet 2 of 5")
-- instead of fixed time estimates: {stage, step, of, label, at}.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS progress JSONB;

ALTER TABLE takeoff_results DROP CONSTRAINT IF EXISTS takeoff_results_draft_status_check;
ALTER TABLE takeoff_results ADD CONSTRAINT takeoff_results_draft_status_check
  CHECK (draft_status IS NULL OR draft_status IN ('running', 'complete', 'error', 'cancelled'));
