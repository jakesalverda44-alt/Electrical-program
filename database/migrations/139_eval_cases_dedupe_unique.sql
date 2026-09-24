-- Evidence fix round 3 — de-duplicate takeoff_eval_cases, then enforce one
-- eval case per (bid, run, source). A database that ran 136 before the
-- finish-bid idempotency fix may hold duplicate rows; the newest row of each
-- (bid_id, run_id, source) is kept. Idempotent: on a database that already
-- has the index (it ran the old 138) there are no duplicates and the index
-- exists, so nothing changes.
DELETE FROM takeoff_eval_cases t
USING takeoff_eval_cases newer
WHERE t.bid_id = newer.bid_id
  AND COALESCE(t.run_id::text, 'no-run') = COALESCE(newer.run_id::text, 'no-run')
  AND t.source = newer.source
  AND (t.created_at, t.id::text) < (newer.created_at, newer.id::text);

CREATE UNIQUE INDEX IF NOT EXISTS takeoff_eval_cases_bid_run_source_uniq
  ON takeoff_eval_cases (bid_id, (COALESCE(run_id::text, 'no-run')), source);
