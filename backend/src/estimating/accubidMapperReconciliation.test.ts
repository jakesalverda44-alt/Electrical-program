// Review round 2 / B3 blocker + S18 — the pure, no-DB test the review asked
// for: import the REAL Kissimmee BOM against the real seed catalog, then run
// the takeoff mapper over the seed catalog's own standard phrases and assert
// each keeps its seed pick (kind + a sane $/hrs), never an accubid-imported
// duplicate — no DB, so no pollution risk (S18's whole point).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mapTakeoffLine, LibraryCandidate } from './mapper';
import { buildImportPreview, ImportedItemPlan } from './accubidImport';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';
import { Library, LibraryItem, LibraryAssembly } from './library';

const FIXDIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

function seedLibrary(): Library {
  const items: LibraryItem[] = SEED_ITEMS.map(i => ({
    id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit,
    material_cost: i.materialCost, material_price_date: null, labor_hours: i.laborHours,
    aliases: i.aliases, source: 'seed', active: true,
  }));
  const byCode = new Map(SEED_ITEMS.map(i => [i.code, i]));
  const assemblies: LibraryAssembly[] = SEED_ASSEMBLIES.map(a => ({
    id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit,
    aliases: a.aliases, source: 'seed', active: true,
    components: a.components.map(c => ({
      item_id: c.itemCode, item_code: c.itemCode, item_name: byCode.get(c.itemCode)?.name ?? c.itemCode, qty_per: c.qtyPer,
    })),
  }));
  return { items, assemblies, factors: [] };
}

function toCandidates(library: Library): LibraryCandidate[] {
  const assemblies: LibraryCandidate[] = library.assemblies.filter(a => a.active).map(a => (
    { kind: 'assembly', id: a.id, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: a.source }
  ));
  const items: LibraryCandidate[] = library.items.filter(i => i.active).map(i => (
    { kind: 'item', id: i.id, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases, source: i.source }
  ));
  return [...assemblies, ...items];
}

/** Simulates applying a preview's create/update plans onto an in-memory
 *  Library, without touching the DB — exactly what applyImportPreview does
 *  to real rows, in memory, for a pure test. */
function applyPlanInMemory(library: Library, items: ImportedItemPlan[]): Library {
  const byCode = new Map(library.items.map(i => [i.code, i]));
  for (const plan of items) {
    if (plan.action === 'create') {
      byCode.set(plan.code, {
        id: plan.code, code: plan.code, name: plan.name, category: plan.category, unit: plan.unit,
        material_cost: plan.materialCost ?? 0, material_price_date: plan.materialCost != null ? '2026-06-18' : null,
        labor_hours: plan.laborHours ?? 0, aliases: [], source: 'accubid', active: true,
      });
    } else if (plan.action === 'update') {
      const existing = byCode.get(plan.code);
      // Mirrors applyImportPreview's own real behavior: an update always
      // (re)stamps source='accubid' (markAccubidSource), same as the real
      // apply path — a reconciled write is never left/relabelled 'manual'.
      if (existing) byCode.set(plan.code, { ...existing, labor_hours: plan.laborHours ?? existing.labor_hours, material_cost: plan.materialCost ?? existing.material_cost, source: 'accubid' });
    }
  }
  return { items: Array.from(byCode.values()), assemblies: library.assemblies, factors: [] };
}

