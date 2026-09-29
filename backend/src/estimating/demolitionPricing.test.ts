// Remodel + footage round, B3 — demolition lines (Builder A1 emits them in a
// "Demolition" takeoff category) map to demolition labor units seeded from
// Chris's own 36th Street BOM rows, at $0 material, and never cross over to
// or from new-work items.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SEED_ITEMS, SEED_ASSEMBLIES, DEMOLITION_ITEMS } from './seed/laborUnits';
import { mapTakeoffLines, LibraryCandidate, fromLegacyTakeoff } from './mapper';
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

  it('migration 150 seeds exactly these items and the default footage ratios', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/150_demolition_units_footage_ratios.sql'), 'utf8');
    for (const i of DEMOLITION_ITEMS) {
      const re = new RegExp(`\\('${i.code}', '${i.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}', 'Demolition', 'EA', 0, NULL, ${i.laborHours},`);
      expect(sql, i.code).toMatch(re);
    }
    const json = sql.match(/SELECT 'est_footage_ratios', '(.*)'\n/)![1].replace(/''/g, "'");
    expect(parseFootageSettings(json)).toEqual(DEFAULT_FOOTAGE_SETTINGS);
    expect(JSON.parse(json).looErrorPct).toEqual(DEFAULT_FOOTAGE_SETTINGS.looErrorPct);
  });
});
