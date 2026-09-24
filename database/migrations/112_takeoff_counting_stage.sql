-- Takeoff accuracy (docs/superpowers/plans/2026-09-23-takeoff-accuracy.md),
-- Tasks 1, 5, 7 — the dedicated counting stage (Agent 1C) and its gate.

-- ── Settings (Task 1) — insert-if-absent, editable in Settings → AI ─────────
INSERT INTO app_settings (key, value)
SELECT 'ai_takeoff_counter_model', 'claude-opus-5-5'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'ai_takeoff_counter_model');

INSERT INTO app_settings (key, value)
SELECT 'ai_max_tokens_counter', '32000'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'ai_max_tokens_counter');

-- ── takeoff_results: the counting result + review state (Tasks 5, 7) ──────
-- count_result: the full, auditable counting outcome (targets, per-sheet
--   counts, de-dup decisions, cross-check discrepancies, Agent 1 rows the
--   counts replaced). Written once per analysis run.
-- review_items: the Needs-review list — zero/unreadable count types and scope
--   questions — each with its resolution once the estimator resolves it.
-- review_status: 'clear' | 'needs_review'. NULL = a run from before this
--   migration (or one that never reached the counting stage) — never gated.
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS count_result JSONB;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS review_items JSONB;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS review_status TEXT;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS usage_counter JSONB;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS model_counter TEXT;

ALTER TABLE takeoff_results DROP CONSTRAINT IF EXISTS takeoff_results_review_status_check;
ALTER TABLE takeoff_results ADD CONSTRAINT takeoff_results_review_status_check
  CHECK (review_status IS NULL OR review_status IN ('clear', 'needs_review'));
