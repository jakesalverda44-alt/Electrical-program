-- Bid Overview plans upload + job profile — the Documents step now shows a
-- read-only list of the bid's plan files (no upload UI of its own; uploading
-- moved to the Overview tab's "Plans & Job Profile" panel). That list shows
-- each file's page count, computed once at upload time (storeDocument.ts,
-- via pdfjsLoader) and stored here rather than re-parsed on every list
-- render. NULL for a non-PDF file or one uploaded before this column existed
-- (backfilling old rows is not worth a migration — the list falls back to
-- "—" for those).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count INTEGER;
