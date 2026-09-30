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
  isCircuitListRow, isEquipmentConnectionRow, statedAmperage, CIRCUIT_LIST_NOTE, LibraryCandidate, familyText, confidentLineFamily, categoryAllowsFamily, fuzzySafetyHold,
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

  it('the allowance units (ALW-*) are reached only by their exact name', () => {
    const m = mapTakeoffLine({ category: 'Interior Lighting', description: 'Support hardware per fixture', qty: 5, unit: 'EA' }, candidates);
    expect(m.matchedCode ?? '').not.toMatch(/^ALW-/);
    const exact = mapTakeoffLine({ category: 'Boxes, Fittings & Hardware (allowance)', description: 'Support hardware allowance — per fixture', qty: 5, unit: 'EA' }, candidates);
    expect(exact.matchedCode).toBe('ALW-HW-FIXTURE');
    expect(exact.matchConfidence).toBe('exact');
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
        // Fix round 3 — the safety net also holds a family / category mismatch.
        expect(!!m.confirmReason).toBe(gear || costly || fuzzySafetyHold(normalized[i], c) != null);
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
      'DISCON A - 200→DISC-200?', 'DISCON B - 200→DISC-200?', 'SIGNS - Front →SPEC-EVFINAL', 'DATA-CONC - Ve→LV-DATA?', // fix round 3: a low-voltage item under Branch Power is held
      "Type A - 8' LE→LTG-STRIP4", "Type B - 8' LE→LTG-STRIP4", "Type C - 4' LE→LTG-STRIP4", "Type M - 4' LE→LTG-STRIP4", "Type N - 4' LE→LTG-STRIP4",
      // Decision 5 — the 'pole fixture head' alias brings S1/S2 back as a
      // held (confirm) pole-head suggestion.
      'Type S1 - fixt→LTG-POLEHEAD?', 'Type S2 - fixt→LTG-POLEHEAD?', 'Lighting conta→LC-RELAYPANEL?',
      'Venstar motion→LC-OCCSW', 'Occupancy sens→LC-OCCSW', 'Motion sensor →LC-OCCSW', 'Automatic ligh→LC-RELAYPANEL?', '3" PVC data & →LV-DATA',
    ]);
  });
});

