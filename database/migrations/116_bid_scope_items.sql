-- Takeoff accuracy, Task 11 (added to the plan 2026-09-23 after the Big Dan's
-- Car Wash / Lake City proposal listed excluded and other-trade items) — the
-- estimator's per-bid scope list and non-electrical overrides.
--   kind 'include'  — an included item, as limited ("F/A: conduit + pull strings only")
--   kind 'exclude'  — a Not-included item ("600A MCC — not included"): blocks any
--                     GC-facing line/bullet that mentions it, becomes an exclusion
--   kind 'override_non_electrical' — the estimator keeps a line the
--                     non-electrical gate flagged; line_key identifies the line,
--                     reason is required
CREATE TABLE IF NOT EXISTS bid_scope_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id      UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  line_key    TEXT,
  reason      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bid_scope_items DROP CONSTRAINT IF EXISTS bid_scope_items_kind_check;
ALTER TABLE bid_scope_items ADD CONSTRAINT bid_scope_items_kind_check
  CHECK (kind IN ('include', 'exclude', 'override_non_electrical'));
ALTER TABLE bid_scope_items DROP CONSTRAINT IF EXISTS bid_scope_items_override_check;
ALTER TABLE bid_scope_items ADD CONSTRAINT bid_scope_items_override_check
  CHECK (kind <> 'override_non_electrical' OR (line_key IS NOT NULL AND length(trim(coalesce(reason, ''))) >= 3));
CREATE INDEX IF NOT EXISTS idx_bid_scope_items_bid ON bid_scope_items (bid_id);
