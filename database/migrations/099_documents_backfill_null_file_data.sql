-- Audit batch 3, Task 12 (audit data #14) — one-time backfill: any documents
-- row that has BOTH a storage_url and file_data only ever needs the URL: the
-- bytes are stored externally already, and base64 in the row costs 33% over
-- the raw bytes and, unlike Cloudinary/Drive storage, lands in every
-- pg_dump. This is authorized data modification, not deletion of documents
-- — the row and the file both survive; only the redundant in-row copy of
-- bytes already available at storage_url goes. Idempotent: once no row has
-- both set, a second run's WHERE clause matches nothing.
DO $$
DECLARE
  backfilled_count int;
BEGIN
  WITH cleared AS (
    UPDATE documents
       SET file_data = NULL
     WHERE storage_url IS NOT NULL AND file_data IS NOT NULL
     RETURNING id
  )
  SELECT count(*) INTO backfilled_count FROM cleared;
  RAISE NOTICE 'documents file_data backfill (099): cleared % rows that had both storage_url and file_data', backfilled_count;
END $$;