describe('C fix round — family precedence (review ceba1a4 B1 / S1 / S2 / nit)', () => {
  const map = (description: string, category = 'Interior Lighting') => mapTakeoffLine({ category, description, qty: 5, unit: 'EA' }, candidates);

  it('B1: a fixture with an integral sensor is a fixture, never the occupancy sensor', () => {
    expect(map('Type H — LED high bay with sensor').matchedCode).toBe('LTG-HIBAY');
    expect(map('Type S — LED strip with integral motion sensor').matchedCode).toBe('LTG-STRIP4');
    expect(map('Type F — LED high bay w/ integral occupancy sensor').matchedCode).toBe('LTG-HIBAY');
    for (const d of ['Type H — LED high bay with sensor', 'Type S — LED strip with integral motion sensor', 'Type F — LED high bay w/ integral occupancy sensor']) {
      expect(map(d).matchedCode).not.toBe('LC-OCCSW');
    }
    expect(equipmentFamily('Exterior wall pack w/ photocell', 'Interior Lighting', 'EA')).toBe('fixture');
    expect(equipmentFamily('Exterior wall pack w/ photocell', 'Branch Power', 'EA')).toBe('fixture');
    expect(equipmentFamily('Occupancy sensor Hubbell LHIRI', 'Lighting Controls', 'EA')).toBe('control');
  });

  it('S1: a disconnect keeps its disconnect unit whatever load it serves', () => {
    expect(map('RTU-1 disconnect, 60A NEMA 3R', 'Branch Power').matchedCode).toBe('DISC-60');
    expect(map('Condenser disconnect 30A', 'Branch Power').matchedCode).toBe('DISC-30');
    expect(map('Motor disconnect 30A', 'Branch Power').matchedCode).toBe('DISC-30');
    expect(map('Pump disconnect 30A', 'Branch Power').matchedCode).toBe('DISC-30');
    // …while a unit's own connection "with disconnect" is still its connection.
    expect(equipmentFamily('A/C compressor unit #1, 40A/2P, Panel A ckts 15,17, with disconnect', 'Branch Power', 'EA')).toBe('equipment_connection');
  });

  it('S2: LED flat panel / panel light / troffer on Panel A / security light wall pack are fixtures', () => {
    expect(equipmentFamily('Type A — 2x4 LED flat panel, Lithonia CPX', 'Branch Power', 'EA')).toBe('fixture');
    expect(equipmentFamily('Type P — LED panel light 2x4', 'Branch Power', 'EA')).toBe('fixture');
    expect(equipmentFamily('Type T — LED troffer, circuit to Panel A', 'Branch Power', 'EA')).toBe('fixture');
    expect(equipmentFamily('Security light wall pack', 'Branch Power', 'EA')).toBe('fixture');
    expect(equipmentFamily('Panelboard, 225A MLO', 'Service & Distribution', 'EA')).toBe('gear');
    expect(map('Type A — 2x4 LED flat panel, Lithonia CPX').matchedCode).toMatch(/TROF/);
    expect(map('Type P — LED panel light 2x4').matchedCode).toMatch(/TROF24/);
    // No size given and every troffer unit names one (2x4 / 2x2): unresolved and visible — never the GFCI circuit it hit before.
    expect(map('Type T — LED troffer, circuit to Panel A').matchedCode ?? 'none').not.toMatch(/GFCI/);
    // Fix round 3 — a compound stays in one family: the fan / light combo is
    // read by its fan; any fixture match for it is never auto-priced.
    const ef = map('Type EF — Exhaust fan / light combo');
    expect(ef.matchedCode === null || !!ef.confirmReason).toBe(true);
  });

  it('circuit references and schedule references never set the family', () => {
    expect(familyText('Type T — LED troffer, circuit to Panel A')).toBe('type t — led troffer,');
    expect(familyText('Panel A ckts 15,17, 40A/2P')).toBe(', 40a/2p');
    expect(equipmentFamily('Exhaust fan in restroom, not in fixture schedule (F1 only listed)', 'Branch Power', 'EA')).toBe('equipment_connection');
    expect(isCircuitListRow({ description: '20A/1P branch circuits 2#12 1#10G 1/2"C', altText: null, unit: 'EA' })).toBe(true);
  });

  it('nit: demolition units no longer dilute new-work words — the pole heads are held suggestions even without the alias', () => {
    const noAlias = candidates.map(c => (c.code === 'LTG-POLEHEAD' ? { ...c, aliases: c.aliases.filter(a => a !== 'pole fixture head') } : c));
    const [m] = mapTakeoffLines(fromLegacyTakeoff([{ category: 'Exterior Site Lighting', item: 'Type S1 - fixture heads (1 per pole)', spec: "Lithonia DSX1 LED P8 40K T4M MVOLT HS, MH 28'-0\"", qty: 2, unit: 'EA' }]), noAlias);
    expect(m.matchedCode).toBe('LTG-POLEHEAD');
    expect(m.confirmReason).toMatch(/confirm/);
  });
});

describe('C fix round 2 — N1: the head noun decides; "for / at / to / on …" clauses never do', () => {
  const m = (category: string, description: string) => mapTakeoffLine({ category, description, qty: 2, unit: 'EA' }, candidates);
  it('the reviewer\'s rows under lighting categories keep their own family', () => {
    const d = m('Exterior Site Lighting', 'Disconnect for sign lights');
    expect(equipmentFamily('Disconnect for sign lights', 'Exterior Site Lighting', 'EA')).toBe('disconnect');
    expect(d.matchedCode === null || /^DISC-/.test(d.matchedCode)).toBe(true);
    expect(m('Interior Lighting', 'Wall switch sensor for lights').matchedCode).toBe('LC-OCCSW');
    const x = m('Interior Lighting', 'Transformer for low voltage track lights');
    expect(equipmentFamily('Transformer for low voltage track lights', 'Interior Lighting', 'EA')).toBe('transformer');
    expect(x.matchedCode === null || (/^XFMR|ASM-XFMR/.test(x.matchedCode) && !!x.confirmReason)).toBe(true);
    const f = m('Exterior Site Lighting', 'Fused disconnect at pole light');
    expect(equipmentFamily('Fused disconnect at pole light', 'Exterior Site Lighting', 'EA')).toBe('disconnect');
    expect(f.matchedCode === null || /^DISC-/.test(f.matchedCode)).toBe(true);
    expect(m('Exterior Site Lighting', 'Time switch for canopy lights').matchedCode).toBe('LC-TIMESW');
    expect(m('Exterior Site Lighting', 'Contactor for pole lights').matchedCode).toBe('LC-CONTACTOR');
    expect(m('Interior Lighting', 'Occupancy sensor for lights').matchedCode).toBe('LC-OCCSW');
    expect(equipmentFamily('Receptacle for display lights', 'Interior Lighting', 'EA')).toBe('device');
  });

  it('compounds run to their head: light switch, lighting contactor, relay/control panel, disconnect switch', () => {
    expect(equipmentFamily('Light switch', 'Interior Lighting', 'EA')).toBe('device');
    expect(equipmentFamily('Lighting contactors - WORK, SALES', 'Lighting Controls', 'EA')).toBe('control');
    expect(equipmentFamily('Lighting relay/control panel', 'Lighting Controls', 'EA')).toBe('control');
    expect(equipmentFamily('Disconnect switch, 30A', 'Service & Distribution', 'EA')).toBe('disconnect');
    expect(equipmentFamily('Data outlet rough-in (box + ring + pull string)', 'Low Voltage', 'EA')).toBe('low_voltage');
    expect(equipmentFamily('Type X — some item', 'Interior Lighting', 'EA')).toBe('fixture'); // no head noun: the category decides
  });
});

