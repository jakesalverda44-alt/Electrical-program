// Evidence round 3.1 / 3.2 / 3.4 — schedules read row by row (the E-4 panel
// schedules as transcribed from the real sheet), panel circuit rows, and
// equipment quantities OWNED by the schedule rows (Kissimmee's real Agent 1
// equipment list).
import { describe, it, expect } from 'vitest';
import { buildCountTargets } from '../countTargets';
import {
  parseScheduleReply, tableFromRuns, panelCircuitRows, panelContinuity, scheduleCounts, multiplierOf, circuitRefs,
  isCircuitCountRow, circuitSummaryRows, rowNamesTarget, tableKindOf, isCompletePanel, isEmptyLoad, panelNameOf, panelsNamedIn, dedupePanels, panelIdentity, PANEL_CONFLICT, type ScheduleTable,
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

describe('fix round B7 — equipment tags match whole tokens with their exact suffix; each row belongs to one tag', () => {
  const eq = (tag: string, description: string) => ({ type: tag, key: tag, description, symbolHint: '', wattage: null, category: 'equipment' as const, source: 'equipment_schedule' as const, sourceSheet: 'M-1', headsPerPole: null, emergency: false });
  // Both sides present (an odd-only panel is incomplete by fix round B9).
  const withEven = (rows: string[][]) => (rows.some(r => Number(r[0].split(',')[0]) % 2 === 0) ? rows : [...rows, ['42', '-/1', 'SPACE', '0']]);
  const panel = (rows: string[][]) => parseScheduleReply(JSON.stringify({ title: 'PANEL LP', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], rows: withEven(rows).map(cells => ({ cells })) }),
    { sheetKey: 'k', sheetLabel: 'E-9', viewportId: 'v', viewportTitle: 'PANEL LP' })!;
  it('EF-1 / EF-2 / EF-3 (same description) -> 1 each, 3 in all (was 9)', () => {
    const tg = [eq('EF-1', 'Exhaust fan, roof mounted'), eq('EF-2', 'Exhaust fan, roof mounted'), eq('EF-3', 'Exhaust fan, roof mounted')];
    const t = panel([['1', '20/1', 'EF-1 EXHAUST FAN', '300'], ['3', '20/1', 'EF-2 EXHAUST FAN', '300'], ['5', '20/1', 'EF-3 EXHAUST FAN', '300'], ['7', '20/1', 'EF-12 EXHAUST FAN', '300']]);
    const sc = scheduleCounts(tg, [t]);
    expect(['EF-1', 'EF-2', 'EF-3'].map(k => sc.get(k)?.qty)).toEqual([1, 1, 1]);
  });
  it('RTU-1 / RTU-2 -> 1 each (was 2 each)', () => {
    const tg = [eq('RTU-1', 'Rooftop unit, 60/3'), eq('RTU-2', 'Rooftop unit, 60/3')];
    const t = panel([['1', '60/3', 'RTU-1', '6124'], ['3', '|', '', '6124'], ['5', '|', '', '6124'], ['2', '60/3', 'RTU-2', '6124'], ['4', '|', '', '6124'], ['6', '|', '', '6124']]);
    const sc = scheduleCounts(tg, [t]);
    expect([sc.get('RTU-1')?.qty, sc.get('RTU-2')?.qty]).toEqual([1, 1]);
  });
  it('a row matching two targets only by description is nobody\'s (the counter keeps them)', () => {
    const tg = [eq('EF-1', 'Exhaust fan, roof mounted'), eq('EF-2', 'Exhaust fan, roof mounted')];
    expect(scheduleCounts(tg, [panel([['1', '20/1', 'EXHAUST FAN', '300'], ['3', '20/1', 'EXHAUST FAN', '300'], ['5', '20/1', 'SPACE', '0']])]).size).toBe(0);
  });
});

