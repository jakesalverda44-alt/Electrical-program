-- Gap-closing round T1 / T3 (docs/superpowers/plans/2026-09-30-gap-closing.md).
-- Schema only: no library value changes here.
--
-- T1 — library history. Saved estimate lines store no unit costs: every recap
-- re-reads est_items / est_assemblies live, so any library change (a seed
-- migration, an admin edit, an Accubid import, a calibration apply) used to
-- re-price submitted / sold bids. Jake's rule: submitted or sold bids keep
-- their prices; only bids being estimated (a pre-submission stage, or the
-- Calibration flag) see new units and prices. From this migration on, the old
-- row is written to history BEFORE any change (a trigger, so every write path
-- is covered: library.ts, accubidImport.ts, calibration.ts and every later
-- migration), and a bid that is not being estimated prices against the
-- library AS OF its submission (estimating/libraryAsOf.ts).
-- History is empty before this migration: changes made by migrations 156 and
-- 158 are NOT reconstructed (restoring those was P fix round B1's job).

CREATE TABLE IF NOT EXISTS est_item_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             UUID NOT NULL,
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  unit                TEXT NOT NULL,
  material_cost       NUMERIC(12,4) NOT NULL,
  material_price_date DATE,
  labor_hours         NUMERIC(10,4) NOT NULL,
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  source              TEXT NOT NULL,
  active              BOOLEAN NOT NULL,
  item_created_at     TIMESTAMPTZ,
  -- The old values were in force until this moment.
  valid_until         TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by          TEXT,
  deleted             BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS est_item_history_item_idx ON est_item_history (item_id, valid_until);

-- One row per component that left an assembly (deleted or re-written): it was
-- part of the assembly from valid_from until valid_until.
ALTER TABLE est_assembly_components ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE est_assembly_components SET created_at = '1970-01-01T00:00:00Z' WHERE created_at IS NULL;
ALTER TABLE est_assembly_components ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS est_assembly_component_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id UUID NOT NULL,
  item_id     UUID NOT NULL,
  qty_per     NUMERIC(12,4) NOT NULL,
  valid_from  TIMESTAMPTZ,
  valid_until TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  TEXT
);
CREATE INDEX IF NOT EXISTS est_assembly_component_history_idx ON est_assembly_component_history (assembly_id, valid_until);

-- Assembly rows themselves (aliases / active / unit decide mapping).
CREATE TABLE IF NOT EXISTS est_assembly_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id         UUID NOT NULL,
  code                TEXT NOT NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  unit                TEXT NOT NULL,
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  source              TEXT NOT NULL,
  active              BOOLEAN NOT NULL,
  assembly_created_at TIMESTAMPTZ,
  valid_until         TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by          TEXT,
  deleted             BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS est_assembly_history_idx ON est_assembly_history (assembly_id, valid_until);

-- changed_by: the writer may say who it is (SET LOCAL app.library_change = '…'); else 'db'.
CREATE OR REPLACE FUNCTION est_item_history_capture() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO est_item_history (item_id, code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active, item_created_at, changed_by, deleted)
    VALUES (OLD.id, OLD.code, OLD.name, OLD.category, OLD.unit, OLD.material_cost, OLD.material_price_date, OLD.labor_hours, OLD.aliases, OLD.source, OLD.active, OLD.created_at,
            COALESCE(NULLIF(current_setting('app.library_change', true), ''), 'db'), true);
    RETURN OLD;
  END IF;
  -- Only a change that can move a price or a mapping is history (updated_at / provenance stamps are not).
  IF (OLD.code, OLD.name, OLD.category, OLD.unit, OLD.material_cost, OLD.material_price_date, OLD.labor_hours, OLD.aliases, OLD.active)
     IS DISTINCT FROM (NEW.code, NEW.name, NEW.category, NEW.unit, NEW.material_cost, NEW.material_price_date, NEW.labor_hours, NEW.aliases, NEW.active) THEN
    INSERT INTO est_item_history (item_id, code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active, item_created_at, changed_by)
    VALUES (OLD.id, OLD.code, OLD.name, OLD.category, OLD.unit, OLD.material_cost, OLD.material_price_date, OLD.labor_hours, OLD.aliases, OLD.source, OLD.active, OLD.created_at,
            COALESCE(NULLIF(current_setting('app.library_change', true), ''), 'db'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS est_items_history_trg ON est_items;
CREATE TRIGGER est_items_history_trg BEFORE UPDATE OR DELETE ON est_items
  FOR EACH ROW EXECUTE FUNCTION est_item_history_capture();

CREATE OR REPLACE FUNCTION est_assembly_component_history_capture() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.item_id, OLD.qty_per) IS NOT DISTINCT FROM (NEW.item_id, NEW.qty_per) THEN
    RETURN NEW;
  END IF;
  INSERT INTO est_assembly_component_history (assembly_id, item_id, qty_per, valid_from, changed_by)
  VALUES (OLD.assembly_id, OLD.item_id, OLD.qty_per, OLD.created_at, COALESCE(NULLIF(current_setting('app.library_change', true), ''), 'db'));
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS est_assembly_components_history_trg ON est_assembly_components;
CREATE TRIGGER est_assembly_components_history_trg BEFORE UPDATE OR DELETE ON est_assembly_components
  FOR EACH ROW EXECUTE FUNCTION est_assembly_component_history_capture();

CREATE OR REPLACE FUNCTION est_assembly_history_capture() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO est_assembly_history (assembly_id, code, name, category, unit, aliases, source, active, assembly_created_at, changed_by, deleted)
    VALUES (OLD.id, OLD.code, OLD.name, OLD.category, OLD.unit, OLD.aliases, OLD.source, OLD.active, OLD.created_at,
            COALESCE(NULLIF(current_setting('app.library_change', true), ''), 'db'), true);
    RETURN OLD;
  END IF;
  IF (OLD.code, OLD.name, OLD.category, OLD.unit, OLD.aliases, OLD.active)
     IS DISTINCT FROM (NEW.code, NEW.name, NEW.category, NEW.unit, NEW.aliases, NEW.active) THEN
    INSERT INTO est_assembly_history (assembly_id, code, name, category, unit, aliases, source, active, assembly_created_at, changed_by)
    VALUES (OLD.id, OLD.code, OLD.name, OLD.category, OLD.unit, OLD.aliases, OLD.source, OLD.active, OLD.created_at,
            COALESCE(NULLIF(current_setting('app.library_change', true), ''), 'db'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS est_assemblies_history_trg ON est_assemblies;
CREATE TRIGGER est_assemblies_history_trg BEFORE UPDATE OR DELETE ON est_assemblies
  FOR EACH ROW EXECUTE FUNCTION est_assembly_history_capture();

-- T3 — "is this quote the fixture package?" answered No is remembered (never asked again);
-- answered Yes sets fixture_package (as before). Neither is ever set automatically.
ALTER TABLE est_bid_quotes ADD COLUMN IF NOT EXISTS fixture_package_decided BOOLEAN NOT NULL DEFAULT false;
UPDATE est_bid_quotes SET fixture_package_decided = true WHERE fixture_package AND NOT fixture_package_decided;
