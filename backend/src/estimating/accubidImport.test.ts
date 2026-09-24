import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import {
  ledProxyName, classifyBomCategory, bomItemCode, buildImportPreview,
  derivePoleBaseAssembly, deriveConduitFittingsForJob, medianConduitFittingsRatios,
  deriveBoxAccessoriesForJob, medianBoxAccessoryRatios, normalizedItemSpec,
} from './accubidImport';
import type { Library, LibraryItem } from './library';

const FIXDIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

const EMPTY_LIBRARY: Library = { items: [], assemblies: [], factors: [] };

describe('ledProxyName', () => {
  it('maps a fluorescent striplight proxy to the LED-equivalent name, keeping the attribute prefix', () => {
    const { canonical, wasProxy } = ledProxyName("8' Luminaire Linear Striplight - Fluorescent");
    expect(wasProxy).toBe(true);
    expect(canonical).toBe("8' Luminaire Linear Striplight - LED Integral Lamp");
  });

  it('maps an HID high-bay proxy', () => {
    const { canonical, wasProxy } = ledProxyName('250W Luminaire High Bay Up to 23" Reflector w/ Lens - HID');
    expect(wasProxy).toBe(true);
    expect(canonical).toContain('LED Integral Lamp');
    expect(canonical).not.toContain('HID');
  });

  it('leaves an already-LED description alone', () => {
    const { canonical, wasProxy } = ledProxyName("4' Luminaire Linear Wraparound Lens - LED Integral Lamp");
    expect(wasProxy).toBe(false);
    expect(canonical).toBe("4' Luminaire Linear Wraparound Lens - LED Integral Lamp");
  });

  it('never proxies a bulb/lamp row (no fixture to replace it on)', () => {
    const { canonical, wasProxy } = ledProxyName('48" 4100K Lamp T8 7x CRI TCLP - Fluorescent');
    expect(wasProxy).toBe(false);
    expect(canonical).toContain('Fluorescent');
  });
});

describe('classifyBomCategory', () => {
  it('classifies a luminaire as Interior Lighting', () => {
    expect(classifyBomCategory("4' Luminaire Linear Wraparound Lens - LED Integral Lamp")).toBe('Interior Lighting');
  });
  it('classifies a pole/wall pack as Exterior / Site Lighting', () => {
    expect(classifyBomCategory('20\' H x 4-1/2" Pole Round Straight - Steel')).toBe('Exterior / Site Lighting');
  });
  it('classifies a panelboard/safety switch as Service & Distribution', () => {
    expect(classifyBomCategory('200A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 1')).toBe('Service & Distribution');
  });
  it('classifies a pole-base component as Site / Underground / Allowances', () => {
    expect(classifyBomCategory('Pole Base Auger (Linear Foot)')).toBe('Site / Underground / Allowances');
  });
  it('classifies a ground rod as Grounding', () => {
    expect(classifyBomCategory('5/8" x 10\' Copper-Clad Ground Rod w/ Exothermic Connection')).toBe('Grounding');
  });
  it('classifies a demolition row by what is being demolished', () => {
    expect(classifyBomCategory('Demolition - Receptacle 3 Wire up to 20A')).toBe('Branch Power');
    expect(classifyBomCategory('Demolition - Luminaire Modular Fluorescent up to 2x4')).toBe('Interior Lighting');
  });
  it('falls back to Branch Power for wire/conduit/devices (the catalog catch-all)', () => {
    expect(classifyBomCategory('3/4" Conduit - EMT 10\' Lengths')).toBe('Branch Power');
  });
});

describe('bomItemCode', () => {
  it('is deterministic and stable across repeated calls (idempotent import)', () => {
    const a = bomItemCode("4' Luminaire Linear Wraparound Lens - LED Integral Lamp", 'EA');
    const b = bomItemCode("4' Luminaire Linear Wraparound Lens - LED Integral Lamp", 'EA');
    expect(a).toBe(b);
  });
  it('differs by unit (an EA item and a C item never collide even with the same text)', () => {
    const ea = bomItemCode('Widget', 'EA');
    const c = bomItemCode('Widget', 'C');
    expect(ea).not.toBe(c);
  });
});

