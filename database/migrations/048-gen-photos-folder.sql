-- Add a Photos folder reference to generator proposals so the Generator Projects
-- workspace can list/upload job-site photos the same way Electrical projects do.
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS drive_photos_folder_id text;
