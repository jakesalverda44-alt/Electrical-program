-- Fix round N4 — finish-bid (evidence round 5.2) had no idempotency at
-- all: calling it twice for the same run inserted a second
-- takeoff_eval_cases row, silently doubling that run's weight in the eval
-- set. One eval case per (bid, run, source); a second call for the same
-- run/source updates the existing row instead (see routes/preconstruction.ts
-- POST /:bidId/finish-bid, ON CONFLICT). run_id is nullable, so the
-- constraint keys on a COALESCE placeholder rather than the raw column
-- (two NULLs are never equal to plain UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS takeoff_eval_cases_bid_run_source_uniq
  ON takeoff_eval_cases (bid_id, (COALESCE(run_id::text, 'no-run')), source);
