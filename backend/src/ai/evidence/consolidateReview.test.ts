// Review fixes B2, B3, N4, S2-S7 — each repro from the review of the real-run
// fix round (docs/superpowers/plans/2026-09-24-real-run-fixes-review.md) as a test.
import { describe, it, expect } from 'vitest';
import { consolidateTargets, resolveUncertainSynonyms } from './consolidate';
import { tagInfoOf } from './tags';
import { circuitRefs, scheduleCounts, type ScheduleTable } from './schedules';
import type { CountTarget } from '../countTargets';
import { buildReviewItems, enforcedCounts } from '../reviewItems';
import type { CountResult } from '../countingStage';

const t = (type: string, description: string, source: CountTarget['source'] = 'equipment_schedule', category: CountTarget['category'] = 'equipment'): CountTarget =>
  ({ type, key: type.toUpperCase(), description, symbolHint: '', wattage: null, category, source, sourceSheet: 'E-1', headsPerPole: null, emergency: false });
const P = { panels: ['A', 'B'] };
const mergedKeys = (ts: CountTarget[]) => consolidateTargets(ts, P).merges.map(m => `${m.key}->${m.into.join('+')}`);

describe('B2 — no transitive linking through a generic name', () => {
  it('FRONT / SIDE wall sign and a "Wall sign" legend (no circuits): the 3 signs stay 3; the generic is asked about, never a bridge', () => {
    const c = consolidateTargets([t('FRONT WALL SIGN', 'Front wall sign'), t('SIDE WALL SIGN', 'Side wall sign'), t('SIGN', 'Wall sign', 'legend')], P);
    expect(c.merges).toEqual([]);
    expect(c.uncertain.map(u => [u.key, u.candidates.sort()])).toEqual([['SIGN', ['FRONT WALL SIGN', 'SIDE WALL SIGN']]]);
    // Neither sign's schedule row is lost to the generic.
    const tables: ScheduleTable[] = [{ id: 'pa', sheetKey: 's', sheetLabel: 'E-4', viewportId: null, title: 'PANEL A', kind: 'panel', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], warnings: [],
      rows: [{ rowIdx: 0, cells: ['6', '20/1', 'FRONT WALL SIGN', '1220'] }, { rowIdx: 1, cells: ['14', '20/1', 'SIDE WALL SIGN', '1220'] }, { rowIdx: 2, cells: ['1', '20/1', 'LTG', '1'] }, { rowIdx: 3, cells: ['2', '20/1', 'LTG', '1'] }, { rowIdx: 4, cells: ['3', '20/1', 'LTG', '1'] }], source: 'vision' }];
    const sc = scheduleCounts(c.targets, tables);
    expect([sc.get('FRONT WALL SIGN')?.qty, sc.get('SIDE WALL SIGN')?.qty, sc.has('SIGN')]).toEqual([1, 1, false]);
  });

  it('a kitchen exhaust fan never folds into EF through an "Exhaust fan" legend', () => {
    const c = consolidateTargets([t('EF', 'Exhaust fan'), t('KEF', 'Kitchen exhaust fan'), t('Exhaust fan', 'Exhaust fan recessed', 'legend')], P);
    expect(c.merges.map(m => m.key)).not.toContain('KEF');
    expect(c.uncertain.map(u => u.key)).toEqual(['EXHAUST FAN']);
  });
});

describe('B3 — letter-suffixed siblings are distinct tags', () => {
  it('EF-A / EF-B with identical descriptions -> 2 fans, never 1', () => {
    const c = consolidateTargets([t('EF-A', 'Exhaust fan, roof'), t('EF-B', 'Exhaust fan, roof')], P);
    expect(c.merges).toEqual([]);
    for (const tag of ['EF-A', 'WH-A', 'DISCON-A', 'EF A', 'P-1A']) expect(tagInfoOf(tag).num, tag).not.toBeNull();
    expect(mergedKeys([t('WH-A', 'Water heater'), t('WH-B', 'Water heater'), t('DISCON-A', 'Disconnect'), t('DISCON-B', 'Disconnect')])).toEqual([]);
  });
});

