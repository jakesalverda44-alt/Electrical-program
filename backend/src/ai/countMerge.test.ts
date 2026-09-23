// Takeoff accuracy Task 5 — merge + cross-sheet rules, on a Kissimmee-shaped
// fixture (real two-batch Agent 1 output, merged by the real
// mergeAgent1Batches): PH0.1 is never counted, wall packs shown on the site
// plan are ignored there, poles and heads are separate lines, Agent 1's
// stacked "4 site lights" from E-7 and its 8 type-D wall packs cannot survive
// next to the counted types, and the load cross-check flags a > 20% gap.
import { describe, expect, it } from 'vitest';
import { mergeCountsIntoTakeoff, combineSheetCounts, computeLoadCheck, matchRowToTarget, rowMatchScore, type SheetCountInput } from './countMerge';
import { buildCountTargets, type CountTarget } from './countTargets';
import { selectCountSheets, type CountSheet } from './countSheets';
import { kissimmeeAgent1, carWashAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';

function marks(counts: Record<string, number>): Array<{ typeKey: string }> {
  return Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));
}

// The Kissimmee set as the page classifier would inventory it.
const selection = selectCountSheets([
  { file: 'set.pdf', page: 1, sheetNo: 'E-0.1', title: 'ELECTRICAL LEGEND & FIXTURE SCHEDULE', discipline: 'electrical', cls: 'schedule', included: true },
  { file: 'set.pdf', page: 2, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 3, sheetNo: 'E-2', title: 'POWER PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 4, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 5, sheetNo: 'E-3.1', title: 'ENLARGED RESTROOM LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
  { file: 'set.pdf', page: 6, sheetNo: 'E-7', title: 'ELECTRICAL DETAILS', discipline: 'electrical', cls: 'detail', included: true },
  { file: 'set.pdf', page: 7, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'electrical', cls: 'plan', included: true },
]);
const sheet = (no: string): CountSheet => selection.counted.find(s => s.sheetNo === no)!;

const KISSIMMEE_SHEETS: SheetCountInput[] = [
  // The site plan shows the poles AND the building outline with its 3 north wall packs.
  { sheet: sheet('E-1'), status: 'counted', placed: marks({ S1: 2, S2: 1, D: 3 }), unreadable: [] },
  // The power plan shows the lighting faintly in the background.
  { sheet: sheet('E-2'), status: 'counted', placed: marks({ A: 70, GFI: 16, 'DUPLEX RECEPTACLE': 11, S: 8 }), unreadable: [] },
  { sheet: sheet('E-3'), status: 'counted', placed: marks({ A: 73, B: 52, M: 6, C: 2, G: 11, E: 10, F: 6, K: 6, J: 2, D: 5, L: 2 }), unreadable: [] },
  { sheet: sheet('E-3.1'), status: 'counted', placed: marks({ M: 6 }), unreadable: [] },
];

describe('mergeCountsIntoTakeoff — Kissimmee-shaped', () => {
  const a1 = kissimmeeAgent1();
  const { targets } = buildCountTargets(a1);
  const r = mergeCountsIntoTakeoff(a1, targets, KISSIMMEE_SHEETS, { countingRan: true });
  const byKey = Object.fromEntries(r.types.map(t => [t.key, t]));

  it('PH0.1 and the schedule/detail sheets were never counted', () => {
    expect(selection.counted.map(s => s.sheetNo)).toEqual(['E-1', 'E-2', 'E-3', 'E-3.1']);
    expect(selection.skipped.map(s => s.label.split(' ')[0])).toEqual(['E-0.1', 'E-7', 'PH0.1']);
  });

  it('interior types come from the lighting plan (the power plan background is ignored, not summed)', () => {
    expect(byKey.A.count).toBe(73);
    expect(byKey.A.sheets.find(s => s.label.startsWith('E-2'))!.ignoredReason).toBe('lighting is taken from the lighting plan');
    expect(byKey.B.count).toBe(52);
    expect(byKey.G.count).toBe(11);
    const exitEm = ['E', 'F', 'K', 'J'].reduce((s, k) => s + byKey[k].count, 0);
    expect(exitEm).toBe(24);
  });

  it('wall packs: 5 from the building plan; the 3 drawn on the site plan are ignored, not stacked', () => {
    expect(byKey.D.count).toBe(5);
    expect(byKey.D.sheets.find(s => s.label.startsWith('E-1'))!.ignoredReason).toMatch(/only on the building plan/);
    expect(byKey.L.count).toBe(2);
  });

  it('poles and heads are separate: S1 x2 + S2 x1 = 3 poles / 4 heads', () => {
    expect(byKey.S1.count + byKey.S2.count).toBe(3);
    expect((byKey.S1.heads ?? 0) + (byKey.S2.heads ?? 0)).toBe(4);
    const rows = r.quantities.filter(q => /^Type S\d/.test(String(q.item)));
    expect(rows.map(q => [q.item, q.qty])).toEqual([
      ['Type S1 — pole (LED area light on 25 ft pole, single head)', 2],
      ['Type S1 — fixture heads (1 per pole)', 2],
      ['Type S2 — pole (LED area light on 25 ft pole, twin head)', 1],
      ['Type S2 — fixture heads (2 per pole)', 2],
    ]);
  });

  it('enlarged restroom plan showing the same 6 M fixtures: flagged, kept 6, not summed to 12', () => {
    expect(byKey.M.count).toBe(6);
    expect(byKey.M.flags.join(' ')).toMatch(/enlarged plan E-3.1 .* \(6\) and on the main plan \(6\) — kept the larger \(6\), not summed/);
  });

  it('devices come from the power plan', () => {
    expect(byKey.GFI.count).toBe(16);
    expect(byKey['DUPLEX RECEPTACLE'].count).toBe(11);
    expect(byKey.S.count).toBe(8);
  });

  it('a type found nowhere is "zero" (and goes to review), never assumed', () => {
    expect(byKey.OS.status).toBe('zero');
    expect(byKey.OS.reason).toBe('not found on any counted plan sheet');
    const os = r.quantities.find(q => q.countType === 'OS')!;
    expect(os.qty).toBe(0);
    expect(os.confidence).toBe('NOT SHOWN');
    expect(String(os.spec)).toMatch(/^COUNT PENDING ESTIMATOR REVIEW/);
  });

  it('Agent 1 rows for counted types are replaced, and the unscheduled "Site lights 4 (E-7)" row is removed — nothing stacks', () => {
    const removed = r.removedRows.map(x => `${x.row.item}|${x.replacedByType ?? '-'}`);
    expect(removed).toEqual([
      'Type A 4 ft LED wraparound|A',
      'Type B 8 ft LED wraparound|B',
      'LED exit sign|E',
      'LED wall pack (D)|D',
      'Pole light S1|S1',
      'Pole light S2|S2',
      'Site lights|-',
      'Duplex receptacle|Duplex receptacle',
    ]);
    // Exactly one line per counted type (two for pole types), nothing else in the fixture categories.
    const fixtureRows = r.quantities.filter(q => ['Interior Lighting', 'Exterior Site Lighting'].includes(String(q.category)));
    expect(fixtureRows.every(q => q.countedBy === 'counter')).toBe(true);
    expect(fixtureRows.filter(q => q.countType === 'D')).toHaveLength(1);
    // Non-type rows survive untouched.
    expect(r.quantities.some(q => q.item === 'Panel LP 225A')).toBe(true);
  });

  it('counted rows are ASSUMED (visual count -> APPROX), never FIRM', () => {
    const a = r.quantities.find(q => q.countType === 'A')!;
    expect(a).toMatchObject({ category: 'Interior Lighting', item: 'Type A — 4 ft LED linear wraparound', qty: 73, unit: 'EA', sourceSheet: 'E-3', confidence: 'ASSUMED' });
  });

  it('load cross-check: counted watts vs lighting circuits > 20% apart is flagged; a kVA-looking load is excluded, not converted', () => {
    expect(r.loadCheck.ran).toBe(true);
    expect(r.loadCheck.circuitVA).toBe(5410);
    expect(r.loadCheck.countedWatts).toBe(73 * 32 + 52 * 64 + 2 * 38 + 6 * 32 + 11 * 15 + 10 * 3 + 6 * 5 + 6 * 3 + 2 * 2 + 5 * 40 + 2 * 18 + 2 * 150 + 1 * 300);
    expect(r.loadCheck.discrepancy).toBe(true);
    expect(r.loadCheck.suspectCircuits).toEqual([{ panel: 'LP', circuit: '9', loadVA: 0.25, note: expect.stringMatching(/probably kVA/) }]);
    expect(r.flags.some(f => /over the panel schedules' lighting circuits \(5410 VA\)/.test(f))).toBe(true);
  });
});

describe('combineSheetCounts — edge rules', () => {
  const t = (key: string, category: CountTarget['category']): CountTarget =>
    ({ type: key, key, description: key, symbolHint: '', wattage: null, category, source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false });
  const cs = (key: string, role: CountSheet['role'], focus: CountSheet['focus'], level = ''): CountSheet =>
    ({ key, file: 'f', page: 1, sheetNo: key, title: key, label: key, role, focus, level });

  it('different levels are summed; the same level keeps the larger and flags it', () => {
    const r = combineSheetCounts(t('A', 'interior_lighting'), [
      { sheet: cs('E-201', 'building', 'lighting', '1'), status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
      { sheet: cs('E-202', 'building', 'lighting', '2'), status: 'counted', placed: marks({ A: 30 }), unreadable: [] },
      { sheet: cs('E-202B', 'building', 'lighting', '2'), status: 'counted', placed: marks({ A: 28 }), unreadable: [] },
    ]);
    // Fix round 1 / B4: two same-level sheets whose titles name no area are
    // NOT silently max-kept — the larger is kept provisionally and the
    // estimator is asked (same area 70 vs different areas 98).
    expect(r.count).toBe(70);
    expect(r.areaQuestion).toEqual({ sheets: [{ label: 'E-202', count: 30 }, { label: 'E-202B', count: 28 }], keep: 70, sum: 98 });
    expect(r.flags[0]).toMatch(/E-202 \(30\) and E-202B \(28\) — the titles don't say whether these show the same area/);
  });

  it('enlarged plan with MORE than the main plan: larger kept and flagged', () => {
    const r = combineSheetCounts(t('M', 'interior_lighting'), [
      { sheet: cs('E-3', 'building', 'lighting'), status: 'counted', placed: marks({ M: 2 }), unreadable: [] },
      { sheet: cs('E-3.1', 'enlarged', 'lighting'), status: 'counted', placed: marks({ M: 6 }), unreadable: [] },
    ]);
    expect(r.count).toBe(6);
    expect(r.sheets.find(s => s.label === 'E-3.1')!.used).toBe(true);
    expect(r.sheets.find(s => s.label === 'E-3')!.used).toBe(false);
  });

  it('one combined sheet with no site plan: site types are taken from it (with a note)', () => {
    const r = combineSheetCounts(t('S1', 'site_lighting'), [
      { sheet: cs('E-1', 'building', 'combined'), status: 'counted', placed: marks({ S1: 4 }), unreadable: [] },
    ]);
    expect(r.count).toBe(4);
    expect(r.flags[0]).toMatch(/No site plan was counted/);
  });

  it('a failed allowed sheet or an unreadable report is surfaced for the gate', () => {
    const r = combineSheetCounts(t('A', 'interior_lighting'), [
      { sheet: cs('E-3', 'building', 'lighting'), status: 'failed', error: 'x', placed: [], unreadable: [] },
      { sheet: cs('E-4', 'building', 'lighting', '2'), status: 'counted', placed: marks({ A: 3 }), unreadable: [{ typeKey: 'A', tileId: 'R1C1', note: 'hatched' }] },
    ]);
    expect(r.allowedFailed).toEqual(['E-3']);
    expect(r.unreadableOn).toEqual(['E-4']);
  });
});

// Fix round 1 / B4 (review repros R3a, R3b) and S3 (R3c): split-area plans
// are partitions of one level — summed, never max-kept — and a count taken
// from the wrong kind of sheet is a blocking coverage problem.
describe('split areas and partial coverage (fix round 1)', () => {
  const A: CountTarget = { type: 'A', key: 'A', description: '2x4 LED troffer', symbolHint: '', wattage: null, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false };
  const pick = (inv: Array<[string, string]>) => selectCountSheets(inv.map(([no, title], i) => ({ file: 'set.pdf', page: i + 1, sheetNo: no, title, discipline: 'electrical', cls: 'plan', included: true }))).counted;

  it('R3a — "PARTIAL LIGHTING PLAN - AREA A" 40 + "- AREA B" 35 = 75, counted, no question', () => {
    const [a, b] = pick([['E-2.1', 'PARTIAL LIGHTING PLAN - AREA A'], ['E-2.2', 'PARTIAL LIGHTING PLAN - AREA B']]);
    expect([a.role, a.area, a.partial, b.area]).toEqual(['building', 'AREA A', true, 'AREA B']);
    const r = combineSheetCounts(A, [
      { sheet: a, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
      { sheet: b, status: 'counted', placed: marks({ A: 35 }), unreadable: [] },
    ]);
    expect(r.count).toBe(75);
    expect(r.areaQuestion).toBeUndefined();
    expect(r.coverage).toBeUndefined();
    expect(r.flags).toEqual(['A: different areas of one level summed — E-2.1 "PARTIAL LIGHTING PLAN - AREA A" (40) + E-2.2 "PARTIAL LIGHTING PLAN - AREA B" (35).']);
  });

  it('R3b — "LIGHTING PLAN - AREA A" 40 + "LIGHTING PLAN - AREA B" 35 = 75; NORTH/SOUTH and PART 1/2 the same', () => {
    for (const [ta, tb] of [['LIGHTING PLAN - AREA A', 'LIGHTING PLAN - AREA B'], ['LIGHTING PLAN - NORTH', 'LIGHTING PLAN - SOUTH'], ['FLOOR PLAN LIGHTING PART 1', 'FLOOR PLAN LIGHTING PART 2']]) {
      const [a, b] = pick([['E-2.1', ta], ['E-2.2', tb]]);
      const r = combineSheetCounts(A, [
        { sheet: a, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
        { sheet: b, status: 'counted', placed: marks({ A: 35 }), unreadable: [] },
      ]);
      expect(r.count, `${ta} / ${tb}`).toBe(75);
      expect(r.areaQuestion).toBeUndefined();
    }
  });

  it('two "LIGHTING PLAN" sheets of one level with no area named: 40 kept for now, BLOCKING question 40 vs 75', () => {
    const [a, b] = pick([['E-2.1', 'LIGHTING PLAN'], ['E-2.2', 'LIGHTING PLAN']]);
    const r = combineSheetCounts(A, [
      { sheet: a, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
      { sheet: b, status: 'counted', placed: marks({ A: 35 }), unreadable: [] },
    ]);
    expect(r.count).toBe(40);
    expect(r.areaQuestion).toEqual({ sheets: [{ label: 'E-2.1 "LIGHTING PLAN"', count: 40 }, { label: 'E-2.2 "LIGHTING PLAN"', count: 35 }], keep: 40, sum: 75 });
  });

  it('an ENLARGED plan of an area the main plan covers is max-kept (never summed); only an enlarged plan counted is a coverage problem', () => {
    const [main, enl] = pick([['E-3', 'LIGHTING PLAN'], ['E-3.1', 'ENLARGED RESTROOM LIGHTING PLAN']]);
    const r1 = combineSheetCounts(A, [
      { sheet: main, status: 'counted', placed: marks({ A: 40 }), unreadable: [] },
      { sheet: enl, status: 'counted', placed: marks({ A: 6 }), unreadable: [] },
    ]);
    expect(r1.count).toBe(40);
    expect(r1.areaQuestion).toBeUndefined();
    const r2 = combineSheetCounts(A, [{ sheet: enl, status: 'counted', placed: marks({ A: 6 }), unreadable: [] }]);
    expect(r2.count).toBe(6);
    expect(r2.coverage?.[0]).toMatch(/counted only on the enlarged plan E-3.1 .* \(6\) — no main plan count/);
    expect(r2.flags.join(' ')).toMatch(/counted only on the enlarged plan/);
  });

  it('a lone PARTIAL plan with no named area is a coverage problem', () => {
    const [p] = pick([['E-2.1', 'PARTIAL LIGHTING PLAN']]);
    const r = combineSheetCounts(A, [{ sheet: p, status: 'counted', placed: marks({ A: 40 }), unreadable: [] }]);
    expect(r.coverage?.[0]).toMatch(/only on the partial plan/);
  });

  it('R3c — only a POWER PLAN counted: lighting taken from it, but flagged as a BLOCKING coverage problem', () => {
    const [pw] = pick([['E-2', 'POWER PLAN']]);
    const r = combineSheetCounts(A, [{ sheet: pw, status: 'counted', placed: marks({ A: 12 }), unreadable: [] }]);
    expect(r.count).toBe(12);
    expect(r.coverage).toEqual(['A was counted only on the power plan (E-2 "POWER PLAN") — no lighting plan was counted for it.']);
  });

  it('eligible sheets are marked (confirmed markers count only there)', () => {
    const [light, pw] = pick([['E-3', 'LIGHTING PLAN'], ['E-2', 'POWER PLAN']]);
    const r = combineSheetCounts(A, [
      { sheet: light, status: 'counted', placed: marks({ A: 73 }), unreadable: [] },
      { sheet: pw, status: 'counted', placed: marks({ A: 70 }), unreadable: [] },
    ]);
    expect(r.sheets.map(x => [x.label.split(' ')[0], x.eligible, x.used])).toEqual([['E-3', true, true], ['E-2', false, false]]);
  });
});

describe('mergeCountsIntoTakeoff — status and edge cases', () => {
  it('N1 — a type seen only on a sheet it is not counted on says so', () => {
    const a1 = { quantities: [], fixtureSchedule: [{ type: 'D', description: 'LED wall pack', location: 'exterior_building', wattage: 40 }] };
    const { targets } = buildCountTargets(a1);
    const site: CountSheet = { key: 'k1', file: 'f', page: 1, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', label: 'E-1', role: 'site', focus: 'combined', level: '' };
    const bldg: CountSheet = { key: 'k2', file: 'f', page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', label: 'E-3', role: 'building', focus: 'lighting', level: '' };
    const r = mergeCountsIntoTakeoff(a1, targets, [
      { sheet: site, status: 'counted', placed: marks({ D: 5 }), unreadable: [] },
      { sheet: bldg, status: 'counted', placed: [], unreadable: [] },
    ], { countingRan: true });
    expect(r.types[0].status).toBe('zero');
    expect(r.types[0].reason).toBe('found only on E-1 (5) — not counted there (building fixtures and devices are counted only on the building plan)');
  });

  it('B3 (review repro C) — an Agent 1 fixture row matching no scheduled type is held for review, never silently dropped', () => {
    const a1 = kissimmeeAgent1();
    a1.fixtureSchedule = (a1.fixtureSchedule as Array<{ type: string }>).filter(f => f.type !== 'M');
    (a1.quantities as Array<Record<string, unknown>>).push({ category: 'Interior Lighting', item: 'Type M — 2x2 LED flat panel', qty: 6, unit: 'EA', sourceSheet: 'E-3' });
    const { targets } = buildCountTargets(a1);
    const r = mergeCountsIntoTakeoff(a1, targets, KISSIMMEE_SHEETS, { countingRan: true });
    const held = r.removedRows.filter(x => x.unscheduled);
    expect(held.map(x => [x.row.item, x.row.qty])).toContainEqual(['Type M — 2x2 LED flat panel', 6]);
    expect(held.every(x => x.replacedByType === null)).toBe(true);
  });

  it('S4 (review repro R5) — a counted legend disconnect replaces Agent 1\'s Service & Distribution row and stays in that category (4, not 8)', () => {
    const a1 = {
      quantities: [{ category: 'Service & Distribution', item: '60A fused disconnect switch, NEMA 3R', qty: 4, unit: 'EA', sourceSheet: 'E-4' }],
      symbolLegend: [{ symbol: 'DS', description: 'Fused disconnect switch', kind: 'device' }],
    };
    const { targets } = buildCountTargets(a1);
    expect(targets.map(t => [t.type, t.category])).toEqual([['DS', expect.stringMatching(/device|equipment/)]]);
    const s: CountSheet = { key: 'k', file: 'f', page: 1, sheetNo: 'E-2', title: 'POWER PLAN', label: 'E-2', role: 'building', focus: 'power', level: '' };
    const r = mergeCountsIntoTakeoff(a1, targets, [{ sheet: s, status: 'counted', placed: marks({ DS: 4 }), unreadable: [] }], { countingRan: true });
    const disc = r.quantities.filter(q => /disconnect/i.test(String(q.item)));
    expect(disc.map(q => [q.category, q.qty])).toEqual([['Service & Distribution', 4]]);
  });

  it('counting that never ran makes every target unreadable (review), not zero, and keeps Agent 1 rows', () => {
    const a1 = kissimmeeAgent1();
    const { targets } = buildCountTargets(a1);
    const r = mergeCountsIntoTakeoff(a1, targets, [], { countingRan: false, notRunReason: 'no page classification — the counter could not tell which pages are plans' });
    expect(new Set(r.types.map(t => t.status))).toEqual(new Set(['unreadable']));
    expect(r.types[0].reason).toMatch(/no page classification/);
    // Nothing was counted, so nothing replaces Agent 1's rows: they stay as-is
    // (and every type is held in review instead).
    expect(r.quantities).toEqual(a1.quantities);
    expect(r.removedRows).toEqual([]);
  });

  it('heads per pole missing -> heads row pending, poles row counted', () => {
    const a1 = { quantities: [], fixtureSchedule: [{ type: 'P1', description: 'Area light on pole', location: 'site', wattage: 100 }] };
    const { targets } = buildCountTargets(a1);
    const s: CountSheet = { key: 'k', file: 'f', page: 1, sheetNo: 'E-1', title: 'SITE PLAN', label: 'E-1', role: 'site', focus: 'combined', level: '' };
    const r = mergeCountsIntoTakeoff(a1, targets, [{ sheet: s, status: 'counted', placed: marks({ P1: 5 }), unreadable: [] }], { countingRan: true });
    const rows = r.quantities.map(q => [q.item, q.qty, q.confidence]);
    expect(rows).toEqual([
      ['Type P1 — pole (Area light on pole)', 5, 'ASSUMED'],
      ['Type P1 — fixture heads', 0, 'NOT SHOWN'],
    ]);
    expect(r.flags.join(' ')).toMatch(/heads per pole is not on the schedule/);
  });

  it('car wash: the aggregate "Equipment connections 3" row is replaced by one line per tag', () => {
    const a1 = carWashAgent1();
    const { targets } = buildCountTargets(a1);
    const s: CountSheet = { key: 'k', file: 'f', page: 3, sheetNo: 'E3.0', title: 'EQUIPMENT POWER PLAN', label: 'E3.0', role: 'building', focus: 'power', level: '' };
    const s2: CountSheet = { ...s, key: 'k2', page: 2, sheetNo: 'E2.0', title: 'LIGHTING PLAN', label: 'E2.0', focus: 'lighting' };
    const r = mergeCountsIntoTakeoff(a1, targets, [
      { sheet: s, status: 'counted', placed: marks({ 'EQ-1': 1, 'EQ-2': 1, 'VAC-1': 1 }), unreadable: [] },
      { sheet: s2, status: 'counted', placed: marks({ W1: 12, WP: 4 }), unreadable: [] },
    ], { countingRan: true });
    expect(r.removedRows.map(x => x.row.item)).toEqual(['Equipment connections']);
    expect(r.quantities.filter(q => q.category === 'Branch Power').map(q => [q.item, q.qty])).toEqual([
      ['EQ-1 — Dryer producer, 15 HP (connection)', 1],
      ['EQ-2 — High pressure pump station, 10 HP (connection)', 1],
      ['VAC-1 — Central vacuum producer, 20 HP (connection)', 1],
    ]);
  });
});

describe('row matching', () => {
  const t = (key: string, description: string): CountTarget =>
    ({ type: key, key, description, symbolHint: '', wattage: null, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false });
  it('explicit tag forms match; a bare one-letter word does not', () => {
    expect(rowMatchScore({ item: 'Type A troffer' }, t('A', 'x y'))).toBe(3);
    expect(rowMatchScore({ item: 'Wall pack (D)' }, t('D', 'x y'))).toBe(3);
    expect(rowMatchScore({ item: 'A - Troffer' }, t('A', 'x y'))).toBe(3);
    expect(rowMatchScore({ item: 'A 2x4 troffer' }, t('A', 'x y'))).toBe(0);
    expect(rowMatchScore({ item: 'Pole S1 area light' }, t('S1', 'x y'))).toBe(3);
    expect(rowMatchScore({ item: 'S10 fixture' }, t('S1', 'x y'))).toBe(0);
  });
  it('the exact description beats a substring match', () => {
    const gfi = t('GFI', 'GFCI duplex receptacle');
    const dup = t('DUPLEX RECEPTACLE', 'Duplex receptacle');
    expect(matchRowToTarget({ item: 'Duplex receptacle' }, [gfi, dup])).toBe(dup);
    expect(matchRowToTarget({ item: 'GFCI duplex receptacle' }, [gfi, dup])).toBe(gfi);
  });
  it('load check is skipped (with the reason) when a counted fixture has no wattage', () => {
    const lc = computeLoadCheck([{ key: 'A', type: 'A', description: '', category: 'interior_lighting', count: 3, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null }],
      [{ panel: 'LP', circuit: '1', description: 'LTG', loadVA: 500 }]);
    expect(lc.ran).toBe(false);
    expect(lc.skippedReason).toBe('no wattage on the schedule for type(s) A');
  });
});
