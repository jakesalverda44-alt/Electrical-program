// Remodel + footage round, B2 — the footage allowance itself (pure). Real
// input: the 2026-09-29 36th Street live run (Agent 1, Agent 2, count).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  computeFootageAllowance, countPoints, parseBranchConductors, parseFeederSpec, collectFeeders,
  branchFootageFromGeometry, parseFootageSettings, DEFAULT_FOOTAGE_SETTINGS, BRANCH_CATEGORY, FEEDER_CATEGORY,
  GeometrySheet,
} from './footageAllowance';
import { geometryFromCount, isPanelType } from './footageAllowanceDb';

const run = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/36th-street-run-2026-09-29.json'), 'utf8'));
const S = DEFAULT_FOOTAGE_SETTINGS;
const base = { settings: S, dropFt: 10, slackPct: 10 };

describe('B2 — points off the real 36th Street takeoff', () => {
  it('counts fixtures/devices/equipment the same way the calibration read the BOMs', () => {
    const p = countPoints(run.agent2.takeoff);
    // A 14 + B 2 + E2 3 + G 8 = 27 fixtures (F1 exhaust fan is equipment);
    // duplex 14 + 42 3 + GFI 7 + WP 2 + $ 9 + $3 6 = 41 devices (existing
    // receptacles included until Builder A1 lands); disconnects, HVAC,
    // DISC-A/B, fans = 11 equipment. Panels, the telephone box and 0-qty
    // legend rows are not points.
    expect(p).toEqual({ fixture: 27, device: 41, equipment: 11, pole: 0 });
  });

  it('skips existing/demo rows once Builder A1 marks them (remodel: new work only)', () => {
    const rows = [
      { category: 'Branch Power', item: 'Duplex receptacle', qty: 14, unit: 'EA', status: 'existing' },
      { category: 'Branch Power', item: 'Duplex receptacle', qty: 5, unit: 'EA', status: 'new' },
      { category: 'Demolition', item: 'Demolition — 2x4 fluorescent fixture', qty: 52, unit: 'EA' },
      { category: 'Interior Lighting', item: 'Type A — 2x4 troffer', qty: 3, unit: 'EA', status: 'relocated' },
    ];
    expect(countPoints(rows)).toEqual({ fixture: 3, device: 5, equipment: 0, pole: 0 });
  });

  it('reads conductors per branch circuit off the panel circuit wiring', () => {
    expect(parseBranchConductors(['20A/1P branch circuits 2#12 1#10G 1/2"C'])).toBe(3);
    expect(parseBranchConductors(['Branch circuits 3#12 + 1#12 G'])).toBe(4);
    expect(parseBranchConductors(['HVAC feeders 3#6 1#10G'])).toBeNull();
  });
});

describe('B2 — v1 ratio lines on the real 36th Street run', () => {
  const { rows, summary } = computeFootageAllowance({
    ...base, takeoffRows: run.agent2.takeoff, agent1: run.agent1, agent2Allowances: run.agent2.allowances,
  });
  const byItem = new Map(rows.map(r => [r.item, r]));

  it('EMT = points × the calibrated ratio, and the evidence shows the math', () => {
    expect(summary.method).toBe('v1');
    const emt = byItem.get('Branch conduit allowance — EMT')!;
    expect(emt.qty).toBe(Math.round(79 * 6.6)); // 521
    expect(emt.category).toBe(BRANCH_CATEGORY);
    expect(emt.spec).toBe('3/4" EMT (incl. couplings/straps)');
    expect(emt.unit).toBe('LF');
    expect(emt.evidence).toBe("Method v1 (ratio). 79 points (27 fixtures, 41 devices, 11 equipment connections) × 6.6 ft EMT per point (calibrated on 5 of Chris's jobs; leave-one-out error ±35%) = 521 ft.");
  });

  it('wire = conduit × 5.54 (3-wire circuits, 2#12 1#10G), split 53/47 #12/#10; MC per fixture', () => {
    const w12 = byItem.get('Branch wire allowance — #12 THHN')!;
    const w10 = byItem.get('Branch wire allowance — #10 THHN')!;
    const total = 79 * 6.6 * 5.54;
    expect(w12.qty + w10.qty).toBeGreaterThanOrEqual(Math.round(total) - 1);
    expect(w12.qty + w10.qty).toBeLessThanOrEqual(Math.round(total) + 1);
    expect(w10.qty).toBe(Math.round(total * 0.47));
    expect(w12.evidence).toMatch(/× 5\.54 conductor-ft per conduit-ft/);
    const mc = byItem.get('Fixture whip allowance — 12/2 MC')!;
    expect(mc.qty).toBe(Math.round(27 * 7.89));
    expect(mc.spec).toBe('12/2 MC cable');
  });

  it("no feeder line duplicates Agent 2's own HVAC feeder allowance (B1 already shows it); existing service feeder is not new work", () => {
    expect(summary.feeders).toEqual([]);
    expect(rows.some(r => r.category === FEEDER_CATEGORY)).toBe(false);
  });

  it('no poles → no site PVC line', () => {
    expect(rows.some(r => /PVC/.test(r.item))).toBe(false);
  });
});

