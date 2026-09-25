-- Job profile round 2 (review 44610fb):
--   content_key       — the sheet check's content key (sorted file hashes) of
--                       the plan set the stored profile was read from. With
--                       the model, it decides whether a new run may reuse the
--                       stored model reply instead of calling again (R2-S2).
--   model_called_at   — when this bid last made a job-profile model call; a
--                       forced re-read within a few seconds is refused (R2-S2).
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS model_called_at TIMESTAMPTZ;
