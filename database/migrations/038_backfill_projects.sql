-- Backfill a project row for every awarded bid/proposal, plus any record already
-- referenced by the project_* tables (so the foreign keys added in 039 have a
-- parent for all existing data). Idempotent via ON CONFLICT.

-- Awarded electrical bids.
INSERT INTO projects (id, source_type, customer_id, name, contract_value, awarded_at, created_at)
SELECT b.id, 'elec', b.customer_id, b.name, b.amount, COALESCE(b.awarded_at, b.updated_at), b.created_at
FROM bids b
WHERE b.stage = 'awarded'
ON CONFLICT (id) DO NOTHING;

-- Awarded generator proposals.
INSERT INTO projects (id, source_type, customer_id, name, contract_value, awarded_at, created_at)
SELECT g.id, 'gen', g.customer_id, g.customer, g.amount, COALESCE(g.signed_at, g.updated_at), g.created_at
FROM generator_proposals g
WHERE g.stage = 'awarded'
ON CONFLICT (id) DO NOTHING;

-- Any project_id referenced by child tables that maps to an existing bid (elec)…
INSERT INTO projects (id, source_type, customer_id, name, contract_value, created_at)
SELECT DISTINCT b.id, 'elec', b.customer_id, b.name, b.amount, b.created_at
FROM bids b
WHERE b.id IN (
  SELECT project_id FROM project_change_orders
  UNION SELECT project_id FROM project_field_notes
  UNION SELECT project_id FROM project_rfis
  UNION SELECT project_id FROM project_sections
)
ON CONFLICT (id) DO NOTHING;

-- …or to an existing generator proposal (gen).
INSERT INTO projects (id, source_type, customer_id, name, contract_value, created_at)
SELECT DISTINCT g.id, 'gen', g.customer_id, g.customer, g.amount, g.created_at
FROM generator_proposals g
WHERE g.id IN (
  SELECT project_id FROM project_change_orders
  UNION SELECT project_id FROM project_field_notes
  UNION SELECT project_id FROM project_rfis
  UNION SELECT project_id FROM project_sections
)
ON CONFLICT (id) DO NOTHING;
