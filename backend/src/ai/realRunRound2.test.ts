// Round 2 review (5e2b496) — S13, S14, N6-N10 as tests (S15 is DB-backed:
// consistencyEndToEnd.test.ts).
import { describe, it, expect } from 'vitest';
import { scheduleCounts, circuitRefs, type ScheduleTable } from './evidence/schedules';
import { consolidateTargets } from './evidence/consolidate';
import { extraConfirmedMarks } from '../estimating/takeoffReview';
import { sheetIdCandidates, buildReviewItems, enforcedCounts } from './reviewItems';
import { mergeCountsIntoTakeoff, type SheetCountInput } from './countMerge';
import { buildCountTargets, type CountTarget } from './countTargets';
import { selectCountSheets } from './countSheets';
import type { CountResult } from './countingStage';

const t = (type: string, description: string): CountTarget => ({ type, key: type, description, symbolHint: '', wattage: null, category: 'equipment', source: 'equipment_schedule', sourceSheet: 'E-1', headsPerPole: null, emergency: false });
const panelA = (rows: string[][]): ScheduleTable[] => [{ id: 'pa', sheetKey: 's', sheetLabel: 'E-4', viewportId: null, title: 'PANEL A', kind: 'panel', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], warnings: [], source: 'vision',
  rows: rows.map((cells, rowIdx) => ({ rowIdx, cells })) }];

describe('S13 — schedule rows use the distinct-load rules', () => {
  it('"INSTANT WATER HEATER" (A-29) is IWH, not WH: IWH + WH -> 2, each owned by its own row (never counted again from the plans)', () => {
    const cons = consolidateTargets([t('WH', 'Water heater, ckt A-27'), t('IWH', 'Instantaneous water heater at hand sink')], { panels: ['A'] });
    expect(cons.merges).toEqual([]);
    const sc = scheduleCounts(cons.targets, panelA([['27', '20/1', 'WATER HEATER', '1500'], ['29', '20/1', 'INSTANT WATER HEATER', '3000'], ['1', '20/1', 'LTG', '1'], ['2', '20/1', 'LTG', '1'], ['3', '20/1', 'LTG', '1']]));
    expect([sc.get('WH')?.qty, sc.get('IWH')?.qty]).toEqual([1, 1]);
    expect(sc.get('WH')!.rows.map(r => r.cells[0])).toEqual(['27']);
  });
  it('a row naming words neither target has goes to nobody (the counter keeps them), never the looser one', () => {
    const sc = scheduleCounts([t('WH', 'Water heater')], panelA([['29', '20/1', 'WATER HEATER CIRC PUMP', '200'], ['1', '20/1', 'LTG', '1'], ['2', '20/1', 'LTG', '1'], ['3', '20/1', 'LTG', '1']]));
    expect(sc.has('WH')).toBe(false);
  });
});

describe('S14 / N8 — the class-conflict question can say "two receptacles"', () => {
  const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], loadCheck: null, removedRows: [], flags: [], marks: [],
    types: [{ key: 'DUP', type: 'Duplex', description: '', category: 'device', count: 14, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null },
      { key: 'SIM', type: 'simplex', description: '', category: 'device', count: 8, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null }],
    evidence: { tables: [], expansions: [], families: [], typicals: [], classConflicts: [
      { circuit: 'B30', kept: { sheetLabel: 'E-1', typeKey: 'DUP' }, dropped: { sheetLabel: 'E-2', typeKey: 'SIM' } },
      { circuit: 'B32', kept: { sheetLabel: 'E-1', typeKey: 'DUP' }, dropped: { sheetLabel: 'E-2', typeKey: 'SIM' } },
    ] } } as unknown as CountResult;
  const items = buildReviewItems(cr).filter(i => i.id.startsWith('classconflict:'));
  it('three answers; "count both" restores the dropped receptacle (14 + 9)', () => {
    const q = items[0];
    expect(q.options).toEqual(['Duplex (as counted)', 'simplex', 'Two different receptacles — count both']);
    const e = enforcedCounts(cr, [{ ...q, resolution: { action: 'answer', answer: q.options![2], by: 'x', at: 'y' } }]);
    expect([e.byType.get('DUP'), e.byType.get('SIM')]).toEqual([14, 9]);
    const relabel = enforcedCounts(cr, [{ ...q, resolution: { action: 'answer', answer: q.options![1], by: 'x', at: 'y' } }]);
    expect([relabel.byType.get('DUP'), relabel.byType.get('SIM')]).toEqual([13, 9]);
  });
  it('N8 — two conflicts between the same sheets have different fingerprints (the circuit)', () => {
    expect(new Set(items.map(i => i.fingerprint)).size).toBe(2);
  });
});

describe('S15 — confirmed consistency markers the current first pass already counts are not added again (pure)', () => {
  it('3 confirmed, 2 of them now in the first pass -> 1 extra', () => {
    const current = Array.from({ length: 72 }, (_, i) => ({ sheetKey: 's', x: 50 + (i % 10) * 60, y: 50 + Math.floor(i / 10) * 45 }));
    current[70] = { sheetKey: 's', x: 52, y: 501 }; current[71] = { sheetKey: 's', x: 109, y: 499 };
    const conf = [{ x: 50, y: 500 }, { x: 110, y: 500 }, { x: 170, y: 500 }].map(point => ({ sheetKey: 's', point }));
    expect(extraConfirmedMarks(conf, current).map(c => c.point!.x)).toEqual([170]);
  });
});

describe('N9 — circuits and sheet ranges', () => {
  it('"A-2, 4-#12" is A-2 only', () => {
    expect(circuitRefs('ckt A-2, 4-#12, 3/4"C')).toEqual([{ panel: 'A', circuit: 2 }]);
  });
  it('"E-8 thru E-10" names E-9 too', () => {
    expect(sheetIdCandidates('See E-8 thru E-10').map(c => c.id)).toEqual(['E-8', 'E-9', 'E-10']);
    expect(sheetIdCandidates('E-8 through E-11').map(c => c.id)).toEqual(['E-8', 'E-9', 'E-10', 'E-11']);
  });
});

describe('N10 — the pole-spec rule is only for area / site light poles', () => {
  const site = selectCountSheets([{ file: 'set.pdf', page: 1, sheetNo: 'E-7', title: 'SITE LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true }]).counted[0];
  const run = (item: string) => {
    const a1 = { fixtureSchedule: [
      { type: 'S1', description: 'Lithonia DSX1 LED, full cutoff, 28 ft MH', location: 'site', wattage: 207, headsPerPole: 1 },
      { type: 'S2', description: 'Lithonia DSX1 LED twin head, 28 ft MH', location: 'site', wattage: 414, headsPerPole: 2 },
    ], quantities: [{ category: 'Exterior Site Lighting', item, qty: 3, unit: 'EA', sourceSheet: 'PH0.1' }] };
    const sheets: SheetCountInput[] = [{ sheet: site, status: 'counted', placed: [{ typeKey: 'S1' }, { typeKey: 'S1' }, { typeKey: 'S2' }], unreadable: [] }];
    return mergeCountsIntoTakeoff(a1, buildCountTargets(a1).targets, sheets, { countingRan: true, evidence: {} }).removedRows[0];
  };
  it('a 12\' pedestrian bollard light pole, or a 12\' light pole under 28\' fixtures, is never "the site light poles"', () => {
    expect(run("12' pedestrian bollard light pole").unscheduled).toBe(true);
    expect(run("12' square steel light pole").unscheduled).toBe(true);
    expect(run("25' 5in square steel pole, dark bronze, 3' conc base").unscheduled).toBeUndefined();
  });
});
