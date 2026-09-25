-- Plans-panel review addendum (eb39943..fc08a97), PB1 (blocker) — Undo for a
-- "Replace plan set" must only ever trash the exact documents THAT replace
-- itself created, by the same user (or an admin/manager), never arbitrary
-- ids taken from the request body. Every successful POST
-- .../plan-files/replace records itself here; undo takes this op's id, not
-- free-form removedIds/uploadedIds.
CREATE TABLE IF NOT EXISTS plan_file_replace_ops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  removed_ids  UUID[] NOT NULL DEFAULT '{}',
  uploaded_ids UUID[] NOT NULL DEFAULT '{}',
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_plan_file_replace_ops_bid ON plan_file_replace_ops(bid_id);
