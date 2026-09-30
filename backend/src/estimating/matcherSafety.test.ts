// Price accuracy round, C1 — matcher safety, on the real rows that priced
// the 36th Street live re-run (ab7e1dc6, 2026-09-29b) at $39,026: a panel's
// circuit list fuzzy-matched a 15 kVA transformer (17 × $1,100 / 4 h) and an
// A/C compressor connection did too. Plus a regression sweep over every
// Kissimmee and 36th proposed line: no fuzzy match crosses a family, and no
// fuzzy match into gear or above $250 / 2 h per unit prices without the
// estimator's confirmation.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SEED_ITEMS, SEED_ASSEMBLIES } from './seed/laborUnits';
import { Library, LibraryItem, LibraryAssembly } from './library';
import { parseAgent2Takeoff, toLibraryCandidates, resolveLines, storedMatchConfidence, mapperNote, BidLineRow, RawTakeoffRow } from './bidEstimate';
import {
  mapTakeoffLines, mapTakeoffLine, fromLegacyTakeoff, equipmentFamily, familiesConflict, lineFamily, candidateFamily,
  isCircuitListRow, isEquipmentConnectionRow, statedAmperage, CIRCUIT_LIST_NOTE, LibraryCandidate,
} from './mapper';
import { parseAgent2Allowances, allowanceRows } from './footageAllowanceDb';
import { priceBid, EstUnit } from './pricing';

const items: LibraryItem[] = SEED_ITEMS.map(i => ({
  id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, material_cost: i.materialCost,
  material_price_date: null, labor_hours: i.laborHours, aliases: i.aliases, source: 'seed', active: true,
}));
const byCode = new Map(items.map(i => [i.code, i]));
const assemblies: LibraryAssembly[] = SEED_ASSEMBLIES.map(a => ({
  id: a.code, code: a.code, name: a.name, category: a.category, unit: a.unit, aliases: a.aliases, source: 'seed', active: true,
  components: a.components.map(c => ({ item_id: c.itemCode, item_code: c.itemCode, item_name: byCode.get(c.itemCode)?.name ?? '', qty_per: c.qtyPer })),
}));
const library: Library = { items, assemblies, factors: [] };
const candidates = toLibraryCandidates(library);

const FIX = path.join(__dirname, '../test/fixtures/estimating');
function proposedRows(file: string): RawTakeoffRow[] {
  const run = JSON.parse(fs.readFileSync(path.join(FIX, file), 'utf8'));
  const raw = '```json\n' + JSON.stringify(run.agent2) + '\n```';
  return [...parseAgent2Takeoff(raw), ...(allowanceRows(parseAgent2Allowances(raw)) as RawTakeoffRow[])];
}
const run36 = proposedRows('price-accuracy/36th-street-run-2026-09-29b.json');
const find36 = (re: RegExp) => run36.find(r => re.test(r.item))!;

