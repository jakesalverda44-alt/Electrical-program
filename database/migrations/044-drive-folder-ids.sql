ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_gc_folder_id TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_job_folder_id TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_plans_folder_id TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_estimates_folder_id TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_photos_folder_id TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_contracts_folder_id TEXT;
