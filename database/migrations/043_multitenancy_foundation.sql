-- Multi-tenancy foundation (tenant-ready, not yet fully enforced).
--
-- Goal: make the schema tenant-aware WITHOUT rewriting the ~215 existing
-- queries. Every business table gains an org_id that backfills to a single
-- "default organization", and the column carries that value as its DEFAULT so
-- all existing INSERTs keep working untouched. Future multi-tenant enforcement
-- is then a per-query WHERE org_id = $X change rather than a schema migration.
--
-- Scope notes:
--   * app_settings is intentionally left GLOBAL for now — it holds the
--     jwt_secret and system-wide config and is upserted via ON CONFLICT (key).
--     Per-org settings is a deliberate follow-up.
--   * The default org id is a fixed sentinel so the backend (DEFAULT_ORG_ID)
--     and legacy JWTs without an org claim resolve to the same tenant.

-- 1. Organizations table.
CREATE TABLE IF NOT EXISTS organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the single default organization, naming it after the configured
--    company where one exists so the row is recognizable.
INSERT INTO organizations (id, name, slug)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  COALESCE((SELECT value FROM app_settings WHERE key = 'company_name'), 'Default Organization'),
  'default'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Add org_id to every tenant-scoped table. ADD COLUMN IF NOT EXISTS keeps
--    this idempotent; the constant DEFAULT backfills existing rows and lets all
--    current INSERTs continue without code changes. A per-table index on org_id
--    prepares the eventual tenant-filtered queries.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','customers','projects','bids','generator_proposals','won_jobs',
    'communications','documents','takeoff_results','project_change_orders',
    'project_field_notes','project_rfis','project_sections','intake_items',
    'notifications','tasks','activity','bid_workspaces','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL '
      || 'DEFAULT ''00000000-0000-0000-0000-000000000001'' REFERENCES organizations(id)',
      t
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id)', t || '_org_idx', t);
  END LOOP;
END $$;
