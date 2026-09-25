-- Job profile fix round (2026-09-24 review, commit 1755e62) — the extraction
-- is now one small structured model call over the pages the sheet check
-- classified as covers / code-area data / electrical title blocks, with
-- code validators deciding what may fill the card. This adds the state that
-- redesign needs; everything is additive and idempotent.
--
--   status          — idle | waiting (the sheet check for these plans has not
--                     finished yet; the profile runs when it completes — S4) |
--                     running | complete | undetermined (a scanned set nothing
--                     could read: no fills) | error.
--   pending_doc_ids — the plan documents a waiting profile will read.
--   run_token       — the newest run owns the row; an older run never writes.
--   systems         — notable systems (fuel, site lighting, fire alarm,
--                     generator, EV), tri-state with evidence (S8).
--   fills           — every value the plans auto-filled onto the card, so a
--                     person clearing it later is seen as a rejection and the
--                     same value is never auto-filled again (S2).
--   pages_used      — which sheets the model was shown (sheet, file, page, why).
--   usage           — the model call's token usage (cost is cost_cents).
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE bid_job_profile DROP CONSTRAINT IF EXISTS bid_job_profile_status_check;
ALTER TABLE bid_job_profile ADD CONSTRAINT bid_job_profile_status_check
  CHECK (status IN ('idle', 'waiting', 'running', 'complete', 'undetermined', 'error'));
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS pending_doc_ids TEXT[];
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS run_token TEXT;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS systems JSONB;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS fills JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS pages_used JSONB;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS usage JSONB;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS undetermined_reason TEXT;

-- N6 — input_key holds the sorted plan document ids the profile read, not
-- the sheet check's content-hash fingerprint.
COMMENT ON COLUMN bid_job_profile.input_key IS
  'Sorted, pipe-joined ids of the plan documents this profile was read from (not the sheet check''s content-hash input_key).';