describe('fix round B8 — only explicit quantities', () => {
  it('reads (5), (5) EA, (QTY 5), QTY 5, QTY: 5, x5 standing alone', () => {
    for (const s of ['BATT CHGR (5)', 'BATT CHGR (5) EA', 'VACUUM (QTY 5)', 'VACUUM QTY 5', 'VACUUM QTY: 5', 'VACUUM x5 ', 'VACUUM × 5']) expect([s, multiplierOf(s)]).toEqual([s, 5]);
  });
  it('never a dimension, a rating, a conductor count or a model number', () => {
    for (const s of ['WH-1 WATER HEATER 208 1 MAX 30 (2)#10,(1)#10G', 'LTG 2X4 TROFFERS', "2'X4' TROFFER", 'MOTOR 3X460V', 'LSXR-50-HL', 'CABINET 12X12', 'DISCONNECT 30A', '(2)#10, (1)#10G', 'EXHAUST FAN (1/2 HP)']) {
      expect([s, multiplierOf(s)]).toEqual([s, null]);
    }
  });
  it('a mechanical schedule row: the multiplier comes from the description cell only', () => {
    const tg = [{ type: 'WH-1', key: 'WH-1', description: 'Water heater', symbolHint: '', wattage: null, category: 'equipment' as const, source: 'equipment_schedule' as const, sourceSheet: 'P-1', headsPerPole: null, emergency: false }];
    const t = parseScheduleReply(JSON.stringify({ title: 'MECHANICAL EQUIPMENT SCHEDULE', columns: ['TAG', 'DESCRIPTION', 'VOLTS', 'PH', 'MOCP', 'WIRE'], rows: [{ cells: ['WH-1', 'WATER HEATER', '208', '1', 'MAX 30', '(2)#10,(1)#10G'] }] }),
      { sheetKey: 'k', sheetLabel: 'M-1', viewportId: 'v', viewportTitle: 'MECHANICAL EQUIPMENT SCHEDULE' })!;
    expect(scheduleCounts(tg, [t]).get('WH-1')!.qty).toBe(1);
  });
});

describe('fix round B9 — two-sided panels from the text layer', () => {
  const run = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 5, h: 8 });
  const header = [run('CKT', 10, 10), run('BREAKER', 40, 10), run('DESCRIPTION', 90, 10), run('A', 220, 10), run('B', 240, 10), run('DESCRIPTION', 270, 10), run('BREAKER', 400, 10), run('CKT', 450, 10)];
  const line = (y: number, l: number, ld: string, r: number, rd: string) => [run(String(l), 10, y), run('20/1', 40, y), run(ld, 90, y), run('500', 220, y), run(rd, 270, y), run('20/1', 400, y), run(String(r), 450, y)];
  it('each line becomes two rows; circuits 1-8 all read; complete', () => {
    const runs = [...header, ...line(22, 1, 'LIGHTS', 2, 'RECEPT'), ...line(34, 3, 'LIGHTS', 4, 'RECEPT'), ...line(46, 5, 'SIGN', 6, 'WH'), ...line(58, 7, 'SPARE', 8, 'SPACE')];
    const t = tableFromRuns(runs, { sheetKey: 'k', sheetLabel: 'E-9', viewportId: 'k@u1', title: 'PANEL LP' })!;
    expect(panelCircuitRows(t).map(r => `${r.circuit}:${r.description}`)).toEqual(['1:LIGHTS', '2:RECEPT', '3:LIGHTS', '4:RECEPT', '5:SIGN', '6:WH', '7:SPARE', '8:SPACE']);
    expect(t.warnings).toEqual([]);
    // SPARE / SPACE are not circuits.
    expect(circuitSummaryRows([t])[0].row.qty).toBe(6);
  });
  it('a panel read on one side only is incomplete: never verified, never replaces Agent 1\'s rows', () => {
    const t = tableFromRuns([run('CKT', 10, 10), run('BREAKER', 40, 10), run('DESCRIPTION', 90, 10), run('A', 220, 10),
      ...[1, 3, 5, 7].flatMap((c, i) => [run(String(c), 10, 22 + 12 * i), run('20/1', 40, 22 + 12 * i), run('LIGHTS', 90, 22 + 12 * i), run('500', 220, 22 + 12 * i)])],
    { sheetKey: 'k', sheetLabel: 'E-9', viewportId: 'k@u1', title: 'PANEL LP' })!;
    expect(t.warnings.join(' ')).toMatch(/only the odd side was read — incomplete/);
    expect(isCompletePanel(t)).toBe(false);
    expect(circuitSummaryRows([t])).toEqual([]);
  });
});

