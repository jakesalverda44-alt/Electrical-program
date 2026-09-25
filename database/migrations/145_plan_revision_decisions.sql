-- Job profile round 3 (review ff7a6aa, R3-B1) — a newer plan file is never
-- assumed to replace an older one. The sheet check PROPOSES a replacement
-- (same file-name stem, or most sheet numbers AND titles match, with a
-- higher revision / later upload batch); the estimator answers Replace or
-- Keep both, stored here per file pair ("<olderSha>><newerSha>": {decision,
-- by, at}) and audited. Until every proposal is answered, the analysis is
-- blocked.
ALTER TABLE bid_sheet_check ADD COLUMN IF NOT EXISTS revision_decisions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- R3-S3 — forced plan re-reads are limited to one per two minutes per bid.
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS forced_at TIMESTAMPTZ;
