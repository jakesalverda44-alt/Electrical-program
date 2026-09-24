-- Takeoff accuracy, Task 12 (added to the plan 2026-09-23 — Jake's workflow
-- order): after the AI analysis (and once the Needs-review list is clear) the
-- scope + takeoff are composed WITHOUT a price into a draft, the pre-bid
-- package for Chris builds from that draft, and the GC proposal later reuses
-- the same draft with Chris's price inserted (re-composed only when the scope
-- inputs changed since the draft).
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_output TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_status TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_error TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_model TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS usage_draft JSONB;
-- sha256 of the scope inputs the draft was composed from (Agent 2's output,
-- account terms, review resolutions, the estimator's scope list, the edited
-- Scope of Work) — equal at proposal time = the draft is reused as-is.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_inputs_hash TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS draft_at TIMESTAMPTZ;
-- Where the current agent4_output came from: 'model' (Agent 4 ran) or
-- 'draft' (the pre-bid draft reused with the price inserted).
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS agent4_source TEXT;
ALTER TABLE takeoff_results DROP CONSTRAINT IF EXISTS takeoff_results_draft_status_check;
ALTER TABLE takeoff_results ADD CONSTRAINT takeoff_results_draft_status_check
  CHECK (draft_status IS NULL OR draft_status IN ('running', 'complete', 'error'));
