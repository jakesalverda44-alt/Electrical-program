-- Awarded work becomes a first-class "project". A project's id IS the source
-- bid/gen id (1:1), so existing change orders, RFIs, field notes and sections
-- (already keyed by that id) attach to it without any data repoint, and current
-- screens keep working. source_type distinguishes electrical vs generator.
CREATE TABLE IF NOT EXISTS projects (
  id             UUID PRIMARY KEY,                         -- = bids.id or generator_proposals.id
  source_type    TEXT NOT NULL CHECK (source_type IN ('elec','gen')),
  customer_id    UUID REFERENCES customers(id),
  name           TEXT,
  contract_value NUMERIC(12,2),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','complete','cancelled')),
  awarded_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS projects_source_idx   ON projects (source_type, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_customer_idx ON projects (customer_id);
