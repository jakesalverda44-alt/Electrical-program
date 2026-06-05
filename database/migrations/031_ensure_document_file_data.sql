-- Repair migration drift where documents exists but file_data was not added.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data TEXT;
