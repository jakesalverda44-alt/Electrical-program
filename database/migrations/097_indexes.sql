-- Audit batch 3, Task 4 (audit-data-perf.md #11, #12, #13, #19). No
-- CONCURRENTLY: migrate.ts wraps every file in BEGIN/COMMIT, which
-- CONCURRENTLY cannot run inside. Every table here is tiny (dozens to a few
-- thousand rows), so a plain index build is effectively instant.

-- #12 — missing indexes on foreign-key-ish columns; each makes the parent's
-- delete/reassign a seq scan of the child table today.
CREATE INDEX IF NOT EXISTS bids_signed_document_idx ON bids(signed_document_id) WHERE signed_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_owner_idx ON customers(owner_id);
CREATE INDEX IF NOT EXISTS gens_countersigned_by_idx ON generator_proposals(countersigned_by);
CREATE INDEX IF NOT EXISTS intake_items_created_by_idx ON intake_items(created_by);
CREATE INDEX IF NOT EXISTS leads_linked_gen_idx ON leads(linked_gen_id) WHERE linked_gen_id IS NOT NULL;

-- #13 — missing indexes on columns the routes actually filter/sort by.
CREATE INDEX IF NOT EXISTS leads_active_created_idx ON leads(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS intake_items_updated_idx ON intake_items(updated_at DESC);
-- tasks_status_check confirms the CHECK constraint's open value is 'open'
-- (verified via pg_get_constraintdef: status = ANY ('open','done')).
CREATE INDEX IF NOT EXISTS tasks_linked_idx ON tasks(linked_type, linked_id) WHERE status = 'open';

-- documents(div, linked_id) — the polymorphic-lookup pattern every doc-hub
-- query uses (routes/documents.ts, ElecProjectsPage's linked_id fetch in
-- Task 5, etc.), scoped to live rows only.
CREATE INDEX IF NOT EXISTS documents_div_linked_idx ON documents(div, linked_id) WHERE deleted_at IS NULL;

-- #19 — doc_linked_idx (015_create_documents.sql) and docs_linked_idx
-- (019_add_indexes.sql) are both live in pg_indexes with the identical
-- definition `btree (linked_id)` — confirmed via:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename='documents'
--     AND indexname IN ('doc_linked_idx','docs_linked_idx');
-- doc_linked_idx -> CREATE INDEX doc_linked_idx ON public.documents USING btree (linked_id)
-- docs_linked_idx -> CREATE INDEX docs_linked_idx ON public.documents USING btree (linked_id)
-- Dropping an index (not a table) is not caught by the destructive-migration
-- guard, and is safe here since the two are exact duplicates.
DROP INDEX IF EXISTS docs_linked_idx;
