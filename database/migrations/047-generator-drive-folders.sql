ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_job_folder_id TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_engineering_folder_id TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_permit_folder_id TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_contract_folder_id TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_invoices_folder_id TEXT;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
