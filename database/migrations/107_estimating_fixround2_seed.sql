-- Fix round 2 / SF5 — migration 105 zeroed out (rather than deleted)
-- ASM-SVCENT-800's DISC-400 component to keep 102's own re-run idempotent,
-- but a leftover qty_per=0 row makes the 800A assembly UNEDITABLE in
-- Settings: LaborLibrarySection.tsx sends every component back on any edit,
-- and the assembly PUT route rejects any qty_per <= 0. Delete that row now
-- (102 is long since applied and recorded in schema_migrations — re-running
-- it directly, as estimatingSeed.test.ts's idempotency check does, no
-- longer has anything to conflict with once this row is gone). Guarded by
-- source='seed' on the assembly, per the review's "never touch an edited
-- row" rule — the same guard migration 105's swap itself should have had.
DELETE FROM est_assembly_components eac
USING est_assemblies asm, est_items it
WHERE eac.assembly_id = asm.id AND eac.item_id = it.id
  AND asm.code = 'ASM-SVCENT-800' AND asm.source = 'seed'
  AND it.code = 'DISC-400' AND eac.qty_per = 0;

-- Fix round 2 / N6 — "2\" PVC" in a Branch Power takeoff line mapped to the
-- only 2" PVC item in the library, which is underground-only (CAT.SITE) —
-- correct price, wrong category. Adds an above-grade Branch Power 2" PVC
-- item (a different code — PVC-200 is already the underground item's code)
-- so the mapper's existing category bonus can prefer it for a Branch Power
-- line, matching the underground item's own cost/hours convention among the
-- rest of the above-grade PVC_BRANCH_ROWS ladder.
INSERT INTO est_items (code, name, category, unit, material_cost, material_price_date, labor_hours, aliases, source, active)
VALUES ('PVCB-200', '2" PVC Sch 40 (incl. fittings/glue)', 'Branch Power', 'C', 75, NULL, 7,
        ARRAY['2" pvc sch 40 (incl. fittings/glue)']::text[], 'seed', true)
ON CONFLICT (code) DO NOTHING;

-- Fix round 2 / SF1 — persists the mapper's own match confidence
-- (exact/alias/fuzzy) on a takeoff-sourced line, so the UI can badge a
-- fuzzy match "check match" even after a reload, not just live during a
-- sync. NULL for a manual line (never went through the mapper).
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS match_confidence TEXT;
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_match_confidence_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_match_confidence_check
  CHECK (match_confidence IS NULL OR match_confidence IN ('exact','alias','fuzzy','none'));

-- Fix round 2 / SF4 — tracks whether a line's current item_id/assembly_id
-- came from the mapper ('auto') or an estimator's manual resolve ('manual'),
-- so sync-takeoff can re-run the mapper on an 'auto' line whose underlying
-- takeoff description changed, while leaving a manual pick alone (flagged
-- instead of silently overwritten).
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS match_source TEXT;
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_match_source_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_match_source_check
  CHECK (match_source IS NULL OR match_source IN ('auto','manual'));

-- Fix round 2 / SF4 — the raw takeoff description a line was last synced
-- against, so a later sync can tell "the underlying takeoff line changed"
-- apart from "the estimator renamed this line's own description".
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS synced_description TEXT;