describe('N4 — a class name that only abbreviates to a numbered family never folds it blind', () => {
  it('"DISCONNECT, NEMA 3R" vs DS-1 / DS-2: counted and decided by its marks, never folded', () => {
    const c = consolidateTargets([t('DS-1', 'Disconnect 60A'), t('DS-2', 'Disconnect 30A'), t('DISCONNECT SWITCH', 'Disconnect switch, NEMA 3R')], P);
    expect(c.merges).toEqual([]);
    // The exact base still folds (RTU vs RTU-1 / RTU-2).
    expect(mergedKeys([t('RTU-1', 'Rooftop unit'), t('RTU-2', 'Rooftop unit'), t('RTU', 'Rooftop units by others')])).toEqual(['RTU->RTU-1+RTU-2']);
  });
});

describe('S2 / S3 — combined tags', () => {
  const panelB = (rows: string[][]): ScheduleTable[] => [{ id: 'pb', sheetKey: 's', sheetLabel: 'E-4', viewportId: null, title: 'PANEL B', kind: 'panel', columns: ['CKT', 'BREAKER', 'DESCRIPTION', 'A'], warnings: [], source: 'vision',
    rows: rows.map((cells, rowIdx) => ({ rowIdx, cells })) }];
  it('S2 — "RTU-1/RTU-2" citing B-1,3,5 / B-2,4,6 with no "(2)" counts 2, one per member', () => {
    const c = consolidateTargets([t('RTU-1/RTU-2', 'Rooftop units, ckts B-1,3,5 and B-2,4,6')], P);
    const sc = scheduleCounts(c.targets, panelB([['1', '60/3', 'ROOFTOP', '6124'], ['3', '|', '', ''], ['5', '|', '', ''], ['2', '60/3', 'ROOFTOP', '6124'], ['4', '|', '', ''], ['6', '|', '', '']]));
    expect(sc.get('RTU-1/RTU-2')?.qty).toBe(2);
  });
  it('S3 — only RTU-1 listed: the combined tag is merged into RTU-1 + a created RTU-2 (never stacked on RTU-1)', () => {
    const c = consolidateTargets([t('RTU-1', 'Rooftop unit, ckts B-1,3,5'), t('RTU-1/RTU-2', '(2) rooftop units')], P);
    expect(c.merges.map(m => [m.key, m.into])).toEqual([['RTU-1/RTU-2', ['RTU-1', 'RTU-2']]]);
    expect(c.targets.find(x => x.key === 'RTU-2')!.description).toBe('RTU-2: listed with RTU-1/RTU-2 — rooftop units');
  });
  it('S3 — "RTU-1/2/3" is 3 members (a missing one is created, so it is counted or asked about); a "(2)" beside 3 members is a question', () => {
    expect(tagInfoOf('RTU-1/2/3').members).toEqual(['RTU-1', 'RTU-2', 'RTU-3']);
    expect(tagInfoOf('RTU-1 & 2').members).toEqual(['RTU-1', 'RTU-2']);
    const c = consolidateTargets([t('RTU-1', 'Rooftop unit'), t('RTU-2', 'Rooftop unit'), t('RTU-1/2/3', '(2) rooftop units')], P);
    expect(c.merges.map(m => [m.key, m.into])).toEqual([['RTU-1/2/3', ['RTU-1', 'RTU-2', 'RTU-3']]]);
    expect(c.targets.some(x => x.key === 'RTU-3')).toBe(true);
    expect(c.questions).toEqual([{ key: 'RTU-1/2/3', type: 'RTU-1/2/3', reason: '"RTU-1/2/3" names 3 (RTU-1, RTU-2, RTU-3) but its description says (2)' }]);
  });
});

