// Accuracy round C6 — feeder estimates become priced takeoff rows on a bid
// still being estimated (or a calibration job); every other bid keeps
// today's 0-qty MEASURE rows exactly. Real input: the Kissimmee 0930 export,
// its real C4.1 / PH0.1 text runs, the live library; SCRIPTED where named.
import { describe, it, expect } from 'vitest';
import { computeGeneratedTakeoffRows, type GeneratedRowsInputs } from './footageAllowanceDb';
import { parseAgent2Takeoff } from './bidEstimate';
import { toLibraryCandidates } from './bidEstimate';
import { resolveRunParts } from './footageSpecPricing';
import { loadKissimmeeLive0930, loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import { scriptedLocate, textSheets0930 } from '../test/fixtures/realrun/feeders0930';
import { agent2RawOf } from '../eval/replayEval';
import type { ExistingLineLike } from './wiringScopes';
import type { GeneratedTakeoffRow } from './footageAllowance';
import { feederTapRows, undergroundAdjustmentRow } from './feederRows';
import { parseFeederEstimateSettings, validateFeederEstimateJson } from './feederRoute';

const live = loadKissimmeeLive0930();
const lib = loadLiveLibrary0930().library;
const candidates = toLibraryCandidates(lib);
const itemsById = new Map(lib.items.map(i => [i.id, i]));
const resolveName = (n: string) => resolveRunParts([{ description: n, perFtOfRun: 1 }], candidates, itemsById) != null;
const agent2Raw = agent2RawOf(live);

function gen(o: { stage: string; calibration?: boolean; locate?: boolean; existing?: ExistingLineLike[] }) {
  const inp: GeneratedRowsInputs = {
    agent2Raw, agent1Raw: live.agent1, countResult: o.locate ? { ...live.countResult, locate: scriptedLocate() } : live.countResult,
    takeoffRows: parseAgent2Takeoff(agent2Raw) as never, resolveName,
    resolveParts: parts => resolveRunParts(parts, candidates, itemsById) != null,
    settings: {}, bid: { sq_ft: 7147, stage: o.stage, calibration: o.calibration ?? false },
    existing: o.existing ?? [], scales: live.estSheets as never, pins: [],
    feeders: { pins: [], textSheets: textSheets0930() },
  };
  return computeGeneratedTakeoffRows(inp);
}
const feederRows = (r: ReturnType<typeof gen>) => r.rows.filter(x => /^(Feeder|MEASURE FEEDER)/.test(x.item)) as GeneratedTakeoffRow[];

describe('C6 — stage gate', () => {
  it('a submitted bid gets exactly today\'s MEASURE rows (no estimate)', () => {
    const r = gen({ stage: 'submitted', locate: true });
    expect(r.feeders).toBeNull();
    expect(feederRows(r).map(x => [x.item, x.qty])).toEqual([
      ['MEASURE FEEDER — 3/4" conduit, 3#6 + 1#10G — RTU-1, RTU-2', 0],
      ['MEASURE FEEDER — #6 wire (3 per run) — RTU-1, RTU-2', 0],
      ['MEASURE FEEDER — #10 ground wire (1 per run) — RTU-1, RTU-2', 0],
      ['MEASURE FEEDER — 2" conduit ×2 (parallel sets), 8#3/0 — MB', 0],
      ['MEASURE FEEDER — #3/0 wire (8 per run) — MB', 0],
    ]);
  });
  it('the same submitted bid flagged a calibration job is estimated', () => {
    expect(gen({ stage: 'submitted', calibration: true, locate: true }).feeders).not.toBeNull();
  });
});

describe('C6 — rows on a due bid (SCRIPTED locate mock)', () => {
  const r = gen({ stage: 'due', locate: true });
  const rows = feederRows(r);
  it('PANEL B → RTU-1/2 priced: EMT + #6 + #10 ground, the math as evidence; the RTU MEASURE set is replaced', () => {
    const rtu1 = rows.filter(x => x.item.startsWith('Feeder — PANEL B → RTU-1'));
    expect(rtu1.map(x => [x.item, x.spec, x.qty])).toEqual([
      ['Feeder — PANEL B → RTU-1: 3/4" EMT', '3/4" EMT (incl. couplings/straps)', 121],
      ['Feeder — PANEL B → RTU-1: #6 wire (3 per run)', '#6 THHN/THWN copper conductor', 363],
      ['Feeder — PANEL B → RTU-1: #10 ground wire (1 per run)', '#10 THHN/THWN copper conductor', 121],
    ]);
    expect(rtu1[0].evidence).toMatch(/^Feeder length estimate \(suggested — confirm\): PANEL B \(E-1/);
    expect(rtu1[0].feeder?.estimate).toEqual({ lengthFt: 121, tier: 'suggested' });
    expect(rows.some(x => x.item.includes('RTU-1, RTU-2'))).toBe(false);
  });
  it('the service set (MB) stays a MEASURE set at 0 — XFMR → METER is held (different sheets) — with what is missing', () => {
    const mb = rows.find(x => x.item === 'MEASURE FEEDER — 2" conduit ×2 (parallel sets), 8#3/0 — MB')!;
    expect(mb.qty).toBe(0);
    expect(mb.evidence).toMatch(/XFMR→METER: endpoints on different sheets/);
    expect(mb.evidence).toMatch(/METER→WIREWAY estimated 11 ft \(suggested\) — not priced until every run of this set is located/);
  });
  it('DISCON A/B → PANEL A/B (no MEASURE set today) get their own priced rows; Agent 2\'s feeder row becomes a note', () => {
    expect(rows.filter(x => x.item.startsWith('Feeder — DISCON A → PANEL A')).map(x => x.qty)).toEqual([31, 124, 31]); // gap-closing T4 (J3): through the wall and over (was 16 at the adjacent-gear shortcut)
    const note = r.takeoff.find(t => t.item.startsWith('Feeder 4#3/0,#6G,2"C disconnect to panel')) as { note?: string; evidence?: string };
    expect(note.note).toBe('feeder_estimate');
    expect(note.evidence).toMatch(/^Replaced by the feeder estimate DISCON A→PANEL A, DISCON B→PANEL B/);
  });
  it('the RTU disconnect points (RTU disconnects ×2, HVAC disconnect with unit ×2) come off the branch ratio (4 × 6.6 ft)', () => {
    const before = gen({ stage: 'submitted' }).rows.find(x => x.item === 'Branch conduit allowance — EMT')!.qty;
    const after = r.rows.find(x => x.item === 'Branch conduit allowance — EMT')!.qty;
    expect(Math.abs(before - after - 26.4)).toBeLessThan(1); // 4 × 6.6 ft, each total rounded
  });
});

describe('C6 — carry-over and the estimator\'s own line', () => {
  it('a typed qty on the old RTU MEASURE conduit line carries over, shared by the estimated lengths', () => {
    const existing: ExistingLineLike[] = [{ category: 'Feeders (allowance)', description: '3/4" EMT (incl. couplings/straps)', unit: 'LF', qty: 200, source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: 'Feeders (allowance)||MEASURE FEEDER — 3/4" conduit, 3#6 + 1#10G — RTU-1, RTU-2' }];
    const rows = feederRows(gen({ stage: 'due', locate: true, existing }));
    const c1 = rows.find(x => x.item === 'Feeder — PANEL B → RTU-1: 3/4" EMT')!;
    const c2 = rows.find(x => x.item === 'Feeder — PANEL B → RTU-2: 3/4" EMT')!;
    expect([c1.carryOverride, c1.qty + c2.qty]).toEqual([true, 200]);
    expect(c1.qty).toBeCloseTo(200 * 121 / 196, 1);
    expect(rows.find(x => x.item === 'Feeder — PANEL B → RTU-1: #6 wire (3 per run)')!.qty).toBeCloseTo(c1.qty * 3, 1);
  });
  it('the estimator\'s own feeder line for RTU-1 wins: the estimate goes to 0', () => {
    const existing: ExistingLineLike[] = [{ category: 'Feeders (allowance)', description: 'RTU-1 feeder 3/4" EMT', unit: 'LF', qty: 80, source: 'manual', takeoff_key: null }];
    const rows = gen({ stage: 'due', locate: true, existing }).rows;
    const c1 = rows.find(x => x.item === 'Feeder — PANEL B → RTU-1: 3/4" EMT')!;
    expect(c1.qty).toBe(0);
    expect(c1.evidence).toMatch(/Replaced by your entered\/measured footage/);
    expect(rows.find(x => x.item === 'Feeder — PANEL B → RTU-2: 3/4" EMT')!.qty).toBe(75);
  });
});

describe('B3 (fix round) — the site run is never priced twice', () => {
  const siteRows = (r: ReturnType<typeof gen>) => r.rows.filter(x => /^Site lighting circuits/.test(x.item)) as GeneratedTakeoffRow[];
  const typed: ExistingLineLike = {
    category: 'Site / Underground / Allowances', description: 'NEEDS FOOTAGE — Site lighting underground conduit and wire', unit: 'LF', qty: 750,
    source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: 'Site / Underground / Allowances||Allowance — Site lighting underground conduit and wire',
    match_source: 'manual', item_name: '1" PVC Sch 40 (incl. fittings/glue)', // the estimator picked a library item for the line they typed on
  };
  it('nothing typed: the geometry carries the site run (302–317 ft of 1" PVC + #10)', () => {
    const rows = siteRows(gen({ stage: 'due' }));
    expect(rows.map(x => x.qty).every(q => q > 0)).toBe(true);
  });
  it('the estimator types 750 on the site line: the geometry rows go to 0 (never 750 + 317)', () => {
    const r = gen({ stage: 'due', existing: [typed] });
    const rows = siteRows(r);
    expect(rows.length).toBe(2);
    for (const x of rows) { expect(x.qty).toBe(0); expect(x.evidence).toMatch(/Replaced by your own site footage .* never counted twice/); }
    // the ratio PVC row is not zeroed by the geometry any more: it is reduced by the typed footage (NB-2)
    expect(r.scopes!.site.source).toBe(1);
  });
});

describe('B4 (fix round) — a typed run on a parallel-set feeder keeps conduit AND wire right', () => {
  it('120 conduit-ft typed on the 2-set MEASURE line (60 ft x 2 sets) → #3/0 wire = 60 x 8 = 480 ft', () => {
    const item = 'MEASURE FEEDER — 2" conduit ×2 (parallel sets), 8#3/0 — MB';
    const typed: ExistingLineLike = { category: 'Feeders (allowance)', description: item, unit: 'LF', qty: 120, source: 'takeoff', qty_overridden: true, qty_source: 'manual', takeoff_key: `Feeders (allowance)||${item}` };
    const r = gen({ stage: 'submitted', existing: [typed] });
    const wire = (r.rows as GeneratedTakeoffRow[]).find(x => x.item === 'MEASURE FEEDER — #3/0 wire (8 per run) — MB')!;
    expect(wire.qty).toBe(480);
    expect(wire.evidence).toMatch(/120 conduit-ft ÷ 2 parallel sets = 60 ft of route × 8 = 480 ft/);
  });
});

describe('N1 (fix round 2) — a length typed on the site-geometry PVC line keeps its wire', () => {
  const geomPvc = (qty: number): ExistingLineLike => ({
    category: 'Site / Underground / Allowances', description: 'Site lighting circuits — 1" PVC underground', unit: 'LF', qty, source: 'takeoff', qty_overridden: true, qty_source: 'manual',
    takeoff_key: 'Site / Underground / Allowances||Site lighting circuits — 1" PVC underground',
  });
  it('typed 400 on the geometry PVC → #10 wire = 400 x 5 = 2,000; the geometry is not zeroed', () => {
    const r = gen({ stage: 'due', existing: [geomPvc(400)] });
    const rows = r.rows.filter(x => /^Site lighting circuits/.test(x.item)) as GeneratedTakeoffRow[];
    const wire = rows.find(x => /#10 wire/.test(x.item))!;
    expect(wire.qty).toBe(2000);
    expect(wire.evidence).toMatch(/Derived from your typed run on the site PVC line: 400 ft × 5 conductors = 2000 ft/);
    expect(rows.find(x => /1" PVC/.test(x.item))!.qty).toBeGreaterThan(0);
    expect(r.scopes!.site.source).toBe(3);
  });
});

describe("S4 (fix round) — Agent 2's feeder RUN row becomes a note only when its edge was emitted as priced rows", () => {
  const genWith = (resolve: (n: string) => boolean) => computeGeneratedTakeoffRows({
    agent2Raw, agent1Raw: live.agent1, countResult: { ...live.countResult, locate: scriptedLocate() } as never,
    takeoffRows: parseAgent2Takeoff(agent2Raw) as never, resolveName: resolve,
    resolveParts: parts => resolveRunParts(parts, candidates, itemsById) != null,
    settings: {}, bid: { sq_ft: 7147, stage: 'due', calibration: false }, existing: [], scales: live.estSheets as never, pins: [],
    feeders: { pins: [], textSheets: textSheets0930() },
  });
  const noted = (r: ReturnType<typeof genWith>) => (r.takeoff as Array<{ item: string; note?: string | null }>).filter(x => x.note === 'feeder_estimate').map(x => x.item);
  it('priced edge → the RUN row is a note; the same edge unresolved (a library item missing) → the row keeps its hold, no note', () => {
    expect(noted(genWith(resolveName))).toEqual(['Feeder 4#3/0,#6G,2"C disconnect to panel']);
    expect(noted(genWith(n => !/#6 /.test(n) && resolveName(n)))).toEqual([]);
  });
});

describe('gap-closing T4 (b) — the wireway → disconnect taps and the Polaris taps', () => {
  it('a due bid prices each tap (~5 ft 2" nipple + one set of the service #3/0) and 8 Polaris taps by code; a submitted bid gets none', () => {
    const taps = (r: ReturnType<typeof gen>) => (r.rows as Array<GeneratedTakeoffRow & { libraryCode?: string }>).filter(x => /^Tap — |^Polaris taps/.test(x.item));
    const due = taps(gen({ stage: 'due', locate: true }));
    expect(due.map(x => [x.item, x.qty, x.unit])).toEqual([
      ['Tap — WIREWAY → DISCON A: 2" EMT nipple', 5, 'LF'], ['Tap — WIREWAY → DISCON A: #3/0 wire (4 per tap)', 20, 'LF'],
      ['Tap — WIREWAY → DISCON B: 2" EMT nipple', 5, 'LF'], ['Tap — WIREWAY → DISCON B: #3/0 wire (4 per tap)', 20, 'LF'],
      ['Polaris taps — 8', 8, 'EA'],
    ]);
    expect(due[4].libraryCode).toBe('TAP-POLARIS');
    expect(due[4].evidence).toMatch(/WIREWAY → DISCON A 4 × #3\/0; WIREWAY → DISCON B 4 × #3\/0 = 8/);
    expect(due[0].evidence).toMatch(/One set of the service conductors: "/);
    expect(taps(gen({ stage: 'submitted' }))).toEqual([]);
  });
  it('a tap with no stated service spec is a visible needs-size hold', () => {
    const rows = feederTapRows([{ from: 'WIREWAY', to: 'DISCON A', quote: 'Wireway / Meter base', spec: null }], { resolveName: () => true });
    expect(rows.map(r => [r.item, r.qty, r.holdReason])).toEqual([['Tap — WIREWAY → DISCON A', 1, 'needs_size']]);
  });
});

describe('gap-closing T4 (c) — the underground PVC labor adjustment', () => {
  const rows = [
    { category: 'Site / Underground / Allowances', item: 'Site lighting circuits — 1" PVC underground', spec: '1" PVC Sch 40 (incl. fittings/glue)', qty: 300, unit: 'LF' },
    { category: 'Site / Underground / Allowances', item: 'Feeder — XFMR → METER: 2" PVC', spec: '2" PVC Sch 40, underground (incl. fittings/glue)', qty: 100, unit: 'LF' },
    { category: 'Feeders (allowance)', item: 'Feeder — A → B: 2" EMT', spec: '2" EMT (incl. couplings/straps)', qty: 50, unit: 'LF' },
  ];
  const per = (n: string) => (/1" PVC/.test(n) ? 0.043 : /2" PVC/.test(n) ? 0.075 : 0.085);
  it('0% (the default) → no row; 25% → one row with the math (buried PVC only)', () => {
    expect(undergroundAdjustmentRow(rows, 0, per)).toBeNull();
    const r = undergroundAdjustmentRow(rows, 25, per)!;
    expect(r.qty).toBeCloseTo((300 * 0.043 + 100 * 0.075) * 0.25, 2);
    expect(r.libraryCode).toBe('ADJ-UG-HR');
    expect(r.evidence).toMatch(/undergroundLaborAdjPct = 25%/);
    expect(r.evidence).not.toMatch(/EMT/);
  });
  it('the setting validates (0–100) and defaults to 0', () => {
    expect(parseFeederEstimateSettings(null).undergroundLaborAdjPct).toBe(0);
    expect(validateFeederEstimateJson(JSON.stringify({ undergroundLaborAdjPct: 25 }))).toEqual([]);
    expect(validateFeederEstimateJson(JSON.stringify({ undergroundLaborAdjPct: 125 }))).toEqual(['undergroundLaborAdjPct must be at most 100']);
    expect(validateFeederEstimateJson(JSON.stringify({ undergroundLaborAdjPct: -1 }))).toEqual(['undergroundLaborAdjPct must be at least 0']);
  });
});