describe('B3 / S18 — the seed catalog keeps its own picks after a real Kissimmee import', () => {
  const before = seedLibrary();
  const preview = buildImportPreview(read('kissimmee-bom.txt'), before, { applyPrices: true, bomDate: '2026-06-18' });
  const after = applyPlanInMemory(before, preview.items);
  const candidatesBefore = toCandidates(before);
  const candidatesAfter = toCandidates(after);

  it('the import actually creates accubid rows (the regression needs them present to reproduce)', () => {
    const created = preview.items.filter(i => i.action === 'create');
    expect(created.length).toBeGreaterThan(20);
    expect(after.items.length).toBeGreaterThan(before.items.length);
  });

  const cases: Array<{ desc: string; unit: string; expectCode: string; expectKind: 'item' | 'assembly'; expectUnit: string }> = [
    { desc: '3/4" EMT', unit: 'LF', expectCode: 'EMT-075', expectKind: 'item', expectUnit: 'C' },
    { desc: '1" EMT', unit: 'LF', expectCode: 'EMT-100', expectKind: 'item', expectUnit: 'C' },
    { desc: '2" PVC Schedule 40 conduit', unit: 'LF', expectCode: 'PVCB-200', expectKind: 'item', expectUnit: 'C' },
    { desc: '#12 THHN', unit: 'LF', expectCode: 'THHN-12', expectKind: 'item', expectUnit: 'M' },
    { desc: '20A 125V duplex receptacle, spec grade', unit: 'EA', expectCode: 'ASM-DUPLEX', expectKind: 'assembly', expectUnit: 'EA' },
    { desc: 'GFCI receptacle', unit: 'EA', expectCode: 'DEV-GFCI', expectKind: 'item', expectUnit: 'EA' },
    { desc: 'Type A - 2x4 LED recessed troffer', unit: 'EA', expectCode: 'ASM-TROFFER-24', expectKind: 'assembly', expectUnit: 'EA' },
    { desc: 'Exit sign', unit: 'EA', expectCode: 'LTG-EXIT', expectKind: 'item', expectUnit: 'EA' },
    { desc: 'LED wall pack', unit: 'EA', expectCode: 'LTG-WPACK', expectKind: 'item', expectUnit: 'EA' },
  ];

  it('BEFORE any import, every phrase already maps to its real seed item/assembly (sanity)', () => {
    for (const c of cases) {
      const mapped = mapTakeoffLine({ category: '', description: c.desc, qty: 1, unit: c.unit }, candidatesBefore);
      expect(mapped.matchedCode, `${c.desc} (before import)`).toBe(c.expectCode);
    }
  });

  it('AFTER the real Kissimmee import, every phrase STILL maps to its real seed item/assembly, never an ACB-* duplicate', () => {
    for (const c of cases) {
      const mapped = mapTakeoffLine({ category: '', description: c.desc, qty: 1, unit: c.unit }, candidatesAfter);
      expect(mapped.matchedCode, `${c.desc} (after import)`).toBe(c.expectCode);
      expect(mapped.matchedKind, c.desc).toBe(c.expectKind);
      expect(mapped.matchedCode, c.desc).not.toMatch(/^ACB-/);
    }
  });

  it('the specific B3 repro: a 1,200 LF run of 3/4" EMT still prices at the real (now reconciled) seed rate, not an EMT connector', () => {
    const mapped = mapTakeoffLine({ category: '', description: '3/4" EMT', qty: 1200, unit: 'LF' }, candidatesAfter);
    expect(mapped.matchedCode).toBe('EMT-075');
    const seedItem = after.items.find(i => i.code === 'EMT-075')!;
    // Review round 2 / B3 — the normalized-spec reconciliation (kind=conduit,
    // size=3/4in, material=emt) now updates EMT-075 IN PLACE with Chris's own
    // Kissimmee rate ($92.38/C net, 3.2 h/C — Part B's own verified facts),
    // rather than leaving the seed's $60/4.0h placeholder untouched and
    // creating a same-meaning duplicate elsewhere. Either way, the outcome
    // the review cares about holds: never the connector's numbers.
    expect(seedItem.material_cost).toBeCloseTo(92.38, 2);
    expect(seedItem.labor_hours).toBeCloseTo(3.2, 2);
    expect(seedItem.source).toBe('accubid'); // updateItem's own contract: a reconciled write is still accubid-sourced, never silently 'manual'
    // And it must NOT be the connector's tiny $ea / high per-C hours the review found.
    const connector = after.items.find(i => /connector/i.test(i.name) && /emt/i.test(i.name) && /3\/4/.test(i.name));
    if (connector) expect(mapped.matchedCode).not.toBe(connector.code);
  });

  it('sanity check per matched item/assembly: finite, non-negative $/hrs', () => {
    for (const c of cases) {
      const mapped = mapTakeoffLine({ category: '', description: c.desc, qty: 1, unit: c.unit }, candidatesAfter);
      expect(mapped.matchedUnit).toBe(c.expectUnit);
      if (mapped.matchedKind === 'item') {
        const item = after.items.find(i => i.code === mapped.matchedCode)!;
        expect(Number.isFinite(item.material_cost)).toBe(true);
        expect(Number.isFinite(item.labor_hours)).toBe(true);
        expect(item.labor_hours).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
