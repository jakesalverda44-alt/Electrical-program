-- Remodel reading round, fix B3 — the estimator's answer to "How are new vs
-- existing devices shown on these plans?" lives OUTSIDE takeoff_results: a
-- re-run's clean slate (beginAnalysisRun sets review_items = NULL) must not
-- erase it, because the answer is only ever applied BY a re-run. Written by
-- the review-resolve route (deleted when the item is reopened), read by the
-- pipeline before counting.
CREATE TABLE IF NOT EXISTS bid_remodel_convention (
  bid_id      UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  answer      TEXT NOT NULL,
  answered_by TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
