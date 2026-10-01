// Price accuracy round, C3 — the box / fitting / hardware allowance lines.
import { describe, it, expect } from 'vitest';
import {
  computeBoxFittingRows, boxFittingDrivers, parseBoxFittingSettings, validateBoxFittingSettingsJson,
  DEFAULT_BOX_FITTING_SETTINGS, BOX_FITTING_CATEGORY, BfRowLike, BfExistingLine,
} from './boxFittingAllowance';
import { BOX_FITTING_ITEMS } from './seed/laborUnits';

const rows: BfRowLike[] = [
  { category: 'Interior Lighting', item: 'Type A — 2X4 LED recessed troffer', spec: '2X4 LED recessed troffer', qty: 14, unit: 'EA' },
  { category: 'Interior Lighting', item: 'Type H — LED high bay 2x4', spec: 'LED high bay 2x4', qty: 13, unit: 'EA' },
  { category: 'Branch Power', item: 'Duplex receptacle', spec: 'Duplex receptacle', qty: 5, unit: 'EA' },
  { category: 'Branch Power', item: 'GFCI duplex receptacle (GFCI)', spec: 'GFCI duplex receptacle', qty: 2, unit: 'EA' },
  { category: 'Lighting Controls', item: 'Single pole switch ($)', spec: 'Single pole switch', qty: 9, unit: 'EA' },
  { category: 'Branch Power', item: 'J-box w/ 1" empty conduit to deck (J-box)', spec: 'J-box', qty: 3, unit: 'EA' },
  { category: 'Demolition', item: 'Demolition — receptacle', spec: 'Existing to be removed', qty: 40, unit: 'EA' },
  { category: 'Branch Wiring (allowance)', item: 'Branch conduit allowance — EMT', spec: '3/4" EMT (incl. couplings/straps)', qty: 521, unit: 'LF' },
  { category: 'Branch Wiring (allowance)', item: 'Branch wire allowance — #12 THHN', spec: '#12 THHN/THWN copper conductor', qty: 2000, unit: 'LF' },
  { category: 'Branch Wiring (allowance)', item: 'Fixture whip allowance — 12/2 MC', spec: '12/2 MC cable', qty: 213, unit: 'LF' },
  { category: 'Site / Underground / Allowances', item: 'Allowance — site', spec: '1" PVC Sch 40 (incl. fittings/glue)', qty: 100, unit: 'LF' },
];
const noBox = () => false;
const item = (code: string) => BOX_FITTING_ITEMS.find(i => i.code === code)!;

