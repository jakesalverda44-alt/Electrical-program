// Evidence round 3.1 / 3.2 / 3.4 — schedules read row by row (the E-4 panel
// schedules as transcribed from the real sheet), panel circuit rows, and
// equipment quantities OWNED by the schedule rows (Kissimmee's real Agent 1
// equipment list).
import { describe, it, expect } from 'vitest';
import { buildCountTargets } from '../countTargets';
import {
  parseScheduleReply, tableFromRuns, panelCircuitRows, panelContinuity, scheduleCounts, multiplierOf, circuitRefs,
  isCircuitCountRow, circuitSummaryRows, rowNamesTarget, tableKindOf, type ScheduleTable,
} from './schedules';
import { TABLE_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';

const { targets } = buildCountTargets(loadKissimmeeBaseline().agent1);
const E4 = 'set.pdf#52';
const table = (title: string, rect = { left: 12.5, top: 0.5, width: 10.4, height: 10.6 }): ScheduleTable =>
  parseScheduleReply(TABLE_REPLIES[title], { sheetKey: E4, sheetLabel: 'E-4 "Panelboard / 1-Line"', viewportId: `${E4}@u${title.length}`, viewportTitle: title, rectIn: rect })!;
const A = table('PANEL A'), B = table('PANEL B'), LT = table('LOAD TOTALS');

describe('3.1 — tables row by row, with cell evidence', () => {
  it('Panel A / B: 42 rows each, circuit numbering complete, rows placed on the sheet', () => {
    expect([A.kind, B.kind, LT.kind]).toEqual(['panel', 'panel', 'load']);
    expect(A.rows).toHaveLength(42);
    expect(A.warnings).toEqual([]);
    expect(A.rows[0].boxIn!.top).toBeGreaterThan(0.5);
    expect(A.rows[0].boxIn!.width).toBeCloseTo(10.4);
  });
  it('panel circuit rows: breaker poles, 3-pole continuation rows are one load, loads summed from A/B/C', () => {
    const rows = panelCircuitRows(B);
    const rtu = rows.filter(r => r.circuit === 1 || r.circuit === 3 || r.circuit === 5);
    expect(rtu.map(r => [r.description, r.poles, r.continuation])).toEqual([['RTU-1', 3, false], ['', 3, true], ['', 3, true]]);
    expect(rows.find(r => r.circuit === 15)).toMatchObject({ panel: 'B', description: 'BATTERY CHARGER', loadVA: 1490, breaker: '20/1' });
  });
  it('a transcription that skipped rows is flagged incomplete (never trusted silently)', () => {
    const skipped = JSON.parse(TABLE_REPLIES['PANEL B']);
    skipped.rows = skipped.rows.filter((r: { cells: string[] }) => !['17', '19'].includes(r.cells[0]));
    const t = parseScheduleReply(JSON.stringify(skipped), { sheetKey: E4, sheetLabel: 'E-4', viewportId: 'v', viewportTitle: 'PANEL B' })!;
    expect(t.warnings).toEqual(['PANEL B: circuit(s) 17, 19 missing from the transcription — incomplete']);
    expect(panelContinuity({ ...t, rows: [] })).toEqual(['PANEL B: no circuit rows could be read']);
    expect(parseScheduleReply('{"table":"x"}', { sheetKey: E4, sheetLabel: 'E-4', viewportId: null, viewportTitle: 'X' })).toBeNull();
  });
  it('the text-layer path builds the same row shape from runs under a header', () => {
    const run = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 5, h: 8 });
    const t = tableFromRuns([
      run('CKT', 10, 10), run('BREAKER', 40, 10), run('DESCRIPTION', 90, 10), run('A', 220, 10),
      run('15', 10, 22), run('20/1', 40, 22), run('BATT CHGR (5)', 90, 22), run('7,450', 220, 22),
      run('17', 10, 34), run('20/1', 40, 34), run('WATER HEATER', 90, 34), run('1,500', 220, 34),
    ], { sheetKey: 'k', sheetLabel: 'E-9', viewportId: 'k@u1', title: 'PANEL LP' })!;
    expect(t.kind).toBe('panel');
    expect(t.rows.map(r => r.cells)).toEqual([['15', '20/1', 'BATT CHGR (5)', '7,450'], ['17', '20/1', 'WATER HEATER', '1,500']]);
    expect(t.source).toBe('text');
  });
  it('kinds from titles and columns', () => {
    expect(tableKindOf('LIGHT FIXTURE SCHEDULE', ['SYMBOL', 'DESCRIPTION'])).toBe('fixture');
    expect(tableKindOf('POWER SCHEDULE', ['SYM', 'DESCRIPTION', 'FURN.', 'REMARKS'])).toBe('other');
    expect(tableKindOf('MECHANICAL EQUIPMENT CONNECTIONS', ['TAG', 'HP'])).toBe('equipment');
  });
});

