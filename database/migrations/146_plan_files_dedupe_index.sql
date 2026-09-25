-- Plans-panel fix round, Task 1 (dedupe on upload) — documents.content_sha256
-- already exists (migration 121, populated for every upload by
-- storeDocument.ts) and already backs the takeoff pipeline's own dedupe
-- (routes/preconstruction.ts). This just adds the index the Overview
-- panel's own dedupe check leans on: "does this bid already have a
-- non-deleted plan file with these exact bytes?" — a per-bid, per-category
-- lookup, so re-uploading the same plan set is a fast no-op instead of a
-- second stored copy.
CREATE INDEX IF NOT EXISTS idx_documents_plan_dedupe
  ON documents (linked_id, content_sha256)
  WHERE deleted_at IS NULL AND category = 'plans' AND content_sha256 IS NOT NULL;
