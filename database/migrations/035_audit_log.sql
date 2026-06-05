-- Audit trail for money / identity / permission changes. Records WHO did WHAT,
-- WHEN, with optional before/after snapshots. Writes are best-effort and must
-- never block the underlying request (see backend/src/utils/audit.ts).
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  user_name   TEXT,
  action      TEXT NOT NULL,        -- create | update | delete | restore | purge | award | merge | password_reset | ai_override
  entity_type TEXT NOT NULL,        -- user | settings | bid | gen | document | customer
  entity_id   TEXT,
  summary     TEXT,                 -- human-readable description
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_entity_idx  ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_user_idx    ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);

-- Retention window (months) for purging old audit rows and trashed records.
-- Configurable in Settings; the hourly background job reads this value.
INSERT INTO app_settings (key, value) VALUES ('audit_retention_months', '12')
  ON CONFLICT (key) DO NOTHING;