describe('buildImportPreview — against an empty library', () => {
  it('plans every Kissimmee row with labor hours as a create, never touches material_cost when applyPrices is false', () => {
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: false });
    expect(preview.warnings).toEqual([]);
    expect(preview.reconciles).toBe(true);
    expect(preview.rowCount).toBe(89);
    const creates = preview.items.filter(i => i.action === 'create');
    expect(creates.length).toBeGreaterThan(50);
    for (const c of creates) expect(c.materialCost).toBeNull();
    // every planned row is finite/non-negative
    for (const i of preview.items) {
      if (i.laborHours != null) { expect(Number.isFinite(i.laborHours)).toBe(true); expect(i.laborHours).toBeGreaterThanOrEqual(0); }
      if (i.materialCost != null) { expect(Number.isFinite(i.materialCost)).toBe(true); expect(i.materialCost).toBeGreaterThanOrEqual(0); }
    }
  });

  it('applies net cost as material_cost only when applyPrices is true (the 2026 Kissimmee BOM)', () => {
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: true });
    const emt = preview.items.find(i => i.name.includes('Conduit - EMT') && i.name.startsWith('3/4'));
    expect(emt).toBeDefined();
    expect(emt!.materialCost).toBeCloseTo(92.38); // net cost per C, no vendor adj (plan fact)
  });

  it('maps LED-proxy rows to LED names on import (Rockledge, an older BOM)', () => {
    const preview = buildImportPreview(read('rockledge-bom.txt'), EMPTY_LIBRARY, { updatePrices: false });
    const striplight = preview.items.find(i => i.wasLedProxy && i.name.includes('Striplight'));
    expect(striplight).toBeDefined();
    expect(striplight!.name).toContain('LED Integral Lamp');
    expect(striplight!.name).not.toContain('Fluorescent');
  });

  it('never overwrites a source=manual item — plans skip_manual instead of update/create', () => {
    const firstPass = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: true });
    const someCreate = firstPass.items.find(i => i.action === 'create');
    expect(someCreate).toBeDefined();
    const library: Library = {
      items: [{
        id: 'x1', code: someCreate!.code, name: someCreate!.name, category: someCreate!.category,
        unit: someCreate!.unit, material_cost: 999, material_price_date: '2020-01-01', labor_hours: 1,
        aliases: [], source: 'manual', active: true,
      }],
      assemblies: [], factors: [],
    };
    const preview = buildImportPreview(read('kissimmee-bom.txt'), library, { updatePrices: true });
    const manualRow = preview.items.find(i => i.code === someCreate!.code);
    expect(manualRow?.action).toBe('skip_manual');
    // Nothing else changed action just because one row is manual.
    expect(preview.items.filter(i => i.action === 'create').length).toBe(firstPass.items.filter(i => i.action === 'create').length - 1);
  });

  it('plans an update (not a duplicate create) for an existing source=accubid item with the same code', () => {
    const preview1 = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: true });
    const created = preview1.items.filter(i => i.action === 'create');
    expect(created.length).toBeGreaterThan(0);
    const libraryAfter: Library = {
      items: created.map((c, idx) => ({
        id: `id-${idx}`, code: c.code, name: c.name, category: c.category, unit: c.unit,
        material_cost: c.materialCost ?? 0, material_price_date: '2026-06-18',
        labor_hours: c.laborHours ?? 0, aliases: [], source: 'accubid', active: true,
      })),
      assemblies: [], factors: [],
    };
    const preview2 = buildImportPreview(read('kissimmee-bom.txt'), libraryAfter, { updatePrices: true });
    const stillCreated = preview2.items.filter(i => i.action === 'create');
    const updated = preview2.items.filter(i => i.action === 'update');
    const proposed = preview2.items.filter(i => i.action === 'propose_update');
    // Every code from the first pass' creates now exists, so this second pass
    // should never create anything again.
    expect(stillCreated.length).toBe(0);
    // Review round 2 / B3 — the normalized-spec reconciliation can now
    // legitimately consolidate several first-pass rows that share a spec key
    // (e.g. two wire colors of the same gauge) onto ONE second-pass target,
    // so `updated` need not equal `created` one-for-one any more — it just
    // must never be zero, and never exceed it (never MORE targets than
    // sources), and nothing should need review on a re-import of the exact
    // same BOM (no delta at all between the two passes).
    expect(updated.length).toBeGreaterThan(0);
    expect(updated.length).toBeLessThanOrEqual(created.length);
    expect(proposed.length).toBe(0);
  });
});

