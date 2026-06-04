-- Phase 2A: real customer entity + relationships.
-- Until now a "customer" was only a text string repeated on bids/proposals.

CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'customer' CHECK (type IN ('gc','customer','other')),
  company      TEXT,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  notes        TEXT,
  owner_id     UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- One record per name+type (case-insensitive) so backfill is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS customers_name_type_uniq ON customers (LOWER(name), type);

ALTER TABLE bids                 ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE generator_proposals  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

-- Backfill general contractors from existing bids.
INSERT INTO customers (name, type, company)
SELECT DISTINCT TRIM(gc), 'gc', TRIM(gc)
FROM bids
WHERE gc IS NOT NULL AND TRIM(gc) <> '' AND TRIM(gc) <> '—'
ON CONFLICT (LOWER(name), type) DO NOTHING;

-- Backfill end customers from existing generator proposals.
INSERT INTO customers (name, type)
SELECT DISTINCT TRIM(customer), 'customer'
FROM generator_proposals
WHERE customer IS NOT NULL AND TRIM(customer) <> '' AND TRIM(customer) <> '—'
ON CONFLICT (LOWER(name), type) DO NOTHING;

-- Link existing rows to their backfilled customer.
UPDATE bids b
SET customer_id = c.id
FROM customers c
WHERE c.type = 'gc' AND LOWER(c.name) = LOWER(TRIM(b.gc)) AND b.customer_id IS NULL;

UPDATE generator_proposals g
SET customer_id = c.id
FROM customers c
WHERE c.type = 'customer' AND LOWER(c.name) = LOWER(TRIM(g.customer)) AND g.customer_id IS NULL;

CREATE INDEX IF NOT EXISTS bids_customer_id_idx ON bids (customer_id);
CREATE INDEX IF NOT EXISTS gens_customer_id_idx ON generator_proposals (customer_id);