describe('3.2 — equipment quantities owned by the schedule rows', () => {
  const sched = scheduleCounts(targets, [A, B, LT, table('POWER SCHEDULE')]);
  it('battery chargers 5 from Panel B circuits 15-23; each other load 1, with its row', () => {
    expect(sched.get('BATT CHGR')!.qty).toBe(5);
    expect(sched.get('BATT CHGR')!.rows.map(r => r.cells[0])).toEqual(['15', '17', '19', '21', '23']);
    const one = ['WH', 'ALC', 'MINI-TUNE', 'DRINK MACH', 'DF', 'PYLON SIGN', 'RTU-1', 'RTU-2', 'DISCON A', 'DISCON B'];
    for (const k of one) expect([k, sched.get(k)?.qty]).toEqual([k, 1]);
    expect(sched.get('WH')!.rows[0].cells.slice(0, 3)).toEqual(['27', '20/1', 'WATER HEATER']);
    expect(sched.get('DISCON A')!.rows[0].table).toBe('LOAD TOTALS');
  });
  it('types no row names stay with the counter; a symbol legend row is never a quantity', () => {
    for (const k of ['MB', 'WIREWAY', 'LCP', 'DATA CONCENTRATOR', 'EF', 'CF1-CF3', 'PNL-A/B']) expect(sched.has(k)).toBe(false);
    // legend / device types are never schedule-owned.
    expect(sched.has('SIMPLEX RECEPTACLE')).toBe(false);
    expect([...sched.keys()].length).toBe(11);
  });
  it('"BATT CHGR (5)" on ONE circuit expands to 5', () => {
    const one = parseScheduleReply(JSON.stringify({ title: 'PANEL C', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], rows: [{ cells: ['7', '20/1', 'BATT CHGR (5)', '7450'] }] }),
      { sheetKey: 'k', sheetLabel: 'E-9', viewportId: 'v', viewportTitle: 'PANEL C' })!;
    expect(scheduleCounts(targets.filter(t => t.key === 'BATT CHGR'), [one]).get('BATT CHGR')!.qty).toBe(5);
  });
  it('helpers: multipliers, circuit references, row naming by tag or description', () => {
    expect(multiplierOf('BATT CHGR (5)')).toBe(5);
    expect(multiplierOf('VACUUM (QTY 2)')).toBe(2);
    expect(multiplierOf('WATER HEATER')).toBeNull();
    expect(circuitRefs('Battery chargers (5), 1,490VA each, B-15/17/19/21/23')).toEqual([15, 17, 19, 21, 23].map(c => ({ panel: 'B', circuit: c })));
    expect(circuitRefs('Rooftop unit, 60/3 breaker B-1,3,5, CMR-9 sensor')).toEqual([{ panel: 'B', circuit: 1 }, { panel: 'B', circuit: 3 }, { panel: 'B', circuit: 5 }, { panel: 'CMR', circuit: 9 }]);
    const t = (k: string) => targets.find(x => x.key === k)!;
    expect(rowNamesTarget('DRINKING FOUNTAIN', t('DF'))).toBe(true);
    expect(rowNamesTarget('DRINK MACHINE', t('DF'))).toBe(false);
    expect(rowNamesTarget('DRINK MACHINE', t('DRINK MACH'))).toBe(true);
    expect(rowNamesTarget('RTU-2', t('RTU-1'))).toBe(false);
  });
});

describe('3.4 — branch-circuit counts belong to the parser', () => {
  it('recognises Agent 1\'s circuit-count rows, not conduit / feeder rows', () => {
    expect(isCircuitCountRow({ item: 'Lighting branch circuits 20/1 (work, sales, exit/em, restroom)' })).toBe(true);
    expect(isCircuitCountRow({ item: 'Sign circuits 20/1 (front wall, 2 side wall, pylon)' })).toBe(true);
    expect(isCircuitCountRow({ item: '20/1 branch circuits Panel B' })).toBe(true);
    expect(isCircuitCountRow({ item: 'Feeder 4#3/0, #6G, 2"C disconnect to panel' })).toBe(false);
    expect(isCircuitCountRow({ item: 'Duplex receptacle' })).toBe(false);
  });
  it('the parser\'s rows: one per panel and breaker size, SPACE and continuation rows left out, rows as evidence', () => {
    const rows = circuitSummaryRows([A, B]);
    const by = Object.fromEntries(rows.map(r => [String(r.row.item), r.row.qty]));
    expect(by).toEqual({
      'Branch circuit 20/1 — Panel A': 31, 'Branch circuit 60/3 — Panel B': 2, 'Branch circuit 20/1 — Panel B': 14,
    });
    expect(rows.every(r => r.row.countedBy === 'schedule' && r.evidence.length === r.row.qty)).toBe(true);
    // An incomplete table never produces rows.
    expect(circuitSummaryRows([{ ...A, warnings: ['PANEL A: circuit(s) 3 missing from the transcription — incomplete'] }])).toEqual([]);
  });
});