describe('Review round 2 / S11 — price import is a rule (the BOM\'s own header date vs. a configurable cutoff), not a caller flag', () => {
  it('a 2024 BOM never gets prices even when the admin ticks "update prices" — no material_cost, no crash, no silent -100 (S13 interaction)', () => {
    const preview = buildImportPreview(read('rockledge-bom.txt'), EMPTY_LIBRARY, { updatePrices: true });
    expect(preview.bomDate).toBe('2024-04-11'); // the BOM's OWN header date, not a caller guess
    expect(preview.applyPrices).toBe(false); // requested, but blocked by the cutoff
    expect(preview.pricesBlockedByCutoff).toBe(true);
    for (const i of preview.items) expect(i.materialCost).toBeNull();
  });

  it('the 2026 Kissimmee BOM gets prices when the admin ticks "update prices" — the exact positive case', () => {
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: true });
    expect(preview.bomDate).toBe('2026-06-18');
    expect(preview.applyPrices).toBe(true);
    expect(preview.pricesBlockedByCutoff).toBe(false);
    const emt = preview.items.find(i => i.name.includes('Conduit - EMT') && i.name.startsWith('3/4'));
    expect(emt!.materialCost).toBeCloseTo(92.38);
  });

  it('the admin\'s checkbox alone is not sufficient — even the current Kissimmee BOM gets no prices when "update prices" is off', () => {
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: false });
    expect(preview.applyPrices).toBe(false);
    expect(preview.pricesBlockedByCutoff).toBe(false); // not "blocked" — never requested in the first place
    for (const i of preview.items) expect(i.materialCost).toBeNull();
  });

  it('the cutoff is configurable — raising it past Kissimmee\'s own date blocks even the current BOM; lowering it admits a 2024 BOM', () => {
    const raised = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { updatePrices: true, priceCutoffDate: '2027-01-01' });
    expect(raised.applyPrices).toBe(false);
    expect(raised.pricesBlockedByCutoff).toBe(true);

    const lowered = buildImportPreview(read('rockledge-bom.txt'), EMPTY_LIBRARY, { updatePrices: true, priceCutoffDate: '2024-01-01' });
    expect(lowered.applyPrices).toBe(true);
    expect(lowered.pricesBlockedByCutoff).toBe(false);
  });

  it('a BOM with no readable header date never gets prices, even with "update prices" on (never falls back to today)', () => {
    const line = `Conduit - EMT   100.000 C   50.00   50.00 C   3.0   3.0 Normal`;
    const preview = buildImportPreview(line, EMPTY_LIBRARY, { updatePrices: true });
    expect(preview.bomDate).toBeNull();
    expect(preview.applyPrices).toBe(false);
    expect(preview.pricesBlockedByCutoff).toBe(true);
  });
});

