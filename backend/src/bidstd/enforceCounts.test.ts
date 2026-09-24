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

  it('R2-B2 — a free-text mention of a tag never makes a line "the" counted line; a second identified line is never deleted', () => {
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [
      { item: 'Type A', description: '4 ft LED linear', unit: 'EA', qty: 73, source: 'E-3', count_type: 'A' },
      { item: 'Fixture (A)', description: 'LED linear, restrooms', unit: 'EA', qty: 6, source: 'E-3.1' },
      { item: 'Type B', description: '8 ft', unit: 'EA', qty: 52, source: 'E-3' },
    ] }];
    const r = enforceCountsOnTakeoff(takeoff, cr, enforcedCounts(cr, []));
    // "Fixture (A)" is not identified as type A — it is left alone (and the
    // hygiene warning about possible stacking is the estimator's cue).
    expect(r.takeoff[0].items.map(i => [i.item, i.qty])).toEqual([['Type A', 73], ['Fixture (A)', 6], ['Type B', 52]]);
    expect(r.ambiguous).toEqual([]);
    // ...but it IS raised as a possible double count of A (pre-merge follow-up).
    expect(r.possibleDoubles.map(d => [d.type, d.line])).toEqual([['A', 'Fixture (A) LED linear, restrooms']]);
  });
  it('two lines that both carry type A\'s identity: ambiguous — nothing changed, the estimator picks', () => {
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [
      { item: 'Type A', description: '4 ft LED linear, sales', unit: 'EA', qty: 60, source: 'E-3' },
      { item: 'Type A', description: '4 ft LED linear, back room', unit: 'EA', qty: 13, source: 'E-3' },
      { item: 'Type B', description: '8 ft', unit: 'EA', qty: 52, source: 'E-3' },
    ] }];
    const r = enforceCountsOnTakeoff(takeoff, cr, enforcedCounts(cr, []));
    expect(r.takeoff[0].items.map(i => i.qty)).toEqual([60, 13, 52]);
    expect(r.ambiguous.map(a => [a.name, a.lines.length])).toEqual([['Type A', 2]]);
    // The estimator marks the first as THE Type A line.
    const picked = (key: string, _c: string, line: string) => key === 'A' && line.includes('sales');
    const r2 = enforceCountsOnTakeoff(takeoff, cr, enforcedCounts(cr, []), picked);
    expect(r2.takeoff[0].items.map(i => i.qty)).toEqual([73, 13, 52]);
    expect(r2.ambiguous).toEqual([]);
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
    expect(lineCountKey('Exterior / Site Lighting', { item: 'S1 — fixture heads', description: '' }, targets)).toBe('S1:heads');
    expect(lineCountKey('Exterior / Site Lighting', { item: 'S1 fixture heads', description: '' }, targets)).toBeNull(); // free text, not the type field
    expect(lineCountKey('Service & Distribution', { item: 'Type A panel', description: '' }, targets)).toBeNull();
  });

  it('a bid from before counting (no count_result) is untouched', () => {
    const takeoff: TakeoffCategory[] = [{ name: 'Interior Lighting', items: [{ item: 'Type A', description: '', unit: 'EA', qty: 5, source: '' }] }];
    const r = enforceCountsOnTakeoff(takeoff, null, enforcedCounts(null, []));
    expect(r.takeoff).toEqual(takeoff);
    expect(r.corrections).toEqual([]);
  });
});