describe('C1 — the two 36th culprits', () => {
  it('the Panel A circuit list (17 EA) never becomes a transformer: unresolved with the allowance note', () => {
    const row = find36(/^Branch circuit \?\/1/);
    const [m] = mapTakeoffLines(fromLegacyTakeoff([row]), candidates);
    expect(m.matchedCode).toBeNull();
    expect(m.matchConfidence).toBe('none');
    expect(m.note).toBe(CIRCUIT_LIST_NOTE);
    expect(mapperNote(m)).toBe(CIRCUIT_LIST_NOTE);
  });

  it('"A/C Comp Unit #1 … 40A/2P" never matches XFMR-15: no 40A equipment unit → unresolved, saying why', () => {
    const row = find36(/^COMP #1/);
    const [m] = mapTakeoffLines(fromLegacyTakeoff([row]), candidates);
    expect(m.matchedCode).toBeNull();
    expect(m.note).toMatch(/Equipment connection \(40A\/2P\)/);
  });

  it('with a 40A/2P equipment-connection unit in the library, the compressor and air handler map to it', () => {
    const unit: LibraryCandidate = { kind: 'item', id: 'EQC-40-2', code: 'EQC-40-2', name: 'Equipment connection, 40A 2P', category: 'Branch Power', unit: 'EA', aliases: [], materialCost: 35, laborHours: 1.5 };
    const unit30: LibraryCandidate = { ...unit, id: 'EQC-30-2', code: 'EQC-30-2', name: 'Equipment connection, 30A 2P' };
    const lib = [...candidates, unit30, unit];
    for (const re of [/^COMP #1/, /^AHU #1/, /^COMP #2/]) {
      const [m] = mapTakeoffLines(fromLegacyTakeoff([find36(re)]), lib);
      expect(m.matchedCode).toBe('EQC-40-2');
      expect(m.confirmReason).toBeNull();
    }
  });

  it('the 36th proposal no longer carries $18,700 + 68 h of transformer', () => {
    const mapped = mapTakeoffLines(fromLegacyTakeoff(run36), candidates);
    expect(mapped.filter(m => m.matchedCode?.startsWith('XFMR'))).toEqual([]);
  });
});

describe('C1 — families', () => {
  it('reads a line family from words, category and unit', () => {
    expect(equipmentFamily('Transformer, dry-type, 15 kVA', 'Service & Distribution', 'EA')).toBe('transformer');
    expect(equipmentFamily('A/C Comp Unit #1, Panel A ckts 15,17, 40A/2P', 'Branch Power', 'EA')).toBe('equipment_connection');
    expect(equipmentFamily('Disconnect, warehouse north wall', 'Branch Power', 'EA')).toBe('disconnect');
    expect(equipmentFamily('Wall pack, LED', 'Exterior / Site Lighting', 'EA')).toBe('fixture');
    expect(equipmentFamily('WP GFCI receptacle exterior at condensers', 'Branch Power', 'EA')).toBe('device');
    expect(equipmentFamily('Roof photocell sensor on RTU, facing north', 'Lighting Controls', 'EA')).toBe('control');
    expect(equipmentFamily('Lighting relay/control panel', 'Lighting Controls', 'EA')).toBe('control');
    expect(equipmentFamily('Panelboard, 225A MLO', 'Service & Distribution', 'EA')).toBe('gear');
    expect(equipmentFamily('#12 THHN/THWN copper conductor', 'Branch Power', 'LF')).toBe('wire');
    expect(equipmentFamily('3/4" EMT (incl. couplings/straps)', 'Branch Power', 'LF')).toBe('conduit');
    expect(equipmentFamily('Type X', 'Interior Lighting', 'EA')).toBe('fixture');
  });

  it('device and control may match each other; nothing else crosses', () => {
    expect(familiesConflict('device', 'control')).toBe(false);
    expect(familiesConflict('fixture', 'disconnect')).toBe(true);
    expect(familiesConflict('equipment_connection', 'transformer')).toBe(true);
    expect(familiesConflict(null, 'transformer')).toBe(false);
  });

  it('recognizes circuit lists, equipment connections and their amperage', () => {
    expect(isCircuitListRow({ description: '1 1; 2 1; 3 1; 4 1; 5 1', altText: 'Branch circuit ?/1 — Panel A', unit: 'EA' })).toBe(true);
    expect(isCircuitListRow({ description: 'Work/sales/exit', altText: 'Branch circuit 20/1 - Panel A', unit: 'EA' })).toBe(true);
    expect(isCircuitListRow({ description: 'Duplex receptacle', altText: null, unit: 'EA' })).toBe(false);
    expect(isEquipmentConnectionRow({ description: 'Energize at unit disconnect', altText: 'RTU-1 - Rooftop unit, B-1,3,5 60/3', unit: 'EA', category: 'Branch Power' })).toBe(true);
    expect(isEquipmentConnectionRow({ description: 'A18, A20, WP lift cover', altText: 'WP GFCI receptacle exterior at condensers', unit: 'EA', category: 'Branch Power' })).toBe(false);
    expect(statedAmperage('A/C Comp Unit #1, 40A/2P, 3#6')).toEqual({ amps: 40, poles: 2 });
    expect(statedAmperage('RTU-1 - Rooftop unit, B-1,3,5 60/3, 3#6')).toEqual({ amps: 60, poles: 3 });
  });
});

describe('C1 — confirm-match lines', () => {
  it('a fuzzy match into gear is held for confirmation and prices at $0 / 0 h until confirmed', () => {
    const [m] = mapTakeoffLines(fromLegacyTakeoff([{ category: 'Branch Power', item: 'Electrical meter (M)', spec: 'Electrical meter', qty: 1, unit: 'EA' }]), candidates);
    expect(m.matchConfidence).toBe('fuzzy');
    expect(m.matchedCode).toBe('METERCT');
    expect(m.confirmReason).toMatch(/gear/);
    expect(storedMatchConfidence(m)).toBe('confirm');

    const line = {
      id: '1', line_key: '1', category: 'Branch Power', description: m.description, qty: 1, unit: 'EA' as EstUnit,
      item_id: 'METERCT', assembly_id: null, source: 'takeoff' as const, sort: 0, match_confidence: 'confirm' as const, match_source: 'auto' as const,
    } as BidLineRow;
    const neutral = { laborRate: 0, materialTaxPct: 0, smallToolsPct: 0, supervisionPct: 0, consumablesPct: 0, overheadPct: 0, profitPct: 0, crewSize: 1 };
    const held = priceBid(resolveLines([line], library), neutral, []);
    expect(held.totals.materialSubtotal).toBe(0);
    expect(held.totals.laborHours).toBe(0);
    expect(held.warnings.confirmMatchCount).toBe(1);
    expect(held.warnings.unmatchedCount).toBe(1);
    // The estimator confirms: the UI moves it to 'fuzzy' + a manual pick.
    const confirmed = priceBid(resolveLines([{ ...line, match_confidence: 'fuzzy', match_source: 'manual' }], library), neutral, []);
    expect(confirmed.totals.materialSubtotal).toBe(450);
    expect(confirmed.totals.laborHours).toBe(3);
    // A 'confirm' line the estimator picked by hand prices normally too.
    expect(priceBid(resolveLines([{ ...line, match_source: 'manual' }], library), neutral, []).totals.materialSubtotal).toBe(450);
  });

  it('a cheap same-family fuzzy match still prices automatically', () => {
    const [m] = mapTakeoffLines(fromLegacyTakeoff([find36(/^Type G/)]), candidates);
    expect(m.matchConfidence).toBe('fuzzy');
    expect(m.matchedCode).toBe('LTG-DOWN');
    expect(m.confirmReason).toBeNull();
    expect(storedMatchConfidence(m)).toBe('fuzzy');
  });

  it('above $250 or 2 h per unit waits for confirmation (Kissimmee: lighting contactors → relay panel $650 / 4 h)', () => {
    const [m] = mapTakeoffLines(fromLegacyTakeoff([{ category: 'Lighting Controls', item: 'Lighting contactors - WORK, SALES, SIGN', spec: 'Venstar LCP, line side Panel A', qty: 6, unit: 'EA' }]), candidates);
    expect(m.matchedCode).toBe('LC-RELAYPANEL');
    expect(m.confirmReason).toMatch(/\$650\.00 material each/);
  });

  it('exact and alias matches are never held (only fuzzy is)', () => {
    const m = mapTakeoffLine({ category: 'Service & Distribution', description: 'Panelboard 225A 208Y/120V 3P 42ckt MLO flush', qty: 2, unit: 'EA' }, candidates);
    expect(m.matchConfidence).toBe('alias');
    expect(m.confirmReason).toBeNull();
  });
});

describe('C1 — regression sweep over the Kissimmee and 36th proposed lines', () => {
  const files = ['price-accuracy/36th-street-run-2026-09-29b.json', 'price-accuracy/kissimmee-run-2026-09-28.json', '36th-street-run-2026-09-29.json'];
  for (const file of files) {
    it(`${file}: no fuzzy match crosses a family; gear / >$250 / >2 h fuzzy matches are held`, () => {
      const rows = proposedRows(file);
      const normalized = fromLegacyTakeoff(rows);
      const mapped = mapTakeoffLines(normalized, candidates);
      const report: string[] = [];
      mapped.forEach((m, i) => {
        if (m.matchConfidence !== 'fuzzy') return;
        const c = candidates.find(x => x.code === m.matchedCode)!;
        expect(familiesConflict(lineFamily(normalized[i]), candidateFamily(c))).toBe(false);
        const gear = ['gear', 'transformer'].includes(candidateFamily(c) ?? '');
        const costly = c.unit === 'EA' && ((c.materialCost ?? 0) > 250 || (c.laborHours ?? 0) > 2);
        expect(!!m.confirmReason).toBe(gear || costly);
        report.push(`${rows[i].item} → ${m.matchedCode}${m.confirmReason ? ' (confirm)' : ''}`);
      });
      // eslint-disable-next-line no-console
      console.log(`[C1 sweep] ${file}\n  ${report.join('\n  ')}`);
    });
  }

  it('pins the Kissimmee fuzzy set after C1 (the before list is in the C report)', () => {
    const rows = proposedRows('price-accuracy/kissimmee-run-2026-09-28.json');
    const mapped = mapTakeoffLines(fromLegacyTakeoff(rows), candidates);
    const fuzzy = mapped.map((m, i) => (m.matchConfidence === 'fuzzy' ? `${rows[i].item.slice(0, 14)}→${m.matchedCode}${m.confirmReason ? '?' : ''}` : null)).filter(Boolean);
    expect(fuzzy).toEqual([
      'DISCON A - 200→DISC-200?', 'DISCON B - 200→DISC-200?', 'SIGNS - Front →SPEC-EVFINAL', 'DATA-CONC - Ve→LV-DATA',
      "Type A - 8' LE→LTG-STRIP4", "Type B - 8' LE→LTG-STRIP4", "Type C - 4' LE→LTG-STRIP4", "Type M - 4' LE→LTG-STRIP4", "Type N - 4' LE→LTG-STRIP4",
      'Type S1 - fixt→LTG-POLEHEAD?', 'Type S2 - fixt→LTG-POLEHEAD?', 'Lighting conta→LC-RELAYPANEL?',
      'Venstar motion→LC-OCCSW', 'Occupancy sens→LC-OCCSW', 'Motion sensor →LC-OCCSW', 'Automatic ligh→LC-RELAYPANEL?', '3" PVC data & →LV-DATA',
    ]);
  });
});