describe('derivePoleBaseAssembly (North Port — the one BOM with pole-base units)', () => {
  it('finds 8 poles and derives qty-per-pole ratios for the foundation components', () => {
    const { rows } = parseAccubidBom(read('north-port-bom.txt'));
    const plan = derivePoleBaseAssembly(rows);
    expect(plan).not.toBeNull();
    expect(plan!.poleCount).toBe(8);
    const byKey = new Map(plan!.components.map(c => [c.key, c]));
    expect(byKey.get('Pole Base Auger')?.qtyPerPole).toBeCloseTo(6); // 48 ft / 8 poles, EA(E)-priced (divisor 1)
    expect(byKey.get('Sono Tube')?.qtyPerPole).toBeCloseTo(9); // 72 / 8
    expect(byKey.get('Re-Bar Ring')?.qtyPerPole).toBeCloseTo(9); // 72 / 8
    expect(byKey.get('Anchor Bolt Template')?.qtyPerPole).toBeCloseTo(2); // 16 / 8
    expect(byKey.get('Anchor Bolt')?.qtyPerPole).toBeCloseTo(4); // 32 / 8
    expect(byKey.get('Pole Base Auger Setup')?.qtyPerPole).toBeCloseTo(1); // 8 / 8
    expect(byKey.get('Setup Concrete Pour')?.qtyPerPole).toBeCloseTo(1); // 8 / 8
    // #5 Re-Bar (Linear Foot) is C-priced (per 100 ft) — qty_per is in
    // hundreds-of-feet-per-pole, per library.ts's assembly convention.
    expect(byKey.get('Re-Bar (Linear Foot)')?.qtyPerPole).toBeCloseTo(384 / 8 / 100);
    // Concrete: 8.378 cubic yards / 8 poles
    expect(byKey.get('Concrete')?.qtyPerPole).toBeCloseTo(8.378 / 8, 3);
  });

  it('only derives the components a job actually has (Kissimmee has 3 site poles + anchor bolts but no auger/sono-tube/concrete — the base is by others)', () => {
    const { rows } = parseAccubidBom(read('kissimmee-bom.txt'));
    const plan = derivePoleBaseAssembly(rows);
    expect(plan).not.toBeNull();
    expect(plan!.poleCount).toBe(3);
    const keys = plan!.components.map(c => c.key).sort();
    expect(keys).toEqual(['Anchor Bolt', 'Anchor Bolt Template'].sort());
  });

  it('returns null for a job with no poles at all', () => {
    const { rows } = parseAccubidBom(read('36th-street-bom.txt'));
    expect(derivePoleBaseAssembly(rows)).toBeNull();
  });
});

describe('conduit fittings ratios (Decision B1 — per-100-ft ratios, median across jobs)', () => {
  it("derives Kissimmee's own 3/4\" EMT coupling/connector/strap ratios", () => {
    const { rows } = parseAccubidBom(read('kissimmee-bom.txt'));
    const samples = deriveConduitFittingsForJob(rows);
    const s = samples.find(x => x.size === '3/4"' && x.family === 'EMT');
    expect(s).toBeDefined();
    // 136 couplings / 1475 ft * 100 = 9.220...
    expect(s!.couplingsPer100).toBeCloseTo((136 * 100) / 1475, 3);
    expect(s!.connectorsPer100).toBeCloseTo((198 * 100) / 1475, 3);
  });

  it('takes the median across several jobs, not any single job\'s ratio', () => {
    const jobs = ['kissimmee-bom.txt', '36th-street-bom.txt', 'north-port-bom.txt', 'orlando-clubhouse-bom.txt', 'rockledge-bom.txt']
      .map(f => deriveConduitFittingsForJob(parseAccubidBom(read(f)).rows));
    const medians = medianConduitFittingsRatios(jobs);
    expect(medians.length).toBeGreaterThan(0);
    const emt34 = medians.find(m => m.size === '3/4"' && m.family === 'EMT');
    expect(emt34).toBeDefined();
    expect(emt34!.couplingsPer100).not.toBeNull();
    expect(Number.isFinite(emt34!.couplingsPer100 as number)).toBe(true);
  });
});

describe('box accessory ratios (plaster ring / cover per 4" square box)', () => {
  it("derives Kissimmee's own ratios (50 rings / 112 boxes, 52 covers / 112 boxes)", () => {
    const { rows } = parseAccubidBom(read('kissimmee-bom.txt'));
    const sample = deriveBoxAccessoriesForJob(rows);
    expect(sample).not.toBeNull();
    expect(sample!.boxQty).toBe(112);
    expect(sample!.ringsPerBox).toBeCloseTo(50 / 112, 4);
    expect(sample!.coversPerBox).toBeCloseTo(52 / 112, 4);
  });

  it('takes the median across jobs', () => {
    const jobs = ['kissimmee-bom.txt', '36th-street-bom.txt', 'north-port-bom.txt', 'orlando-clubhouse-bom.txt', 'rockledge-bom.txt']
      .map(f => deriveBoxAccessoriesForJob(parseAccubidBom(read(f)).rows));
    const { ringsPerBox, coversPerBox } = medianBoxAccessoryRatios(jobs);
    expect(ringsPerBox).not.toBeNull();
    expect(coversPerBox).not.toBeNull();
    expect(ringsPerBox as number).toBeGreaterThan(0);
    expect(coversPerBox as number).toBeGreaterThan(0);
  });
});