// Fix round 2 / R2-B2 — the reviewer's four repros (real mergeCountsIntoTakeoff,
// enforcedCounts, enforceCountsOnTakeoff): lines that go WITH a counted item
// (its feeder, disconnect, base, junction box, a same-label panel) are never
// touched.
describe('R2-B2 — count enforcement never touches lines that merely mention a counted tag', () => {
  const marks2 = (counts: Record<string, number>) => Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));
  function crFor(a1: Record<string, unknown>, placed: Record<string, number>, sheetTitle = 'POWER PLAN'): CountResult {
    const { targets } = buildCountTargets(a1);
    const [s] = selectCountSheets([{ file: 'set.pdf', page: 1, sheetNo: 'E-2', title: sheetTitle, discipline: 'electrical', cls: 'plan', included: true }]).counted;
    const m = mergeCountsIntoTakeoff(a1, targets, [{ sheet: s, status: 'counted', placed: marks2(placed), unreadable: [] }], { countingRan: true });
    return { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [], skippedSheets: [], types: m.types,
      loadCheck: m.loadCheck, removedRows: m.removedRows, flags: m.flags, marks: [], noScheduleOrLegend: false };
  }
  const rows = (t: TakeoffCategory[]) => t.flatMap(c => c.items.map(i => [c.name, i.item, i.unit, i.qty]));

  it('RTU-1: the disconnect, the connection and the 80 LF feeder all survive; the connection line is the counted one', () => {
    const cr1 = crFor({ equipment: [{ tag: 'RTU-1', description: 'Rooftop unit, 10 ton' }] }, { 'RTU-1': 1 });
    const takeoff: TakeoffCategory[] = [
      { name: 'Service & Distribution', items: [{ item: '60A/3P NF disconnect for RTU-1', description: 'NEMA 3R', unit: 'EA', qty: 1, source: 'E-4' }] },
      { name: 'Branch Power', items: [
        { item: 'RTU-1 — Rooftop unit, 10 ton (connection)', description: '', unit: 'EA', qty: 1, source: 'E-2', count_type: 'RTU-1' },
        { item: 'Feeder to RTU-1', description: '3#6 #10G 1" EMT', unit: 'LF', qty: 80, source: 'E-4' },
      ] },
    ];
    const r = enforceCountsOnTakeoff(takeoff, cr1, enforcedCounts(cr1, []));
    expect(rows(r.takeoff)).toEqual(rows(takeoff));
    expect(r.corrections).toEqual([]);
    expect(countMismatchProblems(r.takeoff, cr1, enforcedCounts(cr1, []))).toEqual([]);
  });

  it('Panel P1 vs pump P1: the panel and its 60 LF feeder are untouched; the pump connection is the counted line', () => {
    const cr1 = crFor({ equipment: [{ tag: 'P1', description: 'Circulating pump' }] }, { P1: 1 });
    const takeoff: TakeoffCategory[] = [
      { name: 'Service & Distribution', items: [
        { item: 'Panel P1', description: '225A MLO panelboard', unit: 'EA', qty: 1, source: 'E-4' },
        { item: 'Feeder to panel P1', description: '4#3/0', unit: 'LF', qty: 60, source: 'E-4' },
      ] },
      { name: 'Branch Power', items: [{ item: 'P1 — Circulating pump (connection)', description: '', unit: 'EA', qty: 1, source: 'E-2' }] },
    ];
    const r = enforceCountsOnTakeoff(takeoff, cr1, enforcedCounts(cr1, []));
    expect(rows(r.takeoff)).toEqual(rows(takeoff));
    expect(r.takeoff[0].items[0].count_type).toBeUndefined();
  });

  it('the S1 pole base is not an S1 line', () => {
    const r = enforceCountsOnTakeoff([
      { name: 'Exterior / Site Lighting', items: [
        { item: 'Type S1 — pole (LED area light, 25 ft pole)', description: '', unit: 'EA', qty: 2, source: 'E-1', count_type: 'S1' },
        { item: 'Type S1 — fixture heads (2 per pole)', description: '', unit: 'EA', qty: 4, source: 'E-1', count_type: 'S1' },
        { item: 'Concrete pole base for S1', description: '24" dia, 6 ft', unit: 'EA', qty: 2, source: 'E-1' },
      ] },
    ], kissimmeeCountResult(), enforcedCounts(kissimmeeCountResult(), []));
    expect(r.takeoff[0].items.map(i => i.item)).toContain('Concrete pole base for S1');
    expect(r.ambiguous).toEqual([]);
  });

  it('legend J "Junction box": the second junction-box line (for the RTU disconnect) survives', () => {
    const cr1 = crFor({ symbolLegend: [{ symbol: 'J', description: 'Junction box', kind: 'device' }] }, { J: 6 });
    const takeoff: TakeoffCategory[] = [{ name: 'Branch Power', items: [
      { item: 'Junction box', description: '4" square', unit: 'EA', qty: 6, source: 'E-2' },
      { item: 'Junction box for RTU disconnect', description: '', unit: 'EA', qty: 2, source: 'E-4' },
    ] }];
    const r = enforceCountsOnTakeoff(takeoff, cr1, enforcedCounts(cr1, []));
    expect(rows(r.takeoff)).toEqual(rows(takeoff));
  });

  it('S-R2-7 — an estimator-counted unscheduled "Wall pack" never overwrites counted D: it is raised instead', () => {
    const a1 = { fixtureSchedule: [{ type: 'D', description: 'Wall pack', location: 'exterior_building', wattage: 40 }] };
    const cr1 = crFor(a1, { D: 5 }, 'LIGHTING PLAN');
    const items: ReviewItem[] = [{ id: 'unscheduled:WALL-PACK', kind: 'count', title: 'Unscheduled fixture: Wall pack', detail: '', rowItem: 'Wall pack', category: 'Exterior / Site Lighting', resolution: { action: 'count', qty: 3, by: 'J', at: 't' } }];
    const takeoff: TakeoffCategory[] = [{ name: 'Exterior / Site Lighting', items: [{ item: 'Wall pack', description: '', unit: 'EA', qty: 5, source: 'E-3', count_type: 'D' }] }];
    const set = enforcedCounts(cr1, items);
    const r = enforceCountsOnTakeoff(takeoff, cr1, set);
    expect(r.takeoff[0].items[0].qty).toBe(5);
    expect(r.conflicts[0]).toMatch(/"Wall pack" \(unscheduled, counted by the estimator at 3\) is the same line as a counted type/);
  });
});