describe('B2 — feeders: size but no length → a visible 0-qty measure line', () => {
  it('parses conduit + conductors, and never mistakes a unit tag for a conductor', () => {
    expect(parseFeederSpec('A/C compressor unit #1, 40A/2P, 3#6 + 1#10G, 3/4" C, Panel A ckts 15,17')).toMatchObject({
      conduit: '3/4"', conductors: [{ count: 3, size: '6', ground: false }, { count: 1, size: '10', ground: true }],
    });
    expect(parseFeederSpec('200A fused switch; feeds Panel A 4#3/0,#6G,2"C')).toMatchObject({
      conduit: '2"', conductors: [{ count: 4, size: '3/0', ground: false }, { count: 1, size: '6', ground: true }],
    });
    expect(parseFeederSpec('A/C compressor unit #1, 40A/2P')).toBeNull();
    expect(parseFeederSpec('20A/1P branch circuits 2#12 1#10G')).toBeNull();
  });

  it('emits conduit + one wire line per conductor, all at 0, with the quote', () => {
    const agent1 = { equipment: [{ tag: 'DISCON A', description: '200A fused switch; feeds Panel A 4#3/0,#6G,2"C' }], panels: [{ name: 'A', fedFrom: 'DISCON A' }] };
    expect(collectFeeders(agent1)).toHaveLength(1);
    const { rows } = computeFootageAllowance({ ...base, takeoffRows: [], agent1 });
    expect(rows.map(r => [r.item, r.spec, r.qty])).toEqual([
      ['MEASURE FEEDER — 2" conduit, 4#3/0 + 1#6G — DISCON A', '2" EMT (incl. couplings/straps)', 0],
      ['MEASURE FEEDER — #3/0 wire (4 per run) — DISCON A', '#3/0 THHN/THWN copper conductor', 0],
      ['MEASURE FEEDER — #6 ground wire (1 per run) — DISCON A', '#6 THHN/THWN copper conductor', 0],
    ]);
    expect(rows[0].evidence).toMatch(/Measure the run on the Plans view/);
    expect(rows[1].evidence).toMatch(/measured run × 4/);
  });

  it('an existing-to-remain feeder is skipped', () => {
    expect(collectFeeders({ panels: [{ name: 'A', fedFrom: 'Existing meter/main disconnect; 2"C (4) 3/0 AWG CU #6 GRND' }] })).toEqual([]);
  });
});