describe('fix round S10 — schedule over-counts', () => {
  const eq = (tag: string, description: string) => ({ type: tag, key: tag, description, symbolHint: '', wattage: null, category: 'equipment' as const, source: 'equipment_schedule' as const, sourceSheet: 'E-4', headsPerPole: null, emergency: false });
  const withEven = (rows: string[][]) => (rows.some(r => Number(r[0].split(',')[0]) % 2 === 0) ? rows : [...rows, ['42', '-/1', 'SPACE', '0']]);
  const tbl = (title: string, rows: string[][], sheet = 'E-4') => parseScheduleReply(JSON.stringify({ title, columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], rows: withEven(rows).map(cells => ({ cells })) }),
    { sheetKey: sheet, sheetLabel: sheet, viewportId: `${sheet}@${title}`, viewportTitle: title })!;
  const batt = eq('BATT CHGR', 'Battery chargers');
  const five = [15, 17, 19, 21, 23].map(c => [String(c), '20/1', 'BATT CHGR (5)', '1490']);
  it('"(5)" repeated on each of five rows -> 5, not 25', () => {
    expect(scheduleCounts([batt], [tbl('PANEL B', five)]).get('BATT CHGR')!.qty).toBe(5);
  });
  it('a multi-pole load whose description repeats on each pole row -> one load', () => {
    const t = tbl('PANEL B', [['1', '60/3', 'RTU-1', '6124'], ['3', '60/3', 'RTU-1', '6124'], ['5', '60/3', 'RTU-1', '6124']]);
    expect(scheduleCounts([eq('RTU-1', 'Rooftop unit')], [t]).get('RTU-1')!.qty).toBe(1);
    expect(circuitSummaryRows([t]).map(r => r.row.qty)).toEqual([1]);
  });
  it('the same panel on two sheets -> once', () => {
    const rows = [15, 17, 19].map(c => [String(c), '20/1', 'BATTERY CHARGER', '1490']);
    expect(scheduleCounts([batt], [tbl('PANEL B', rows, 'E-4'), tbl('PANEL "B"', rows, 'E-4.1')]).get('BATT CHGR')!.qty).toBe(3);
  });
  it('panel names: PANEL SCHEDULE A, PANELBOARD LP-1, PANEL \'B\', A PANEL', () => {
    expect(['PANEL SCHEDULE A', 'PANELBOARD LP-1', "PANEL 'B'", 'PANEL A', 'MDP PANEL', 'PANEL: LP2'].map(panelNameOf)).toEqual(['A', 'LP-1', 'B', 'A', 'MDP', 'LP2']);
  });
  it('"1,3,5" in the circuit cell is a 3-pole load on circuit 1, never circuit 135', () => {
    const r = panelCircuitRows(tbl('PANEL B', [['1,3,5', '60/3', 'RTU-1', '18372'], ['7', '20/1', 'WH', '1500']]));
    expect(r.map(x => [x.circuit, x.poles]).slice(0, 2)).toEqual([[1, 3], [7, 1]]);
  });
  it('SPARE 20A / (SPARE) / -- are not loads', () => {
    const t = tbl('PANEL B', [['1', '20/1', 'SPARE 20A', ''], ['3', '20/1', '(SPARE)', ''], ['5', '20/1', '--', ''], ['7', '20/1', 'BATT CHGR', '1490'], ['2', '20/1', 'SPACE', ''], ['4', '20/1', 'WH', '1']]);
    expect(circuitSummaryRows([t])[0].row.qty).toBe(2);
    expect(isEmptyLoad('SPARE 20A')).toBe(true);
  });
});

