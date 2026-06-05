-- Data-integrity hardening:
--   1. CHECK constraints on the two remaining fixed-enum text columns that
--      lacked them (documents.category, tasks.linked_type). Most enum columns
--      already have CHECKs; these were the gaps. Legacy/out-of-set values are
--      normalized first so the constraint can be added safely.
--   2. Missing indexes on foreign-key columns that are filtered/joined in the
--      route layer but were never indexed.
--   3. A currency_code app setting (default USD) so money formatting is
--      configurable instead of hard-coded.

-- 1. documents.category — fixed set used by both upload UIs; backend defaults 'other'.
UPDATE documents
   SET category = 'other'
 WHERE category IS NOT NULL
   AND category NOT IN ('plans','contract','proposal','permit','invoice','other');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_category_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_category_check
      CHECK (category IS NULL OR category IN ('plans','contract','proposal','permit','invoice','other'));
  END IF;
END $$;

-- 2. tasks.linked_type — Zod enum ('bid','gen','customer') or null.
UPDATE tasks
   SET linked_type = NULL
 WHERE linked_type IS NOT NULL
   AND linked_type NOT IN ('bid','gen','customer');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_linked_type_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_linked_type_check
      CHECK (linked_type IS NULL OR linked_type IN ('bid','gen','customer'));
  END IF;
END $$;

-- 3. Missing FK indexes (filtered/joined in the route layer).
CREATE INDEX IF NOT EXISTS takeoff_results_bid_idx ON takeoff_results(bid_id);
CREATE INDEX IF NOT EXISTS gens_salesperson_idx    ON generator_proposals(salesperson_id);
CREATE INDEX IF NOT EXISTS wonjobs_salesperson_idx ON won_jobs(salesperson_id);
CREATE INDEX IF NOT EXISTS tasks_created_by_idx     ON tasks(created_by);

-- 4. Currency setting (ISO 4217 code). Drives money formatting in the UI.
INSERT INTO app_settings (key, value) VALUES
  ('currency_code', 'USD')
ON CONFLICT (key) DO NOTHING;