// Fix round 2 / N-R2-3 — Section C always ends at exactly 3 bullets.
import { fitSectionC } from './composeProposal';
describe('N-R2-3 — Section C = 3, deterministically', () => {
  const data = (bullets: string[]) => ({ sections: [{ title: 'C. Lighting & Controls', bullets }] }) as unknown as import('./bidData').BidData;
  it('Agent 4 wrote 3 control/testing bullets + the code-built fixture-types bullet -> 3', () => {
    const d = data(['Lighting fixtures furnished by the Owner.', 'Controls per E-5.', 'Photocell on the roof.', 'Fixture types per schedule: A, B.']);
    fitSectionC(d);
    expect(d.sections[0].bullets).toEqual(['Lighting fixtures furnished by the Owner.', 'Controls per E-5; Photocell on the roof.', 'Fixture types per schedule: A, B.']);
  });
  it('too few -> the standard controls bullet fills the gap', () => {
    const d = data(['Lighting fixtures furnished by the Owner.', 'Fixture types per schedule: A.']);
    fitSectionC(d);
    expect(d.sections[0].bullets).toHaveLength(3);
    expect(d.sections[0].bullets[1]).toMatch(/controls and functional testing/);
  });
  it('5 bullets, no fixture types -> 3', () => {
    const d = data(['L.', 'a.', 'b.', 'c.', 'd.']);
    fitSectionC(d);
    expect(d.sections[0].bullets).toEqual(['L.', 'a; b; c.', 'd.']);
  });
});

// Pre-merge follow-up — an untagged EA line that plausibly IS a counted type
// is a blocking "possible double count", resolved only by the estimator.
import { plausiblySameFixture } from './enforceCounts';
describe('possible double counts (blocking, never auto-deleted)', () => {
  const cr2 = kissimmeeCountResult(); // A 73 (4 ft LED linear), B 52 (8 ft LED linear), S1 2 poles / 4 heads
  const takeoff = (): TakeoffCategory[] => [{ name: 'Interior Lighting', items: [
    { item: 'Type A', description: '4 ft LED linear', unit: 'EA', qty: 73, source: 'E-3', count_type: 'A' },
    { item: 'Type B', description: '8 ft LED linear', unit: 'EA', qty: 52, source: 'E-3', count_type: 'B' },
    { item: "4' LED strip", description: 'restrooms and stock room', unit: 'EA', qty: 12, source: 'E-3' },
    { item: 'Ceiling fan', description: 'Hunter, owner-furnished', unit: 'EA', qty: 3, source: 'E-1' },
  ] }];

  it('a free-text duplicate of Type A ("4\' LED strip") raises the item; the ceiling fan does not; nothing is deleted', () => {
    const r = enforceCountsOnTakeoff(takeoff(), cr2, enforcedCounts(cr2, []));
    expect(r.possibleDoubles).toEqual([{ key: 'A', type: 'A', count: 73, category: 'Interior Lighting', line: "4' LED strip restrooms and stock room" }]);
    expect(r.takeoff[0].items).toHaveLength(4);
  });

  it('"Same fixture — remove this line": the estimator\'s decision removes exactly that line, recorded', () => {
    const decide = (key: string, _c: string, line: string) => (key === 'A' && line.startsWith("4' LED strip") ? 'remove' as const : null);
    const r = enforceCountsOnTakeoff(takeoff(), cr2, enforcedCounts(cr2, []), undefined, decide);
    expect(r.possibleDoubles).toEqual([]);
    expect(r.takeoff[0].items.map(i => i.item)).toEqual(['Type A', 'Type B', 'Ceiling fan']);
    expect(r.corrections).toContain('Interior Lighting "4\' LED strip — restrooms and stock room" removed by the estimator — the same fixture as counted Type A (73).');
  });

  it('"Different item — keep": the line stays and nothing is raised', () => {
    const decide = (key: string) => (key === 'A' ? 'keep' as const : null);
    const r = enforceCountsOnTakeoff(takeoff(), cr2, enforcedCounts(cr2, []), undefined, decide);
    expect(r.possibleDoubles).toEqual([]);
    expect(r.takeoff[0].items).toHaveLength(4);
  });

  it('plausibly-same rules: synonyms and sizes, emergency types by "exit sign"', () => {
    expect(plausiblySameFixture("8' LED strip", { description: '4 ft LED linear', symbolHint: '', emergency: false })).toBe(false);
    expect(plausiblySameFixture("8' LED strip", { description: '8 ft LED linear wraparound', symbolHint: '', emergency: false })).toBe(true);
    expect(plausiblySameFixture('Exit sign w/ battery', { description: 'LED edge-lit sign, red letters', symbolHint: '', emergency: true })).toBe(true);
    expect(plausiblySameFixture('Ceiling fan', { description: '4 ft LED linear', symbolHint: '', emergency: false })).toBe(false);
  });
});
