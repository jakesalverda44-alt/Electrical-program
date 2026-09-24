import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import {
  ledProxyName, classifyBomCategory, bomItemCode, buildImportPreview,
  derivePoleBaseAssembly, deriveConduitFittingsForJob, medianConduitFittingsRatios,
  deriveBoxAccessoriesForJob, medianBoxAccessoryRatios,
} from './accubidImport';
import type { Library } from './library';

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
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { applyPrices: false });
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
    const preview = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { applyPrices: true, bomDate: '2026-06-18' });
    const emt = preview.items.find(i => i.name.includes('Conduit - EMT') && i.name.startsWith('3/4'));
    expect(emt).toBeDefined();
    expect(emt!.materialCost).toBeCloseTo(92.38); // net cost per C, no vendor adj (plan fact)
  });

  it('maps LED-proxy rows to LED names on import (Rockledge, an older BOM)', () => {
    const preview = buildImportPreview(read('rockledge-bom.txt'), EMPTY_LIBRARY, { applyPrices: false });
    const striplight = preview.items.find(i => i.wasLedProxy && i.name.includes('Striplight'));
    expect(striplight).toBeDefined();
    expect(striplight!.name).toContain('LED Integral Lamp');
    expect(striplight!.name).not.toContain('Fluorescent');
  });

  it('never overwrites a source=manual item — plans skip_manual instead of update/create', () => {
    const firstPass = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { applyPrices: true, bomDate: '2026-06-18' });
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
    const preview = buildImportPreview(read('kissimmee-bom.txt'), library, { applyPrices: true, bomDate: '2026-06-18' });
    const manualRow = preview.items.find(i => i.code === someCreate!.code);
    expect(manualRow?.action).toBe('skip_manual');
    // Nothing else changed action just because one row is manual.
    expect(preview.items.filter(i => i.action === 'create').length).toBe(firstPass.items.filter(i => i.action === 'create').length - 1);
  });

  it('plans an update (not a duplicate create) for an existing source=accubid item with the same code', () => {
    const preview1 = buildImportPreview(read('kissimmee-bom.txt'), EMPTY_LIBRARY, { applyPrices: true, bomDate: '2026-06-18' });
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
    const preview2 = buildImportPreview(read('kissimmee-bom.txt'), libraryAfter, { applyPrices: true, bomDate: '2026-06-18' });
    const stillCreated = preview2.items.filter(i => i.action === 'create');
    const updated = preview2.items.filter(i => i.action === 'update');
    // Every code from the first pass' creates now exists, so this second pass
    // should update the same set, not create it again.
    expect(stillCreated.length).toBe(0);
    expect(updated.length).toBe(created.length);
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
