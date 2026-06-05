-- Add missing Drive subfolder ID columns to bids and expand document category enum.

-- 1. New Drive subfolder columns
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_submittals_folder_id    TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_rfis_folder_id          TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS drive_change_orders_folder_id TEXT;

-- 2. Expand documents.category to include new values
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','other',
    'change_order','submittal','rfi','photo'
  ));