describe('S4 — different loads never fold on a shared word or a shared circuit', () => {
  it('circulating pump / instantaneous water heater are not the water heater; a hood interlock is not the exhaust fan', () => {
    expect(mergedKeys([t('WH', 'Water heater'), t('CP', 'Water heater circulating pump'), t('IWH', 'Instantaneous water heater')])).toEqual([]);
    expect(mergedKeys([t('EF', 'Exhaust fan'), t('HOOD', 'Kitchen hood exhaust fan interlock')])).toEqual([]);
    // … while the electric water heater IS the water heater.
    expect(mergedKeys([t('WH', 'Water heater, ckt A-27'), t('EWH', 'Electric water heater - connection by EC')])).toEqual(['EWH->WH']);
  });
  it('an ice machine on the drink machine\'s circuit, a contactor FOR the pylon sign, a time clock that CONTROLS the signs: all separate', () => {
    expect(mergedKeys([t('DRINK MACHINE', 'Drink machine, ckt A-6'), t('ICE MACHINE', 'Ice machine, ckt A-6')])).toEqual([]);
    expect(mergedKeys([t('PYLON SIGN', 'Pylon sign, ckt A-18'), t('LC', 'Lighting contactor for pylon sign circuit A-18')])).toEqual([]);
    expect(mergedKeys([t('FRONT WALL SIGN', 'Front wall sign, ckt A-6'), t('SIDE WALL SIGN', 'Side wall sign, ckt A-14'), t('TC', 'TC time clock, controls sign circuits A-6, A-14')])).toEqual([]);
  });
});

describe('S5 — circuits only in circuit context', () => {
  it('"A-6, 180 VA" is A-6; "A-1, 3 phase" is A-1; "A-12, 3 fixtures" is A-12; nothing over 84', () => {
    expect(circuitRefs('ckt A-6, 180 VA')).toEqual([{ panel: 'A', circuit: 6 }]);
    expect(circuitRefs('A-1, 3 phase')).toEqual([{ panel: 'A', circuit: 1 }]);
    expect(circuitRefs('circuit A-12, 3 fixtures')).toEqual([{ panel: 'A', circuit: 12 }]);
    expect(circuitRefs('ckts A-14,16 wall mounted')).toEqual([{ panel: 'A', circuit: 14 }, { panel: 'A', circuit: 16 }]);
    expect(circuitRefs('LP-120')).toEqual([]);
  });
  it('T-1, SP-1, CU-1, P-4 are never circuits without the drawing\'s panel list naming them', () => {
    expect(mergedKeys([t('T1', 'Thermostat, see T-1'), t('SP', 'Sump pump SP-1, see T-1')])).toEqual([]);
    const c = consolidateTargets([t('X', 'Unit on P-4'), t('Y', 'Other unit on P-4')]); // no panel list at all
    expect(c.merges).toEqual([]);
  });
});

describe('S6 / S7 — a generic symbol\'s question and the "same device" answer', () => {
  const types = (pCount: number) => [
    { key: 'P', type: 'P', description: 'Power poles', category: 'device', status: 'counted', count: pCount, heads: null, sheets: [], flags: [] as string[], reason: '', wattage: null },
    { key: 'PP#1', type: 'PP#1', description: 'pole', category: 'equipment', status: 'counted', count: 1, heads: null, sheets: [], flags: [] as string[], reason: '', wattage: null },
  ];
  it('S6 — P drawn 6 times while PP#n are counted from the schedule rows (no marks to compare): a question, never 6 more poles stacked', () => {
    const ts = types(6);
    resolveUncertainSynonyms(ts, [{ key: 'P', type: 'P', candidates: ['PP#1'], basis: 'x' }], [{ sheetKey: 's', typeKey: 'P', x: 1, y: 1 }], undefined, { scheduleOwned: new Set(['PP#1']) });
    expect((ts[0] as { synonymQuestion?: unknown }).synonymQuestion).toMatchObject({ coincident: 6, count: 6 });
    const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types: ts, loadCheck: null, removedRows: [], flags: [], marks: [], evidence: { tables: [], expansions: [], families: [], typicals: [] } } as unknown as CountResult;
    const q = buildReviewItems(cr).find(i => i.id === 'synonym:P')!;
    expect(q.options).toEqual(['Different devices — keep 6', 'The same device — drop P']);
    expect(enforcedCounts(cr, [{ ...q, resolution: { action: 'answer', answer: q.options![1], qty: q.sumQty, by: 'x', at: 'y' } }]).byType.get('P')).toBeNull();
  });
  it('S6 — none drawn: folded as information into those types, never counted separately', () => {
    const ts = types(0);
    ts[0].status = 'zero';
    resolveUncertainSynonyms(ts, [{ key: 'P', type: 'P', candidates: ['PP#1'], basis: 'x' }], [], undefined, { scheduleOwned: new Set(['PP#1']) });
    expect(ts[0].status).toBe('merged');
  });
});
