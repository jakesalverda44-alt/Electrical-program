-- Job profile fix round — two more columns for the redesigned run:
--   requested_by — who asked for the run ({id, name}); a run that waits for
--                  the sheet check finishes in the background and still logs
--                  its fills against that person.
--   rejected     — the model values the code validators refused, with the
--                  reason (shown as "couldn't use" on Overview; never filled).
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS requested_by JSONB;
ALTER TABLE bid_job_profile ADD COLUMN IF NOT EXISTS rejected JSONB;