describe('C3 — drivers', () => {
  it('counts points (never demolition), box lines, and raceway footage by type', () => {
    const d = boxFittingDrivers(rows, [], noBox);
    expect(d.points).toEqual({ fixture: 27, device: 16, equipment: 0 });
    expect(d.boxLines).toBe(3);
    expect(d.emtFt).toBe(521);
    expect(d.mcFt).toBe(213);
    expect(d.pvcFt).toBe(100);
  });

  it("the estimator's own manual conduit counts; their own points count too", () => {
    const manual: BfExistingLine[] = [
      { category: 'Branch Power', description: '1" EMT telecom', unit: 'LF', qty: 40, source: 'manual' },
      { category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', qty: 2, source: 'manual' },
    ];
    const d = boxFittingDrivers(rows, manual, noBox);
    expect(d.emtFt).toBe(561);
    expect(d.points.device).toBe(18);
  });
});

describe('C3 — the allowance lines', () => {
  const s = DEFAULT_BOX_FITTING_SETTINGS;
  it('one line per group, mapped by the ALW-* item names, with the math as evidence', () => {
    const out = computeBoxFittingRows({ rows, existing: [], settings: s, pointHasBox: noBox }).rows;
    expect(out.every(r => r.category === BOX_FITTING_CATEGORY)).toBe(true);
    expect(out.map(r => [r.item, r.qty, r.unit])).toEqual([
      ['Box allowance', 40, 'EA'], // 43 points − 3 J-box lines
      ['EMT fittings allowance', 521, 'LF'],
      ['PVC fittings allowance', 100, 'LF'],
      ['MC / flex connector allowance', 213, 'LF'],
      ['Support hardware allowance — raceway', 734, 'LF'],
      ['Support hardware allowance — fixtures', 27, 'EA'],
      ['Wire connector allowance', 43, 'EA'],
    ]);
    expect(out.map(r => r.spec)).toEqual([
      item('ALW-BOX').name, item('ALW-FIT-EMT').name, item('ALW-FIT-PVC').name, item('ALW-FIT-MC').name, item('ALW-HW-RACEWAY').name, item('ALW-HW-FIXTURE').name, item('ALW-SPLICE').name,
    ]);
    expect(out[0].evidence).toMatch(/^Box allowance, ESTIMATED: 43 points \(27 fixtures, 16 devices, 0 equipment\) − 3 box lines in the takeoff — one box set per point, calibrated on 5 of Chris's jobs/);
  });

  it('a point priced as an assembly that already includes its box is not counted again', () => {
    const hasBox = (r: BfRowLike) => /^Duplex receptacle$/.test(r.item);
    const out = computeBoxFittingRows({ rows, existing: [], settings: s, pointHasBox: hasBox }).rows;
    expect(out[0].qty).toBe(35);
    expect(out[0].evidence).toMatch(/− 5 already priced with their box/);
    expect(out.find(r => r.item === 'Wire connector allowance')!.qty).toBe(38);
  });

  it("the estimator's own fitting / hardware lines replace that allowance; own box lines come off the count", () => {
    const existing: BfExistingLine[] = [
      { category: 'Branch Power', description: '3/4" Connector - EMT Set Screw Steel', unit: 'EA', qty: 60, source: 'manual' },
      { category: 'Branch Power', description: '1/4" x 1-3/4" L Concrete Screw Hex Head', unit: 'EA', qty: 100, source: 'manual' },
      { category: 'Branch Power', description: '4" Square Box 1/2 & 3/4" KO', unit: 'EA', qty: 10, source: 'manual' },
      { category: 'Branch Power', description: '#16 to #10 Wire Connector Live Spring Twist-On', unit: 'EA', qty: 130, source: 'manual' },
    ];
    const out = computeBoxFittingRows({ rows, existing, settings: s, pointHasBox: noBox }).rows;
    const by = Object.fromEntries(out.map(r => [r.item, r]));
    expect(by['Box allowance'].qty).toBe(30);
    for (const k of ['EMT fittings allowance', 'PVC fittings allowance', 'MC / flex connector allowance']) {
      expect(by[k].qty).toBe(0);
      expect(by[k].evidence).toMatch(/^Replaced by your own fitting lines/);
    }
    expect(by['Support hardware allowance — raceway'].qty).toBe(0);
    expect(by['Support hardware allowance — fixtures'].evidence).toMatch(/^Replaced by your own hardware lines/);
    expect(by['Wire connector allowance'].qty).toBe(0);
    expect(by['Wire connector allowance'].evidence).toMatch(/^Replaced by your own wire connector lines/);
  });

  it('a raceway line "incl. couplings/straps" (a measured run the estimator typed) is conduit, never their own fitting line', () => {
    const existing: BfExistingLine[] = [
      { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 650, source: 'takeoff', qty_overridden: true, qty_source: 'manual' },
    ];
    const out = computeBoxFittingRows({ rows, existing, settings: s, pointHasBox: noBox }).rows;
    expect(out.find(r => r.item === 'EMT fittings allowance')!.qty).toBe(521);
  });

  it('a group with no driver adds no line', () => {
    const out = computeBoxFittingRows({ rows: [{ category: 'Branch Power', item: '5.1', spec: '3/4" EMT', qty: 100, unit: 'LF' }], existing: [], settings: s, pointHasBox: noBox }).rows;
    expect(out.map(r => r.item)).toEqual(['EMT fittings allowance', 'Support hardware allowance — raceway']);
  });

  it('off → no lines; scales multiply each group', () => {
    expect(computeBoxFittingRows({ rows, existing: [], settings: { ...s, enabled: 0 }, pointHasBox: noBox }).rows).toEqual([]);
    const scaled = computeBoxFittingRows({ rows, existing: [], settings: { ...s, scale: { box: 0.5, fittings: 2, hardware: 1, splice: 1 } }, pointHasBox: noBox }).rows;
    expect(scaled.map(r => r.qty)).toEqual([20, 1042, 200, 426, 734, 27, 43]);
    expect(scaled[0].evidence).toMatch(/× 0\.5 \(your scale\)/);
  });
});

describe('C3 — settings', () => {
  it('parses over the defaults and validates', () => {
    expect(parseBoxFittingSettings(null)).toEqual(DEFAULT_BOX_FITTING_SETTINGS);
    expect(parseBoxFittingSettings('{"enabled":0,"scale":{"box":-1,"fittings":1.5}}')).toMatchObject({ enabled: 0, scale: { box: 1, fittings: 1.5, hardware: 1, splice: 1 } });
    expect(validateBoxFittingSettingsJson('{"enabled":1,"scale":{"box":1.2}}')).toEqual([]);
    expect(validateBoxFittingSettingsJson('{"scale":{"box":-1}}')).toEqual(['scale.box must be at least 0']);
    expect(validateBoxFittingSettingsJson('{"enabled":2}')).toEqual(['enabled must be at most 1']);
    expect(validateBoxFittingSettingsJson('nope')).toEqual(['is not valid JSON']);
  });
});

describe('gap-closing T8 (J10) — MC connectors driven per luminaire', () => {
  const rows = [
    { category: 'Interior Lighting', item: 'Type A — 8\' LED strip', qty: 10, unit: 'EA' },
    { category: 'Interior Lighting', item: 'Type F — Exit sign', qty: 2, unit: 'EA' },
    { category: 'Branch Wiring (allowance)', item: 'Fixture whip allowance — 12/2 MC', spec: '12/2 MC cable', qty: 133, unit: 'LF' },
  ];
  it('luminaire basis: one EA per luminaire on ALW-FIT-MCLUM (by code); ft basis (the default) unchanged', () => {
    const lum = computeBoxFittingRows({ rows: rows as never, existing: [], settings: parseBoxFittingSettings(JSON.stringify({ mcConnectorBasis: 'luminaire' })), pointHasBox: () => false });
    const mc = lum.rows.find(r => r.item === 'MC / flex connector allowance')!;
    expect([mc.qty, mc.unit, mc.libraryCode]).toEqual([10, 'EA', 'ALW-FIT-MCLUM']);
    expect(mc.evidence).toMatch(/10 luminaires × 2\.82 connectors/);
    const ft = computeBoxFittingRows({ rows: rows as never, existing: [], settings: parseBoxFittingSettings(null), pointHasBox: () => false });
    expect(ft.rows.find(r => r.item === 'MC / flex connector allowance')!.qty).toBe(133);
  });
});