describe('B2 — v2 geometry', () => {
  // 1/4" = 1'-0" → 18 pt per ft.
  const sheet = (points: GeometrySheet['points'], ftPerPt: number | null = 1 / 18): GeometrySheet => ({ sheetKey: 's', label: 'E1.0', ftPerPt, panels: [{ x: 0, y: 0 }], points });

  it('homerun + chain (Manhattan) × scale, + slack, + a drop per device', () => {
    const g = branchFootageFromGeometry([sheet([
      { x: 180, y: 0, kind: 'device', circuit: 'A1' },
      { x: 180, y: 180, kind: 'device', circuit: 'A1' },
    ])], { dropFt: 10, slackPct: 10, pointsPerCircuit: 8 });
    // (10 ft homerun + 10 ft chain) × 1.1 + 2 × 10 ft drops = 42 ft.
    expect(g.routeFt).toBeCloseTo(42, 6);
    expect(g.circuits).toBe(1);
    expect(g.covered.device).toBe(2);
  });

  it('agreement within 40% → v2 is used and labelled', () => {
    // 10 devices in a row, 1 ft apart, next to the panel: tiny routes.
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: 18 * (i + 1), y: 0, kind: 'device' as const }));
    const geo = [sheet(pts)];
    const g = branchFootageFromGeometry(geo, { dropFt: 5, slackPct: 0, pointsPerCircuit: 10 });
    const rows = Array.from({ length: 10 }, () => ({ category: 'Branch Power', item: 'Duplex receptacle', qty: 1, unit: 'EA' }));
    const s = parseFootageSettings(JSON.stringify({ pointsPerCircuit: 10, emtPerPoint: { fixture: 6.6, device: g.routeFt / 10, equipment: 6.6 } }));
    const { rows: out, summary } = computeFootageAllowance({ settings: s, dropFt: 5, slackPct: 0, takeoffRows: rows, geometry: geo });
    expect(summary.method).toBe('v2');
    expect(out[0].evidence.startsWith('Method v2 (plan geometry).')).toBe(true);
    expect(out[0].qty).toBe(Math.round(g.routeFt));
  });

  it('disagreement over 40% → the ratio qty stays; the geometry number is shown to check', () => {
    const pts = [{ x: 1800, y: 1800, kind: 'device' as const }]; // 200 ft away
    const { rows, summary } = computeFootageAllowance({ ...base, takeoffRows: [{ category: 'Branch Power', item: 'Duplex receptacle', qty: 1, unit: 'EA' }], geometry: [sheet(pts)] });
    expect(summary.method).toBe('v1');
    expect(rows[0].qty).toBe(Math.round(6.6));
    expect(rows[0].evidence).toMatch(/^Method v1 \(ratio\)\./);
    expect(rows[0].evidence).toMatch(/Plan-geometry estimate 230 ft .* check scale/);
  });

  it('the real 36th run at an assumed 1/4" scale: geometry ~3,456 ft vs ratio ~541 → qty stays at the ratio, flagged', () => {
    const docs = run.count_result.markers.sheetDocuments as Array<{ documentId: string; pageIndex: number }>;
    const geometry = geometryFromCount(run.count_result, docs.map(d => ({ document_id: d.documentId, page_index: d.pageIndex, ft_per_pt: 1 / 18, scale_source: 'calibrated' })), []);
    const { rows, summary } = computeFootageAllowance({ ...base, takeoffRows: run.agent2.takeoff, agent1: run.agent1, agent2Allowances: run.agent2.allowances, geometry });
    expect(Math.round(summary.v2!.routeFt)).toBe(3456);
    expect(summary.method).toBe('v1');
    const emt = rows.find(r => r.item === 'Branch conduit allowance — EMT')!;
    expect(emt.qty).toBe(521);
    expect(emt.evidence).toMatch(/Plan-geometry estimate 3456 ft for the 82 mapped points \(ratio: 541 ft, \d+% apart\) — check scale/);
  });

  it('an unscaled sheet stays v1 for its points', () => {
    const g = branchFootageFromGeometry([sheet([{ x: 1, y: 1, kind: 'fixture' }], null)], { dropFt: 10, slackPct: 10, pointsPerCircuit: 8 });
    expect(g.circuits).toBe(0);
    expect(g.uncoveredPoints).toBe(1);
  });

  it('reads the real 36th count: panels from PANEL/ELECTRICAL PANEL marks only, a suggested scale never counts', () => {
    const docs = run.count_result.markers.sheetDocuments as Array<{ documentId: string; pageIndex: number }>;
    const scaled = geometryFromCount(run.count_result, docs.map(d => ({ document_id: d.documentId, page_index: d.pageIndex, ft_per_pt: 1 / 18, scale_source: 'titleblock' })), []);
    expect(scaled.map(s => [s.label, s.panels.length, s.points.length])).toEqual([
      ['E1.0 "Electrical Plan"', 2, 36],
      ['E2.0 "Electrical Plan"', 4, 46],
    ]);
    const unscaled = geometryFromCount(run.count_result, docs.map(d => ({ document_id: d.documentId, page_index: d.pageIndex, ft_per_pt: 1 / 18, scale_source: null })), []);
    expect(unscaled.every(s => s.ftPerPt === null)).toBe(true);
    expect(isPanelType({ key: 'COMP #1', description: 'A/C compressor unit #1, 40A/2P, 3#6 + 1#10G, 3/4" C, Panel A ckts 15,17' })).toBe(false);
    expect(isPanelType({ key: 'PANEL A', description: 'Existing 200A MLO panel' })).toBe(true);
  });
});

describe('B2 — settings', () => {
  it('a malformed or negative stored value falls back to the default, never NaN', () => {
    expect(parseFootageSettings('nope')).toEqual(DEFAULT_FOOTAGE_SETTINGS);
    const s = parseFootageSettings(JSON.stringify({ mcPerFixture: -3, emtPerPoint: { device: 'x', fixture: 9 } }));
    expect(s.mcPerFixture).toBe(DEFAULT_FOOTAGE_SETTINGS.mcPerFixture);
    expect(s.emtPerPoint.device).toBe(DEFAULT_FOOTAGE_SETTINGS.emtPerPoint.device);
    expect(s.emtPerPoint.fixture).toBe(9);
  });
});