describe('review round 2 / B3 — normalizedItemSpec (kind + size + material)', () => {
  it('classifies a raceway vs its fittings as DIFFERENT kinds at the same size/material', () => {
    const conduit = normalizedItemSpec('3/4" Conduit - EMT 10\' Lengths')!;
    const connector = normalizedItemSpec('3/4" Connector - EMT Set Screw Steel')!;
    const coupling = normalizedItemSpec('3/4" Coupling - EMT Set Screw Steel')!;
    expect(conduit.kind).toBe('conduit');
    expect(connector.kind).toBe('connector');
    expect(coupling.kind).toBe('coupling');
    expect(conduit.key).not.toBe(connector.key);
    expect(conduit.key).not.toBe(coupling.key);
    expect(conduit.size).toBe('3/4in');
    expect(conduit.material).toBe('emt');
  });

  it('a bare raceway with no kind/material word at all is unclassifiable (null) — never a false reconciliation target', () => {
    expect(normalizedItemSpec('Fire Rated Playwood')).toBeNull();
    expect(normalizedItemSpec('Misc Materials')).toBeNull();
  });

  it('differentiates by size (3/4" EMT vs 1" EMT)', () => {
    const threeQuarter = normalizedItemSpec('3/4" Conduit - EMT 10\' Lengths')!;
    const oneInch = normalizedItemSpec('1" Conduit - EMT 10\' Lengths')!;
    expect(threeQuarter.key).not.toBe(oneInch.key);
  });
});

describe('review round 2 / B3 — buildImportPreview reconciles by normalized spec, never creating a raceway/fitting duplicate', () => {
  it('a real Kissimmee row for 3/4" EMT conduit updates the seed EMT-075 item directly, never a new ACB- code', () => {
    const seedEmt: LibraryItem = {
      id: 'seed-emt-075', code: 'EMT-075', name: '3/4" EMT (incl. couplings/straps)', category: 'Branch Power',
      unit: 'C', material_cost: 60, material_price_date: null, labor_hours: 4.0, aliases: ['3/4" emt (incl. couplings/straps)'], source: 'seed', active: true,
    };
    const library: Library = { items: [seedEmt], assemblies: [], factors: [] };
    const preview = buildImportPreview(read('kissimmee-bom.txt'), library, { updatePrices: true });
    const emtPlan = preview.items.find(i => i.code === 'EMT-075');
    expect(emtPlan).toBeTruthy();
    expect(emtPlan!.action).toBe('update');
    expect(emtPlan!.laborHours).toBeCloseTo(3.2, 2);
    expect(emtPlan!.materialCost).toBeCloseTo(92.38, 2);
    // No competing ACB- item was ALSO planned for "3/4 conduit - emt" text.
    const acbConduitDup = preview.items.find(i => i.code.startsWith('ACB-') && i.code.includes('CONDUIT') && i.code.includes('EMT') && i.code.includes('3-4'));
    expect(acbConduitDup).toBeUndefined();
  });
});