describe('fix round S9 — Agent 1 circuit rows', () => {
  it('recognises "20A/1P breakers", "Dedicated circuits (20/1)", "60/3 RTU circuits"; not a single named breaker', () => {
    expect(isCircuitCountRow({ item: '20A/1P breakers' })).toBe(true);
    expect(isCircuitCountRow({ item: 'Dedicated circuits (20/1)' })).toBe(true);
    expect(isCircuitCountRow({ item: '60/3 RTU circuits 3#6,#10G,3/4"C' })).toBe(true);
    expect(isCircuitCountRow({ item: '20A high magnetic breaker B-20' })).toBe(false);
    expect(panelsNamedIn('20/1 branch circuits Panel A (non-lighting)')).toEqual(['A']);
    expect(panelsNamedIn('Branch circuits Panels A & B')).toEqual(['A', 'B']);
  });
});

describe('fix round 3 / B12 — two buildings\' "PANEL A" are two panels', () => {
  const wh = { type: 'WH', key: 'WH', description: 'Water heater', symbolHint: '', wattage: null, category: 'equipment' as const, source: 'equipment_schedule' as const, sourceSheet: 'P-1', headsPerPole: null, emergency: false };
  const pa = (sheetLabel: string, rows: string[][]) => parseScheduleReply(JSON.stringify({ title: 'PANEL A', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], rows: [...rows, ['42', '-/1', 'SPACE', '0']].map(cells => ({ cells })) }),
    { sheetKey: sheetLabel, sheetLabel, viewportId: `${sheetLabel}@A`, viewportTitle: 'PANEL A' })!;
  const b1 = (label: string) => pa(label, [['1', '20/1', 'WATER HEATER', '1500'], ['3', '20/1', 'LIGHTING', '900'], ['5', '20/1', 'LIGHTING', '800']]);
  const b2 = (label: string) => pa(label, [['1', '20/1', 'WATER HEATER', '1500'], ['3', '20/1', 'RECEPTACLES', '900'], ['5', '20/1', 'RECEPTACLES', '720'], ['7', '20/1', 'RECEPTACLES', '540']]);
  it('the reviewer\'s repro (no building names in the titles): water heaters 2, Panel A circuits 7, both flagged', () => {
    const tables = dedupePanels([b1('E-101 "POWER PLAN"'), b2('E-201 "POWER PLAN"')]);
    expect(tables).toHaveLength(2);
    expect(tables.every(t => t.warnings.some(w => w.includes(PANEL_CONFLICT)))).toBe(true);
    expect(scheduleCounts([wh], tables).get('WH')!.qty).toBe(2);
    expect(circuitSummaryRows(tables).reduce((s, r) => s + Number(r.row.qty), 0)).toBe(7);
    // A conflict never makes a panel "incomplete".
    expect(tables.every(isCompletePanel)).toBe(true);
  });
  it('titles naming the buildings: two identities, no conflict, lines per building', () => {
    const tables = dedupePanels([b1('E-101 "BUILDING 1 POWER PLAN"'), b2('E-201 "BUILDING 2 POWER PLAN"')]);
    expect(tables.map(panelIdentity)).toEqual(['A|BUILDING 1', 'A|BUILDING 2']);
    expect(tables.every(t => t.warnings.length === 0)).toBe(true);
    expect(circuitSummaryRows(tables).map(r => r.row.item)).toEqual(['Branch circuit 20/1 — Panel A (BUILDING 1)', 'Branch circuit 20/1 — Panel A (BUILDING 2)']);
  });
  it('the same panel with the same content on two sheets -> one; idempotent', () => {
    const once = dedupePanels([b1('E-101 "POWER PLAN"'), b1('E-4 "SCHEDULES"')]);
    expect(once).toHaveLength(1);
    expect(dedupePanels(dedupePanels([b1('E-101'), b2('E-201')]))[0].warnings).toHaveLength(1);
  });
});
