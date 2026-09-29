// Remodel + footage round, B3 — demolition lines (Builder A1 emits them in a
// "Demolition" takeoff category) map to demolition labor units seeded from
// Chris's own 36th Street BOM rows, at $0 material, and never cross over to
// or from new-work items.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SEED_ITEMS, SEED_ASSEMBLIES, DEMOLITION_ITEMS } from './seed/laborUnits';
import { mapTakeoffLines, LibraryCandidate, fromLegacyTakeoff, isLumpSumDemolition } from './mapper';
import { priceBid, PricingLineInput } from './pricing';
import { parseFootageSettings, DEFAULT_FOOTAGE_SETTINGS } from './footageAllowance';

const candidates: LibraryCandidate[] = [
  ...SEED_ASSEMBLIES.map(a => ({ kind: 'assembly' as const, id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed' })),
  ...SEED_ITEMS.map(i => ({ kind: 'item' as const, id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases, source: 'seed' })),
];
const itemByCode = new Map(SEED_ITEMS.map(i => [i.code, i]));

// Chris's 36th Street demolition, as Builder A1's takeoff lines would carry it.
const DEMO_ROWS = [
  { category: 'Demolition', item: 'Demolition — 2x4 fluorescent fixture', qty: 52, unit: 'EA', code: 'DEMO-FLUOR24' },
  { category: 'Demolition', item: 'Demolition — HID high bay', qty: 2, unit: 'EA', code: 'DEMO-HIDHB' },
  { category: 'Demolition', item: 'Demolition — exit/emergency light', qty: 2, unit: 'EA', code: 'DEMO-EXITEM' },
  { category: 'Demolition', item: 'Demolition — receptacle', qty: 18, unit: 'EA', code: 'DEMO-RECEPT' },
  { category: 'Demolition', item: 'Demolition — single pole switch', qty: 6, unit: 'EA', code: 'DEMO-SW1P' },
  { category: 'Demolition', item: 'Demolition — 3-way switch', qty: 2, unit: 'EA', code: 'DEMO-SW3W' },
];

describe('B3 — demolition labor units', () => {
  it("are Chris's 36th Street BOM rates, $0 material", () => {
    const hours = Object.fromEntries(DEMOLITION_ITEMS.map(i => [i.code, i.laborHours]));
    expect(hours).toEqual({ 'DEMO-FLUOR24': 0.31, 'DEMO-HIDHB': 0.58, 'DEMO-EXITEM': 0.5, 'DEMO-RECEPT': 0.132, 'DEMO-SW1P': 0.128, 'DEMO-SW3W': 0.155, 'DEMO-JBOX': 0.24 });
    expect(DEMOLITION_ITEMS.every(i => i.materialCost === 0 && i.category === 'Demolition' && i.unit === 'EA')).toBe(true);
  });

  it('Demolition lines map to them and price to the same 21.734 h Chris carried (no $ material)', () => {
    const mapped = mapTakeoffLines(fromLegacyTakeoff(DEMO_ROWS), candidates);
    expect(mapped.map(m => m.matchedCode)).toEqual(DEMO_ROWS.map(r => r.code));
    const lines: PricingLineInput[] = mapped.map((m, i) => {
      const it = itemByCode.get(m.matchedCode!)!;
      return {
        id: String(i), category: m.category, description: m.description, qty: m.qty, unit: 'EA', libraryUnit: 'EA',
        materialUnitCost: it.materialCost, laborHoursUnit: it.laborHours, matched: true, unresolved: false, unverifiedPrice: false, unitUnknown: false,
        excluded: false, confidence: null, materialUnitOverride: null, laborHoursOverride: null, matchConfidence: m.matchConfidence,
      } as PricingLineInput;
    });
    const recap = priceBid(lines, { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 }, []);
    // 52×0.31 + 2×0.58 + 2×0.50 + 18×0.132 + 6×0.128 + 2×0.155 — Chris's BOM: 16.12+1.16+1.00+2.376+0.768+0.31.
    expect(recap.totals.laborHours).toBeCloseTo(21.734, 6);
    expect(recap.totals.materialSubtotal).toBe(0);
  });

  it('never crosses over: a new 2x4 troffer is not demolition, a demolished troffer is not a new one', () => {
    const [install, remove] = mapTakeoffLines(fromLegacyTakeoff([
      { category: 'Interior Lighting', item: '2x4 LED troffer', qty: 14, unit: 'EA' },
      { category: 'Demolition', item: 'Demolition — 2x4 troffer', qty: 5, unit: 'EA' },
    ]), candidates);
    expect(install.matchedCode).toBe('LTG-TROF24');
    expect(remove.matchedCode === null || remove.matchedCode.startsWith('DEMO-')).toBe(true);
  });

  it('migration 150 seeds these items and the default footage ratios; 152 adds every current alias', () => {
    const m152 = fs.readFileSync(path.join(__dirname, '../../../database/migrations/152_footage_round_fixes.sql'), 'utf8');
    for (const i of DEMOLITION_ITEMS) {
      const stmt = m152.split('\n').find(l => l.startsWith('UPDATE est_items') && m152.includes(`WHERE code = '${i.code}'`) && l.includes(`'${i.aliases[0].replace(/'/g, "''")}'`));
      expect(stmt, i.code).toBeTruthy();
      for (const a of i.aliases) expect(m152, `${i.code} alias ${a}`).toContain(`'${a.replace(/'/g, "''")}'`);
    }
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/150_demolition_units_footage_ratios.sql'), 'utf8');
    for (const i of DEMOLITION_ITEMS) {
      const re = new RegExp(`\\('${i.code}', '${i.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}', 'Demolition', 'EA', 0, NULL, ${i.laborHours},`);
      expect(sql, i.code).toMatch(re);
    }
    const json = sql.match(/SELECT 'est_footage_ratios', '(.*)'\n/)![1].replace(/''/g, "'");
    expect(parseFootageSettings(json)).toEqual(DEFAULT_FOOTAGE_SETTINGS);
    expect(JSON.parse(json).looErrorPct).toEqual(DEFAULT_FOOTAGE_SETTINGS.looErrorPct);
  });

  it('SF-1: "Demo existing 2x4 fluorescent fixtures" in "Demo / Removals" maps to the demo unit, never a new troffer', () => {
    const [m, r, keep] = mapTakeoffLines(fromLegacyTakeoff([
      { category: 'Demo / Removals', item: 'D1', spec: 'Demo existing 2x4 fluorescent fixtures', qty: 52, unit: 'EA' },
      { category: 'Branch Power', item: 'R1', spec: 'Remove existing receptacle', qty: 18, unit: 'EA' },
      { category: 'Interior Lighting', item: 'L1', spec: 'Existing 2x4 troffer to remain', qty: 4, unit: 'EA' },
    ]), candidates);
    expect(m.matchedCode).toBe('DEMO-FLUOR24');
    expect(r.matchedCode).toBe('DEMO-RECEPT');
    expect(keep.matchedCode === null || !keep.matchedCode.startsWith('DEMO-')).toBe(true);
  });

  it('NSF-1: relocate / reinstall / replace / remove-and-reinstall are install work, never demolition', () => {
    const rows = [
      { category: 'Branch Power', item: 'X1', spec: 'Relocate existing receptacle (remove and reinstall)', qty: 2, unit: 'EA' },
      { category: 'Branch Power', item: 'X2', spec: 'Duplex receptacle, replace removed device', qty: 3, unit: 'EA' },
      { category: 'Interior Lighting', item: 'X3', spec: 'Remove and reinstall existing 2x4 troffer', qty: 4, unit: 'EA' },
      { category: 'Interior Lighting', item: 'X4', spec: 'Demo kitchen pendant (Demonstration kitchen)', qty: 1, unit: 'EA' },
    ];
    for (const m of mapTakeoffLines(fromLegacyTakeoff(rows), candidates)) {
      expect(m.matchedCode?.startsWith('DEMO-') ?? false, m.description).toBe(false);
    }
  });

  it('a demolition line maps only to a demo unit of its own device class; no class → unresolved, never fuzzy', () => {
    const [recept, sw3, fan, hid] = mapTakeoffLines(fromLegacyTakeoff([
      { category: 'Demolition', item: 'D1', spec: 'Demolition — duplex outlets in office', qty: 6, unit: 'EA' },
      { category: 'Demolition', item: 'D2', spec: 'Demolition — 3-way switch at stair', qty: 2, unit: 'EA' },
      { category: 'Demolition', item: 'D3', spec: 'Demolition — ceiling fan', qty: 1, unit: 'EA' },
      { category: 'Demo / Removals', item: 'D4', spec: 'Remove 400W metal halide high bays', qty: 2, unit: 'EA' },
    ]), candidates);
    expect(recept.matchedCode).toBe('DEMO-RECEPT');
    expect(sw3.matchedCode).toBe('DEMO-SW3W');
    expect(fan.matchedCode).toBeNull();
    expect(hid.matchedCode).toBe('DEMO-HIDHB');
  });

  it("Builder A's real demolition row shape (item = our unit name, spec = A's evidence) still maps 6/6 exact", () => {
    const rows = [
      ['Demolition — fluorescent fixture up to 2x4', 'Existing to be removed — counted A3.0 52 (DEMO-FIXTURE 52)', 'DEMO-FLUOR24'],
      ['Demolition — HID high bay fixture', 'Existing to be removed — counted A3.0 2 (DEMO-HID 2)', 'DEMO-HIDHB'],
      ['Demolition — exit/emergency light', 'Existing to be removed — counted A2.0 2 (DEMO-EXIT 2)', 'DEMO-EXITEM'],
      ['Demolition — receptacle', 'Existing to be removed — counted A2.0 18 (DEMO-RECEPT 18)', 'DEMO-RECEPT'],
      ['Demolition — single-pole switch', 'Existing to be removed — counted A2.0 6 (DEMO-SW 6)', 'DEMO-SW1P'],
      ['Demolition — 3-way switch', 'Existing to be removed — counted A2.0 2 (DEMO-SW3 2)', 'DEMO-SW3W'],
    ];
    const mapped = mapTakeoffLines(fromLegacyTakeoff(rows.map(([item, spec]) => ({ category: 'Demolition', item, spec, qty: 1, unit: 'EA' }))), candidates);
    expect(mapped.map(m => m.matchedCode)).toEqual(rows.map(r => r[2]));
  });

  it('re-check 2: a lump-sum demolition line never maps to one device\'s unit — it asks for the breakdown', () => {
    const [lot, all, single] = mapTakeoffLines(fromLegacyTakeoff([
      { category: 'Demolition', item: 'D9', spec: 'Demo all existing lighting, receptacles and switches', qty: 1, unit: 'EA' },
      { category: 'Demolition', item: 'D10', spec: 'Demolition — all existing lighting', qty: 1, unit: 'EA' },
      { category: 'Demolition', item: 'D11', spec: 'Demolition — duplex receptacles', qty: 18, unit: 'EA' },
    ]), candidates);
    expect(lot.matchedCode).toBeNull();
    expect(all.matchedCode).toBeNull();
    expect(single.matchedCode).toBe('DEMO-RECEPT');
    expect(isLumpSumDemolition('Demolition', 'Demo all existing lighting, receptacles and switches')).toBe(true);
    expect(isLumpSumDemolition('Demolition', 'Demolition — exit/emergency light')).toBe(false);
  });
});
