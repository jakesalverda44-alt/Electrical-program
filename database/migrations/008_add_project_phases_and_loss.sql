ALTER TABLE bids ADD COLUMN IF NOT EXISTS elec_project_phase TEXT DEFAULT 'signed';
ALTER TABLE bids ADD COLUMN IF NOT EXISTS loss_reason TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS competitor TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS gen_install_phase TEXT DEFAULT 'scheduled';
