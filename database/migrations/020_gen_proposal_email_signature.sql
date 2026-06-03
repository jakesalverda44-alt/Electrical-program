-- Add email / signature tracking columns to generator_proposals
ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS proposal_token UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS sent_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS viewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signature_data TEXT;

-- Backfill token for any existing rows that somehow have NULL
UPDATE generator_proposals SET proposal_token = gen_random_uuid() WHERE proposal_token IS NULL;