describe('C fix round 2 — N2: a panel that IS the item stays gear', () => {
  it('the real 36th PANEL B FEED row and three phrasings are gear; "circuit to / fed from Panel A" is still stripped', () => {
    for (const d of ['PANEL B FEED — Panel B sub-feed from Panel A ckts 27,29 (10kVA listed) (connection)', 'Panel B feed (connection)', 'Sub-panel B connection', 'Tie-in to existing Panel A (connection)']) {
      expect(equipmentFamily(d, 'Branch Power', 'EA'), d).toBe('gear');
    }
    expect(familyText('LED troffer, circuit to Panel A')).toBe('led troffer,');
    expect(familyText('Disconnect fed from Panel A')).toBe('disconnect');
    expect(equipmentFamily('A/C Comp Unit #1, Panel A ckts 15,17, 40A/2P', 'Branch Power', 'EA')).toBe('equipment_connection');
  });
});

describe('C fix round 3 — N4: a device never runs on to a fixture word; N5: the longer phrase wins', () => {
  const m = (category: string, description: string) => mapTakeoffLine({ category, description, qty: 2, unit: 'EA' }, candidates);
  it('receptacle / outlet strips and plugmold are devices: a plugmold unit, else unresolved — never LTG-STRIP4', () => {
    for (const d of ['Plug-in receptacle strip', 'Plugmold receptacle strip 6ft', 'Receptacle strip, 6 outlets', 'Multi-outlet receptacle strip', 'Outlet strip at workbench']) {
      expect(equipmentFamily(d, 'Branch Power', 'EA'), d).toBe('device');
      const r = m('Branch Power', d);
      expect(r.matchedCode, d).toBeNull();
      expect(r.note, d).toMatch(/Plugmold/);
    }
    const withUnit = [...candidates, { kind: 'item' as const, id: 'PLUGMOLD', code: 'PLUGMOLD', name: 'Plugmold multi-outlet strip, 6 ft', category: 'Branch Power', unit: 'EA', aliases: [], materialCost: 60, laborHours: 0.8 }];
    expect(mapTakeoffLine({ category: 'Branch Power', description: 'Plugmold receptacle strip 6ft', qty: 2, unit: 'EA' }, withUnit).matchedCode).toBe('PLUGMOLD');
    // "strip" is a fixture word only as strip light / strip fixture / LED strip.
    expect(equipmentFamily('Type A - 8\' LED strip 42W input', 'Interior Lighting', 'EA')).toBe('fixture');
    expect(equipmentFamily('4ft strip light', 'Interior Lighting', 'EA')).toBe('fixture');
  });

  it('access control (panel) and card access are low voltage → LV-ACCESS', () => {
    expect(equipmentFamily('Access control panel', 'Low Voltage', 'EA')).toBe('low_voltage');
    expect(equipmentFamily('Card access control panel', 'Low Voltage', 'EA')).toBe('low_voltage');
    expect(m('Low Voltage', 'Access control panel').matchedCode).toBe('LV-ACCESS');
    expect(m('Low Voltage', 'Card access control panel').matchedCode).toBe('LV-ACCESS');
  });
});

