-- Persist the full generator proposal builder state so saved proposals can be
-- reopened or viewed with the same customer/contact and pricing details.
ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS proposal_no TEXT,
  ADD COLUMN IF NOT EXISTS form_data JSONB,
  ADD COLUMN IF NOT EXISTS totals_data JSONB;
