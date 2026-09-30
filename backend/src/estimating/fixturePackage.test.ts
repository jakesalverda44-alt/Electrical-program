// Price accuracy round, decision 3 — a quote flagged as the fixture package:
// fixture lines price material at $0 and keep their labor. Never inferred.
import { describe, it, expect } from 'vitest';
import { SEED_ITEMS } from './seed/laborUnits';
import type { Library, LibraryItem } from './library';
import { resolveLines, isFixtureLine, BidLineRow } from './bidEstimate';
import type { EstUnit } from './pricing';

const items: LibraryItem[] = SEED_ITEMS.map(i => ({
  id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost,
  material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true,
}));
const library: Library = { items, assemblies: [], factors: [] };
const line = (id: string, category: string, description: string, item_id: string, extra: Partial<BidLineRow> = {}) =>
  ({ id, line_key: id, category, description, qty: 10, unit: 'EA' as EstUnit, item_id, assembly_id: null, source: 'takeoff', sort: 0, ...extra }) as BidLineRow;

const lines = [
  line('a', 'Interior Lighting', 'Type A — 2X4 LED recessed troffer', 'LTG-TROF24'),
  line('h', 'Interior Lighting', 'Type H — LED high bay 2x4', 'LTG-HIBAY24'),
  line('f', 'Interior Lighting', 'Type F1 — Exhaust fan, NuTone 696N', 'SPEC-KITCHEN'),
  line('d', 'Branch Power', 'Duplex receptacle', 'DEV-DUP'),
  line('o', 'Interior Lighting', 'Type G — can light (price typed)', 'LTG-DOWN', { material_unit_override: 40 }),
];

describe('decision 3 — the fixture package is quoted', () => {
  it('fixture lines lose their library material and keep their labor; nothing else moves', () => {
    const off = resolveLines(lines, library);
    const on = resolveLines(lines, library, { fixturePackageQuoted: true });
    const by = (xs: typeof on) => Object.fromEntries(xs.map(x => [x.id, x]));
    const a = by(off), b = by(on);
    expect(b.a.materialUnitCost).toBe(0);
    expect(b.h.materialUnitCost).toBe(0);
    expect(b.a.laborHoursUnit).toBe(a.a.laborHoursUnit);
    expect(b.h.laborHoursUnit).toBe(1.0);
    expect(b.f.materialUnitCost).toBe(a.f.materialUnitCost); // an exhaust fan under lighting is not a fixture
    expect(b.d.materialUnitCost).toBe(6);
    expect(b.o.materialUnitOverride).toBe(40); // the estimator's typed material still wins
    expect(b.a.matched).toBe(true);
  });

  it('off by default — no bid changes unless the estimator flags a quote', () => {
    expect(resolveLines(lines, library).find(x => x.id === 'a')!.materialUnitCost).toBe(95);
  });

  it('knows a fixture line', () => {
    expect(isFixtureLine({ category: 'Interior Lighting', description: 'Type A', unit: 'EA' }, '2x4 LED recessed troffer', 'Interior Lighting')).toBe(true);
    expect(isFixtureLine({ category: 'Exterior Site Lighting', description: 'Type D wall pack', unit: 'EA' }, 'Wall pack, LED', 'Exterior / Site Lighting')).toBe(true);
    expect(isFixtureLine({ category: 'Lighting Controls', description: 'Occupancy sensor', unit: 'EA' }, 'Occupancy sensor, wall-switch type', 'Lighting Controls')).toBe(false);
    expect(isFixtureLine({ category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA' }, '20A 125V duplex receptacle, spec grade', 'Branch Power')).toBe(false);
  });
});
