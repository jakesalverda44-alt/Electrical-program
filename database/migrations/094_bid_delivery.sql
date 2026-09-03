-- 094_bid_delivery.sql
-- Phase 4 Task 1 — electrical send-to-GC delivery: token/view/sign tracking
-- columns on bids, following 020_gen_proposal_email_signature.sql's shape.
-- The public proposal page (Task 2) and e-sign (Task 3) read/write these.

ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS proposal_token      UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS proposal_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposal_sent_to    TEXT[],
  ADD COLUMN IF NOT EXISTS proposal_viewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposal_signed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signer_name         TEXT,
  ADD COLUMN IF NOT EXISTS signature_data      TEXT;

-- Backfill token for any existing rows that somehow have NULL (mirrors 020).
UPDATE bids SET proposal_token = gen_random_uuid() WHERE proposal_token IS NULL;

-- Reuse proposal_activity (059_lead_proposal_handoff.sql) for the bid delivery
-- timeline instead of forking a parallel bid_activity table: same kind/
-- direction/text/created_by/created_at shape already fits (sent/viewed/
-- signed rows for a bid look exactly like they do for a generator proposal).
-- proposal_id there is NOT NULL FKing to generator_proposals, so it has to
-- become nullable, with a new nullable bid_id sitting beside it and a CHECK
-- that exactly one parent is ever set on a given row.
ALTER TABLE proposal_activity ALTER COLUMN proposal_id DROP NOT NULL;
ALTER TABLE proposal_activity
  ADD COLUMN IF NOT EXISTS bid_id UUID REFERENCES bids(id) ON DELETE CASCADE;

ALTER TABLE proposal_activity DROP CONSTRAINT IF EXISTS proposal_activity_one_parent_check;
ALTER TABLE proposal_activity ADD CONSTRAINT proposal_activity_one_parent_check
  CHECK (
    (proposal_id IS NOT NULL AND bid_id IS NULL) OR
    (proposal_id IS NULL AND bid_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS proposal_activity_bid_id_at_idx
  ON proposal_activity (bid_id, created_at DESC) WHERE bid_id IS NOT NULL;
