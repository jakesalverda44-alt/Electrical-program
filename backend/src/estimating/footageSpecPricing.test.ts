// Q4 — typing a run length on a NEEDS FOOTAGE feeder/HVAC allowance line
// prices the conduit AND the wire (run × conductors), resolved through the
// mapper against the (seed) library.
import { describe, it, expect } from 'vitest';
import { SEED_ITEMS } from './seed/laborUnits';
import { Library, LibraryItem } from './library';
import { resolveLines, toLibraryCandidates, BidLineRow } from './bidEstimate';
import { priceBid } from './pricing';
import { runSpecParts, priceRunSpec } from './footageSpecPricing';

const items: LibraryItem[] = SEED_ITEMS.map(i => ({ id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost, material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true }));
const library: Library = { items, assemblies: [], factors: [] };
const HVAC = 'NEEDS FOOTAGE — HVAC feeders 3/4" 3#6 1#10G';

function line(over: Partial<BidLineRow>): BidLineRow {
  return { id: 'l1', line_key: 'l1', category: 'Site / Underground / Allowances', description: HVAC, qty: 100, unit: 'LF', item_id: null, assembly_id: null, source: 'takeoff', sort: 0, ...over } as BidLineRow;
}
const neutral = { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 };

describe('Q4 — NEEDS FOOTAGE run spec pricing', () => {
  it('reads conduit + conductors off the real 36th HVAC allowance text', () => {
    expect(runSpecParts(HVAC)).toEqual([
      { description: '3/4" EMT (incl. couplings/straps)', perFtOfRun: 1 },
      { description: '#6 THHN/THWN copper conductor', perFtOfRun: 3 },
      { description: '#10 THHN/THWN copper conductor', perFtOfRun: 1 },
    ]);
    expect(runSpecParts('HVAC feeders 3/4" 3#6 1#10G')).toBeNull(); // only NEEDS FOOTAGE lines
    // An EMPTY conduit run is complete as conduit only; a run naming neither is nothing.
    expect(runSpecParts('NEEDS FOOTAGE — 3/4" empty control conduit through inaccessible locations')).toEqual([{ description: '3/4" EMT (incl. couplings/straps)', perFtOfRun: 1 }]);
    expect(runSpecParts('NEEDS FOOTAGE — Site lighting underground conduit and wire to poles S1/S2')).toBeNull();
    expect(priceRunSpec(HVAC, toLibraryCandidates(library), new Map(items.map(i => [i.id, i])))!.parts.map(p => p.code)).toEqual(['EMT-075', 'THHN-6', 'THHN-10']);
  });

  it('100 ft typed → 100 ft 3/4" EMT + 300 ft #6 + 100 ft #10', () => {
    const [r] = priceBid(resolveLines([line({})], library), neutral, []).lines;
    // $60/C + 3 × $360/M + $150/M per 100 ft: 60 + 108 + 15 = $183; 4.0 + 2.1 + 0.42 = 6.52 h.
    expect(r.materialExt).toBeCloseTo(183, 6);
    expect(r.hoursExt).toBeCloseTo(6.52, 6);
    expect(r.unresolved).toBe(false);
  });

  it('0 ft is still $0; a hand-resolved match is left alone', () => {
    expect(priceBid(resolveLines([line({ qty: 0 })], library), neutral, []).lines[0].materialExt).toBe(0);
    const manual = priceBid(resolveLines([line({ item_id: 'EMT-075', match_source: 'manual' })], library), neutral, []).lines[0];
    expect(manual.materialExt).toBeCloseTo(60, 6); // conduit only, as the estimator chose
  });
});