describe('review round 2 / S15 — a reconciled match is never silently overwritten across a unit mismatch or a big delta', () => {
  it('a unit mismatch proposes instead of updating', () => {
    // PNL-225-shaped: a panel item seeded as EA, but (contrived) a BOM row
    // that would reconcile to it printed in a different unit.
    const seedPanel: LibraryItem = {
      id: 'seed-panel', code: 'PNL-225', name: '225A MLO Panelboard', category: 'Service & Distribution',
      unit: 'EA', material_cost: 1450, material_price_date: null, labor_hours: 8, aliases: ['225a panelboard'], source: 'seed', active: true,
    };
    const library: Library = { items: [seedPanel], assemblies: [], factors: [] };
    // A synthetic one-row BOM: same kind+size (panel/225a) but priced per C (never true for a real panel, but exercises the guard deterministically).
    const line = 'Test-Panel             225A Panelboard - Test                                             100.000 C          10.00                     10.00           10.00 C                      3.000                        3.000 Normal';
    const preview = buildImportPreview(line, library, { updatePrices: false });
    const plan = preview.items.find(i => i.code === 'PNL-225');
    expect(plan?.action).toBe('propose_update');
    expect(plan?.proposalReason).toBe('unit_mismatch');
  });

  it('a >2x labor-hours delta proposes instead of updating', () => {
    const seedPanel: LibraryItem = {
      id: 'seed-panel', code: 'PNL-225', name: '225A MLO Panelboard', category: 'Service & Distribution',
      unit: 'EA', material_cost: 1450, material_price_date: null, labor_hours: 8, aliases: ['225a panelboard'], source: 'seed', active: true,
    };
    const library: Library = { items: [seedPanel], assemblies: [], factors: [] };
    // 3.6 h vs the seed's 8h is more than 2x down — must propose, not overwrite silently.
    const line = 'Test-Panel             225A Panelboard - Test                                              1.000 E                                                            Quoted     E                 3.600                    3.600';
    const preview = buildImportPreview(line, library, { updatePrices: false });
    const plan = preview.items.find(i => i.code === 'PNL-225');
    expect(plan?.action).toBe('propose_update');
    expect(plan?.proposalReason).toBe('big_delta');
    expect(plan?.previous?.laborHours).toBe(8);
    expect(plan?.laborHours).toBeCloseTo(3.6, 2);
  });

  it('a normal (< 2x, same unit) delta still updates as before', () => {
    const seedPanel: LibraryItem = {
      id: 'seed-panel', code: 'PNL-225', name: '225A MLO Panelboard', category: 'Service & Distribution',
      unit: 'EA', material_cost: 1450, material_price_date: null, labor_hours: 8, aliases: ['225a panelboard'], source: 'seed', active: true,
    };
    const library: Library = { items: [seedPanel], assemblies: [], factors: [] };
    const line = 'Test-Panel             225A Panelboard - Test                                              1.000 E                                                            Quoted     E                 7.000                    7.000';
    const preview = buildImportPreview(line, library, { updatePrices: false });
    const plan = preview.items.find(i => i.code === 'PNL-225');
    expect(plan?.action).toBe('update');
  });
});

describe('review round 2 / S14 — codes never collide just because two descriptions share a 40-char prefix', () => {
  it('two safety switches whose names agree for the first 40 characters get DIFFERENT codes', () => {
    const nema1 = bomItemCode('400A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 1', 'EA');
    const nema3r = bomItemCode('400A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 3R', 'EA');
    expect(nema1.slice(0, 40)).toBe(nema3r.slice(0, 40)); // same 40-char prefix (the premise of the bug)
    expect(nema1).not.toBe(nema3r); // but the full codes differ
  });

  it('is still deterministic (idempotent re-import)', () => {
    const a = bomItemCode('400A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 1', 'EA');
    const b = bomItemCode('400A Safety Switch Heavy Duty Fusible 600V 3 Pole - NEMA 1', 'EA');
    expect(a).toBe(b);
  });
});

describe('review round 2 / N17 — pole count sums every pole row, and unparsed lines never vanish silently', () => {
  it('sums two different pole rows on the same job instead of taking only the first', () => {
    const rows = parseAccubidBom([
      "20' H x 4-1/2\"        Pole Round Straight - Steel                                           5.000 E                                                            Quoted     E                 4.800                   24.000",
      "25' H x 5\"            Pole Round Straight - Steel                                            3.000 E                                                            Quoted     E                 5.500                   16.500",
      '                       Anchor Bolt Template - 4 Hole to 1" Bolts                               16.000 E                                                            Budget     E                 0.700                   11.200',
    ].join('\n')).rows;
    const plan = derivePoleBaseAssembly(rows);
    expect(plan?.poleCount).toBe(8); // 5 + 3, not just the first row's 5
  });

  it('a qty+unit-shaped line that fails to parse further (no second unit column) is surfaced as skip_unparsed in preview.items, never silently dropped', () => {
    // Shape-matches "qty + a bare unit letter" but has no SECOND occurrence
    // of that unit letter later in the row — accubidBom.ts's own
    // "no second unit column found" warning.
    const badLine = 'Something Weird BOM Row                                  5.000 C   10.00   Normal';
    const preview = buildImportPreview(badLine, EMPTY_LIBRARY, { updatePrices: false });
    expect(preview.warnings).toHaveLength(1);
    const unparsed = preview.items.find(i => i.action === 'skip_unparsed');
    expect(unparsed).toBeTruthy();
    expect(unparsed!.rawLine).toContain('Something Weird BOM Row');
  });
});
