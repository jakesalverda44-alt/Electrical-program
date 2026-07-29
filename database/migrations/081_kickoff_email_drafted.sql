-- Stamp when the internal kickoff email draft was (last) created, so the drawer
-- can show kickoff status and the modal can offer "Re-draft" instead of "Draft".
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS kickoff_email_drafted_at TIMESTAMPTZ;
