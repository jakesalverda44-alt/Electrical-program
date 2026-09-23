-- Fix round 1 / B3 — applies the seed-data corrections made in
-- backend/src/estimating/seed/laborUnits.ts (the TS source of truth) to any
-- database where migration 102 already ran, since re-editing 102's own SQL
-- file has no effect once it's recorded in schema_migrations. All statements
-- are idempotent and, per the seed convention documented in
-- scripts/generateLaborSeedSql.ts, never touch a row an admin has since
-- edited to source='manual'.

-- 1) A new DISC-800 item, for the 800A-service-entrance fix below. Same
--    shape/category as the existing DISC-* disconnect rows.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('DISC-800', 'Disconnect switch, 800A', 'Service & Distribution', 'EA', 1850, NULL, 10.5,
        ARRAY['800a disconnect', 'disconnect switch, 800a']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- 2) ASM-SVCENT-800 (800A service entrance assembly) was built on a DISC-400
--    (400A) disconnect — the review's B3 finding: it priced BELOW the 400A
--    service entrance assembly it's supposed to exceed. Zero out the
--    DISC-400 component's qty_per (rather than deleting the row) and add a
--    DISC-800 component instead — zeroing, not deleting, keeps the
--    (assembly_id, item_id) row in place as migration 102's own
--    `ON CONFLICT ... DO NOTHING` target, so 102's generated SQL stays
--    idempotent if it's ever re-run directly (estimatingSeed.test.ts asserts
--    exactly that). A deleted row would let 102's re-run re-insert the
--    original DISC-400 link, undoing this fix.
DO $$
DECLARE
  asm_id UUID;
  old_item_id UUID;
  new_item_id UUID;
BEGIN
  SELECT id INTO asm_id FROM est_assemblies WHERE code = 'ASM-SVCENT-800';
  SELECT id INTO old_item_id FROM est_items WHERE code = 'DISC-400';
  SELECT id INTO new_item_id FROM est_items WHERE code = 'DISC-800';
  IF asm_id IS NOT NULL AND old_item_id IS NOT NULL AND new_item_id IS NOT NULL THEN
    UPDATE est_assembly_components SET qty_per = 0
    WHERE assembly_id = asm_id AND item_id = old_item_id AND qty_per <> 0;

    INSERT INTO est_assembly_components (assembly_id, item_id, qty_per)
    VALUES (asm_id, new_item_id, 1)
    ON CONFLICT (assembly_id, item_id) DO NOTHING;
  END IF;
END $$;

-- 3) N5 — ASM-DUPLEX gains qualified receptacle/outlet aliases so common
--    phrasings default to the plain device-plus-box assembly (see
--    laborUnits.ts for why bare 'receptacle'/'outlet' are deliberately
--    excluded). Only touches a row still at source='seed' (unedited).
UPDATE est_assemblies
SET aliases = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(aliases || ARRAY['duplex', 'duplex outlet', 'receptacle outlet', 'standard receptacle']::text[])
  )
)
WHERE code = 'ASM-DUPLEX' AND source = 'seed';
