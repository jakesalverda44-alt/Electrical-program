-- Evidence round 5.2 — "Finished bid": attach an answer key (a Chris BOM/
-- breakdown import, or the bid's own confirmed counts) and store it as an
-- eval case, in the same shape scripts/evalTakeoff.ts reads (ExpectedItem).
-- This is a growing labeled test set, not part of any live bid's own
-- pipeline — nothing here is read back into a bid's takeoff.
CREATE TABLE IF NOT EXISTS takeoff_eval_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  run_id       UUID,
  client       TEXT,
  project_type TEXT,
  source       TEXT NOT NULL, -- 'confirmed_counts' | 'bom_import'
  expected     JSONB NOT NULL, -- ExpectedItem[]-shaped
  inputs_ref   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS takeoff_eval_cases_bid_idx ON takeoff_eval_cases(bid_id);
