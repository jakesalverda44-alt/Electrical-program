// Fix round 1 / B1 — the counted and estimator-resolved quantities reach the
// GC takeoff deterministically, whatever Agent 4 wrote.
import { describe, expect, it } from 'vitest';
import { enforceCountsOnTakeoff, countMismatchProblems, lineCountKey } from './enforceCounts';
import { mergeCountsIntoTakeoff } from '../ai/countMerge';
import { buildCountTargets } from '../ai/countTargets';
import { selectCountSheets } from '../ai/countSheets';
import { enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';
import type { TakeoffCategory } from './bidData';

const A1 = {
  fixtureSchedule: [
    { type: 'A', description: '4 ft LED linear', location: 'interior', wattage: 32 },
    { type: 'B', description: '8 ft LED linear', location: 'interior', wattage: 64 },
    { type: 'S1', description: 'LED area light, 25 ft pole', location: 'site', wattage: 150, headsPerPole: 2 },
  ],
};
const marks = (counts: Record<string, number>) => Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));

function kissimmeeCountResult(): CountResult {
  const { targets } = buildCountTargets(A1);
  const [site, light] = selectCountSheets([
    { file: 'set.pdf', page: 1, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical', cls: 'plan', included: true },
    { file: 'set.pdf', page: 2, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical', cls: 'plan', included: true },
  ]).counted;
  const m = mergeCountsIntoTakeoff(A1, targets, [
    { sheet: site, status: 'counted', placed: marks({ S1: 2 }), unreadable: [] },
    { sheet: light, status: 'counted', placed: marks({ A: 73, B: 52 }), unreadable: [] },
  ], { countingRan: true });
  return { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: m.types,
    loadCheck: m.loadCheck, removedRows: m.removedRows, flags: m.flags, marks: [], noScheduleOrLegend: false };
}

describe('enforceCountsOnTakeoff (B1)', () => {
  const cr = kissimmeeCountResult();

  it('the review scenario: Agent 4 drops A and writes B = 37 -> A 73 / B 52, every change recorded', () => {
    const takeoff: TakeoffCategory[] = [
      { name: 'Interior Lighting', items: [{ item: 'Type B', description: '8 ft LED linear', unit: 'EA', qty: 37, source: 'E-3' }] },
    ];
    const set = enforcedCounts(cr, []);
    expect(countMismatchProblems(takeoff, cr, set)).toEqual([
      'Type A must be one takeoff line of 73 (counted/resolved); the takeoff has no line.',
      'Type B must be one takeoff line of 52 (counted/resolved); the takeoff has 37.',
      'Type S1 must be one takeoff line of 2 (counted/resolved); the takeoff has no line.',
      'Type S1 heads must be one takeoff line of 4 (counted/resolved); the takeoff has no line.',
    ]);
    const r = enforceCountsOnTakeoff(takeoff, cr, set);
    const rows = r.takeoff.flatMap(c => c.items.map(i => [c.name, i.item, i.qty, i.source]));
    expect(rows).toEqual([
      ['Interior Lighting', 'Type B', 52, 'E-3'],
      ['Interior Lighting', 'Type A — 4 ft LED linear', 73, 'E-3'],
      ['Exterior / Site Lighting', 'Type S1 — pole (LED area light, 25 ft pole)', 2, 'E-1'],
      ['Exterior / Site Lighting', 'Type S1 — fixture heads (2 per pole)', 4, 'E-1'],
    ]);
    expect(r.corrections).toEqual([
      'Type A was missing from the takeoff — added to Interior Lighting with the counted quantity 73.',
      'Type B: Interior Lighting "Type B — 8 ft LED linear" said 37 — set to the counted quantity 52.',
      'Type S1 was missing from the takeoff — added to Exterior / Site Lighting with the counted quantity 2.',
      'Type S1 heads was missing from the takeoff — added to Exterior / Site Lighting with the counted quantity 4.',
    ]);
    expect(countMismatchProblems(r.takeoff, cr, set)).toEqual([]);
  });

  it('A folded into B as one "LED linear fixtures (A/B) 125" line is split back out: the extra line is removed', () => {
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [
      { item: 'Type A', description: '4 ft LED linear', unit: 'EA', qty: 73, source: 'E-3', count_type: 'A' },
      { item: 'Fixture (A)', description: 'LED linear, restrooms', unit: 'EA', qty: 6, source: 'E-3.1' },
      { item: 'Type B', description: '8 ft', unit: 'EA', qty: 52, source: 'E-3' },
    ] }];
    const r = enforceCountsOnTakeoff(takeoff, cr, enforcedCounts(cr, []));
    expect(r.takeoff[0].items.map(i => [i.item, i.qty])).toEqual([['Type A', 73], ['Type B', 52]]);
    expect(r.corrections[0]).toMatch(/Type A is one line — removed the extra Interior Lighting "Fixture \(A\) — LED linear, restrooms" \(6\)/);
  });

  it('estimator resolutions win over the AI count; "not on this job" removes the line', () => {
    const items: ReviewItem[] = [
      { id: 'coverage:A', kind: 'count', title: 'A', detail: '', resolution: { action: 'count', qty: 80, by: 'J', at: 't' } },
      { id: 'count:B', kind: 'count', title: 'B', detail: '', resolution: { action: 'not_on_job', reason: 'Alternate, not bid', by: 'J', at: 't' } },
    ];
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [
      { item: 'Type A', description: '', unit: 'EA', qty: 73, source: 'E-3' },
      { item: 'Type B', description: '', unit: 'EA', qty: 52, source: 'E-3' },
    ] }];
    const set = enforcedCounts(cr, items);
    const r = enforceCountsOnTakeoff(takeoff, cr, set);
    expect(r.takeoff[0].items.map(i => [i.item, i.qty])).toEqual([['Type A', 80]]);
    expect(countMismatchProblems(r.takeoff, cr, set)).toEqual([]);
  });

  it('count_type wins over the text; heads lines map to <KEY>:heads', () => {
    const targets = cr.targets;
    expect(lineCountKey('Interior Lighting', { item: '4ft linear', description: '', count_type: 'B' }, targets)).toBe('B');
    expect(lineCountKey('Exterior / Site Lighting', { item: 'S1 fixture heads', description: '' }, targets)).toBe('S1:heads');
    expect(lineCountKey('Service & Distribution', { item: 'Type A panel', description: '' }, targets)).toBeNull();
  });

  it('a bid from before counting (no count_result) is untouched', () => {
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [{ item: 'Type A', description: '', unit: 'EA', qty: 5, source: '' }] }];
    const r = enforceCountsOnTakeoff(takeoff, null, enforcedCounts(null, []));
    expect(r.takeoff).toEqual(takeoff);
    expect(r.corrections).toEqual([]);
  });
});