describe('C fix round 3 — the structural safety net: no fuzzy match prices across family or category', () => {
  const REPROS: Array<[string, string]> = [
    ['Interior Lighting', 'Type H — LED high bay with sensor'], ['Interior Lighting', 'Type S — LED strip with integral motion sensor'],
    ['Interior Lighting', 'Type F — LED high bay w/ integral occupancy sensor'], ['Interior Lighting', 'Exterior wall pack w/ photocell'],
    ['Branch Power', 'RTU-1 disconnect, 60A NEMA 3R'], ['Branch Power', 'Condenser disconnect 30A'], ['Branch Power', 'Motor disconnect 30A'], ['Branch Power', 'Pump disconnect 30A'],
    ['Interior Lighting', 'Type A — 2x4 LED flat panel, Lithonia CPX'], ['Interior Lighting', 'Type P — LED panel light 2x4'], ['Interior Lighting', 'Type T — LED troffer, circuit to Panel A'],
    ['Interior Lighting', 'Type EF — Exhaust fan / light combo'], ['Exterior Site Lighting', 'Security light wall pack'],
    ['Exterior Site Lighting', 'Disconnect for sign lights'], ['Interior Lighting', 'Wall switch sensor for lights'], ['Interior Lighting', 'Transformer for low voltage track lights'],
    ['Exterior Site Lighting', 'Fused disconnect at pole light'], ['Exterior Site Lighting', 'Time switch for canopy lights'], ['Exterior Site Lighting', 'Contactor for pole lights'],
    ['Interior Lighting', 'Occupancy sensor for lights'], ['Interior Lighting', 'Receptacle for display lights'],
    ['Branch Power', 'PANEL B FEED — Panel B sub-feed from Panel A ckts 27,29 (10kVA listed) (connection)'], ['Branch Power', 'Panel B feed (connection)'],
    ['Branch Power', 'Sub-panel B connection'], ['Branch Power', 'Tie-in to existing Panel A (connection)'],
    ['Branch Power', 'Plug-in receptacle strip'], ['Branch Power', 'Plugmold receptacle strip 6ft'], ['Branch Power', 'Receptacle strip, 6 outlets'],
    ['Branch Power', 'Multi-outlet receptacle strip'], ['Branch Power', 'Outlet strip at workbench'],
    ['Low Voltage', 'Access control panel'], ['Low Voltage', 'Card access control panel'],
    ['Branch Power', 'Timer switch for exhaust fan'], ['Lighting Controls', 'Countdown timer switch'], ['Branch Power', 'TC — Leviton VP24 7-day astronomic timer switch (VPOSR for 3-way)'],
    ['Branch Power', 'LED fixture for parking lot'], ['Branch Power', 'Receptacle at counter'], ['Branch Power', 'Light fixture on pole'], ['Branch Power', 'Wall pack at entry'],
  ];
  const lines = [
    ...fromLegacyTakeoff(proposedRows('price-accuracy/36th-street-run-2026-09-29b.json')),
    ...fromLegacyTakeoff(proposedRows('price-accuracy/kissimmee-run-2026-09-28.json')),
    ...fromLegacyTakeoff(proposedRows('36th-street-run-2026-09-29.json')),
    ...REPROS.map(([category, description]) => ({ category, description, qty: 2, unit: 'EA' })),
  ];

  it(`every fuzzy match that prices on its own is same-family, confidently read and category-compatible (${lines.length} lines)`, () => {
    const mapped = mapTakeoffLines(lines, candidates);
    let fuzzy = 0; let held = 0;
    mapped.forEach((m, i) => {
      if (m.matchConfidence !== 'fuzzy') return;
      fuzzy++;
      if (m.confirmReason) { held++; return; }
      // A "NEEDS FOOTAGE — …" run never prices from its fuzzy item: it prices
      // from its own spec (footageSpecPricing), or not at all.
      if (/^NEEDS FOOTAGE/.test(lines[i].description)) return;
      const c = candidates.find(x => x.id === m.matchedId)!;
      const fam = confidentLineFamily(lines[i]);
      expect(fam, lines[i].description).not.toBeNull();
      expect(candidateFamily(c), lines[i].description).toBe(fam);
      expect(categoryAllowsFamily(lines[i].category, fam!), `${lines[i].category} / ${lines[i].description}`).toBe(true);
    });
    // eslint-disable-next-line no-console
    console.log(`[safety net] ${lines.length} lines, ${fuzzy} fuzzy, ${held} held`);
    expect(fuzzy).toBeGreaterThan(10);
  });

  it('a category-incompatible or family-mismatched fuzzy match is held with a "check match" reason', () => {
    const [m] = mapTakeoffLines(fromLegacyTakeoff([{ category: 'Branch Power', item: 'DATA-CONC - Venstar data concentrator on phone board (connection)', spec: 'COUNT PENDING', qty: 1, unit: 'EA' }]), candidates);
    expect(m.matchedCode).toBe('LV-DATA');
    expect(m.confirmReason).toMatch(/^Check match: a low voltage under "Branch Power"/);
  });
});
