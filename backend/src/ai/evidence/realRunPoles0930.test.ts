// Accuracy round B — the store power poles of the live AutoZone run of
// 2026-09-30: 2 hosts instead of 6, so their outlets were never added.
//
// B1 DIAGNOSIS (asserted below on the run's own stored output): none of the
// plan's four hypotheses. The counter never placed a single power-pole mark
// on E-1 or E-2 — it was never ASKED: Agent 1's PP-1..6 row cites its
// circuits ("Ckts A-29,A-33,…"), so scheduleCounts took ownership of it
// (real-run fix 3's "the circuits its own description cites feed ONE item")
// and schedule-owned types are not sent to the counter. Its quantity was 1
// "pole" × 2 from the "(2)" of "#3 parts pod (2)" in the same description.
// Hypotheses 1 (tags split), 2 (detail viewports / dropCircuitRepeats) and 4
// (all-or-nothing tag binding) had no marks to act on; hypothesis 3 is true
// but secondary (PP-OFFICE/CCTV and PP-TEST were separate zero items).
import { describe, it, expect, beforeAll } from 'vitest';
import { buildCountTargets } from '../countTargets';
import { consolidateTargets } from './consolidate';
import { multiplierOf, scheduleCounts } from './schedules';
import { distinctHosts, hostTypeAliases, NOT_A_HOST, partialTagBinding, statedHosts, guardSharedHostCounts, sharedHostTypes, type HostMark } from './typicals';
import { hostTagOf, parseCounterResponse } from '../counter';
import { applyReconcileMemberResolution, enforcedCounts, reviewItemIsOpen, type ReviewItem } from '../reviewItems';
import { userText, type FakeRequest } from '../../test/fixtures/takeoff/fakeAnthropic';
import { loadKissimmeeLive0930 } from '../../test/fixtures/realrun/live0930';
import { liveAgent1Input } from '../../test/fixtures/realrun/replay';
import { replayKissimmee0930, scriptedPoleMarks0928 } from '../../test/fixtures/realrun/replay0930';
import { isPdftoppmAvailable } from '../documentPrep';
import type { CountResult } from '../countingStage';
import type { KissimmeeLiveRun } from '../../test/fixtures/realrun/kissimmeeLive';

const live = loadKissimmeeLive0930();
const POLEISH = (k: string) => /^PP|^P$|POWER POLE/i.test(k);

describe('B1 — why the live run had 2 power-pole hosts (stored output, no model)', () => {
  it('the counter placed NO power-pole mark anywhere (none counted, none excluded) — hypotheses 1, 2 and 4 had nothing to act on', () => {
    expect(live.countResult.marks.filter(m => POLEISH(m.typeKey))).toEqual([]);
    expect(live.countResult.sheets.flatMap(s => (s.excluded ?? []).filter(e => POLEISH(e.typeKey)))).toEqual([]);
  });

  it('PP-1..6 was schedule-owned (never sent to the counter): its description cites its circuits; 1 pole × "(2)" from "#3 parts pod (2)" = 2', () => {
    expect(live.countResult.evidence.scheduleOwned).toContain('PP-1..6');
    const cons = consolidateTargets(buildCountTargets(liveAgent1Input(live as unknown as KissimmeeLiveRun)).targets, { panels: ['A', 'B'] });
    const sc = scheduleCounts(cons.targets, live.countResult.evidence.tables).get('PP-1..6')!;
    expect(sc.qty).toBe(2);
    expect(sc.note).toMatch(/the circuits its own description cites feed one PP-1\.\.6 × 2 per the schedule description/);
    expect(multiplierOf(cons.targets.find(t => t.key === 'PP-1..6')!.description)).toBe(2);
    // The host count the typicals used: 2 (all five legend types unassigned).
    expect((live.countResult.evidence as unknown as NonNullable<CountResult['evidence']>).hostAssignments!.map(g => [g.hostKey, g.hostCount])).toEqual([['PP-1..6', 2]]);
  });

  it('hypothesis 3 (secondary): PP-OFFICE/CCTV and PP-TEST were separate zero-count items', () => {
    expect(live.reviewItems.filter(i => i.id === 'count:PP-OFFICE/CCTV' || i.id === 'count:PP-TEST').length).toBe(2);
  });
});

describe('B2 / B3 / B4 — pure pieces', () => {
  const m = (x: number, y: number, tag?: string): HostMark => ({ sheetKey: 'E2', x, y, ...(tag ? { tag } : {}) });
  it('distinct hosts: marks within 0.5" are one pole (its tag and its legend symbol; the same pole on an aligned sheet); a tag read on either is kept', () => {
    const d = distinctHosts([m(1, 1), m(1.3, 1.2, '4'), m(5, 5), m(5.6, 5)]);
    expect(d.map(h => [h.x, h.y, h.tag])).toEqual([[1, 1, '4'], [5, 5, undefined], [5.6, 5, undefined]]);
  });
  it('stated totals: the tag range or "(6) power poles" — a reconciliation target, never the count', () => {
    expect(statedHosts({ key: 'PP-1..6', type: 'PP-1..6', description: '' }, 'E-2')).toEqual({ total: 6, tags: ['1', '2', '3', '4', '5', '6'], label: 'E-2' });
    expect(statedHosts({ key: 'PP', type: 'PP', description: '(6) power poles, GC furnished' }, 'E-2')).toMatchObject({ total: 6, tags: [] });
    expect(statedHosts({ key: 'PP', type: 'PP', description: 'Power poles' }, 'E-2')).toBeNull();
  });
  it('partial tag binding: a read tag that is a legend number AND unique binds; a duplicate, an unknown or no tag is asked', () => {
    const types = [{ typeId: 'tag:1', hostTag: '1' }, { typeId: 'tag:3', hostTag: '3' }, { typeId: 'tag:4', hostTag: '4' }];
    const r = partialTagBinding([m(1, 1, '1'), m(2, 2, '3'), m(3, 3, '3'), m(4, 4, '9'), m(5, 5)], types);
    expect([...r.bound.keys()]).toEqual(['tag:1']);
    expect(r.unbound.length).toBe(4);
    expect([...r.ambiguous.values()]).toEqual(['tag:3', 'tag:3']);
  });
  it('pole-type aliases: a zero-count schedule row naming ONE legend pole type folds into it; one that fits two types, or is not a pole row, does not', () => {
    const groups = [{ hostKey: 'PP-1..6', hostNoun: 'power pole', types: [
      { typeId: 'tag:1', host: 'Office area power pole', hostTag: '1' }, { typeId: 'tag:2', host: 'Checkout counter power pole', hostTag: '2' },
      { typeId: 'tag:4', host: 'Test station power pole', hostTag: '4' }, { typeId: 'tag:6', host: 'Commercial counter power pole', hostTag: '6' }] }];
    const rows = [
      { key: 'PP-OFFICE/CCTV', type: 'PP-OFFICE/CCTV', description: "Power poles for Manager's office and CCTV system", status: 'zero', source: 'equipment_schedule' },
      { key: 'PP-TEST', type: 'PP-TEST', description: 'Power pole for test center', status: 'zero', source: 'equipment_schedule' },
      { key: 'PP-CTR', type: 'PP-CTR', description: 'Power pole at the counter', status: 'zero', source: 'equipment_schedule' },
      { key: 'OFFICE', type: 'OFFICE', description: 'Office receptacles', status: 'zero', source: 'equipment_schedule' },
    ];
    expect(hostTypeAliases(rows, groups).map(a => [a.key, a.typeId])).toEqual([['PP-OFFICE/CCTV', 'tag:1'], ['PP-TEST', 'tag:4']]);
  });
  it('the counter reports a host\'s number as "#n" in the circuit field', () => {
    expect(hostTagOf('#3 A-33')).toEqual({ tag: '3', rest: 'A-33' });
    expect(hostTagOf('A-33')).toEqual({ rest: 'A-33' });
    const p = parseCounterResponse(JSON.stringify({ marks: [['PP-1..6', 'R1C1', 0.5, 0.5, '#4 B-20,24'], ['PP-1..6', 'R1C1', 0.2, 0.2, '']] }), new Set(['PP-1..6']), new Set(['R1C1']))!;
    expect(p.marks.map(x => [x.tag, x.circuit])).toEqual([['4', 'B20,24'], [undefined, undefined]]);
  });
});

let have = false;
let auto: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
let scripted: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
let tagged: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  auto = await replayKissimmee0930();
  scripted = await replayKissimmee0930({ extraMarks: scriptedPoleMarks0928() });
  tagged = await replayKissimmee0930({ extraMarks: scriptedPoleMarks0928({ 0: '1', 1: '2', 5: '6' }) });
}, 600_000);
const assignOf = (r: { review: ReviewItem[] }) => r.review.filter(i => i.id.startsWith('typicalassign:'));

describe('B — the 09-30 run replayed', () => {
  it('the counter is now ASKED for PP-1..6 on the plans, with the pole numbers (it is no longer schedule-owned)', (ctx) => {
    if (!have) return ctx.skip();
    expect(auto.cr.evidence!.scheduleOwned).not.toContain('PP-1..6');
    const e2 = auto.calls.find(c => userText(c).includes('SHEET: E-2') && !userText(c).includes('CONSISTENCY PASS'))!;
    expect(userText(e2)).toMatch(/- PP-1\.\.6 \|.*EACH ONE NUMBERED .*\(1, 2, 3, 4, 6\)/);
  });

  it('AUTOMATIC (the live marks hold no pole): 0 found of the 6 E-2 states — ONE blocking item, the 6 stated poles its members; never 2, never 6 silently', (ctx) => {
    if (!have) return ctx.skip();
    const pp = auto.cr.types.find(t => t.key === 'PP-1..6')!;
    expect([pp.count, pp.status]).toEqual([0, 'zero']);
    expect(pp.flags.join(' ')).toMatch(/E-2 states 6 PP-1\.\.6 \(#1–#6\); 0 found on the plans/);
    const a = assignOf(auto);
    expect(a.length).toBe(1);
    expect(reviewItemIsOpen(a[0])).toBe(true);
    expect(a[0].title).toMatch(/^E-2 states 6 power poles \(#1–#6\); 0 found on the plans/);
    expect(a[0].reconcileMembers!.map(m => m.key)).toEqual(['pole:unlocated:1', 'pole:unlocated:2', 'pole:unlocated:3', 'pole:unlocated:4', 'pole:unlocated:5', 'pole:unlocated:6']);
    // Not also a zero item, and no "no multiplier" typical per pole type.
    expect(auto.review.some(i => i.id === 'count:PP-1..6' || i.id.startsWith('typical:'))).toBe(false);
  });

  it('B4: no PP-OFFICE/CCTV / PP-TEST zero items (folded into #1 office / #4 tester); the 3" PVC data/security pipes: one NON-blocking question, default not', (ctx) => {
    if (!have) return ctx.skip();
    expect(auto.review.some(i => i.id === 'count:PP-OFFICE/CCTV' || i.id === 'count:PP-TEST')).toBe(false);
    expect(auto.cr.types.filter(t => t.key === 'PP-OFFICE/CCTV' || t.key === 'PP-TEST').map(t => [t.key, t.status, t.mergedInto])).toEqual([
      ['PP-OFFICE/CCTV', 'merged', '#1 Office area power pole (PP-1..6)'], ['PP-TEST', 'merged', '#4 Test station power pole (PP-1..6)']]);
    const q = auto.review.find(i => i.id.startsWith('pipepoles:PP-1..6'))!;
    expect([q.blocking, q.suggested, q.options]).toEqual([false, 'No — raceway only, not power poles', ['No — raceway only, not power poles', 'Yes — price 2 as power poles']]);
    expect(q.title).toBe('2 3" PVC data/security pipes at pole #5 — price them as power poles?');
  });

  it('an unlocated pole given a type is added to PP-1..6 (with its outlets); "not on the job" adds nothing; the pipes answered yes add 2', (ctx) => {
    if (!have) return ctx.skip();
    let a = assignOf(auto)[0];
    a = applyReconcileMemberResolution(a, 'pole:unlocated:2', { action: 'answer', answer: 'tag:2' }, 'Jake');
    a = applyReconcileMemberResolution(a, 'pole:unlocated:5', { action: 'answer', answer: NOT_A_HOST }, 'Jake');
    const q = auto.review.find(i => i.id.startsWith('pipepoles:'))!;
    const yes = { ...q, resolution: { action: 'answer' as const, answer: q.options![1], by: 'Jake', at: '' } };
    const e = enforcedCounts(auto.cr, auto.review.map(i => (i.id === a.id ? a : i.id === q.id ? yes : i))).byType;
    expect(e.get('PP-1..6')).toBe(3); // 0 found + 1 typed + 2 pipe poles
    expect(e.get('DUPLEX / FLOOR RECEPTACLE')).toBe((auto.cr.types.find(t => t.key === 'DUPLEX / FLOOR RECEPTACLE')!.count) + 1);
  });

  it('SCRIPTED (the 09-28 counter\'s own PP-1..6 marks on E-2): 6 distinct hosts (the #11 enlarged-plan copies are repeats); 6 poles asked, none bound (no number read)', (ctx) => {
    if (!have) return ctx.skip();
    expect(scriptedPoleMarks0928().length).toBe(8);
    const pp = scripted.cr.types.find(t => t.key === 'PP-1..6')!;
    expect([pp.count, pp.status]).toEqual([6, 'counted']);
    const g = scripted.cr.evidence!.hostAssignments![0];
    expect([g.found, g.stated!.total, g.hosts!.length, g.unlocated]).toEqual([6, 6, 6, undefined]);
    const a = assignOf(scripted);
    expect(a.length).toBe(1);
    expect(a[0].reconcileMembers!.map(m => m.key)).toEqual(['pole:E-2:1', 'pole:E-2:2', 'pole:E-2:3', 'pole:E-2:4', 'pole:E-2:5', 'pole:E-2:6']);
    expect(guardSharedHostCounts(scripted.cr.evidence!.expansions)).toEqual(scripted.cr.evidence!.expansions);
  });

  it('SCRIPTED tags (#1, #2, #6 read on three of the poles): those three are bound by tag and their outlets added (2 + 1 + 2 duplex); only the other three are asked', (ctx) => {
    if (!have) return ctx.skip();
    const g = tagged.cr.evidence!.hostAssignments![0];
    expect(g.bound).toEqual([{ typeId: 'tag:1', count: 1, tags: ['1'] }, { typeId: 'tag:2', count: 1, tags: ['2'] }, { typeId: 'tag:6', count: 1, tags: ['6'] }]);
    expect(assignOf(tagged)[0].reconcileMembers!.length).toBe(3);
    const exp = tagged.cr.evidence!.expansions.filter(e => e.hostKey === 'PP-1..6' && e.deviceKey === 'DUPLEX / FLOOR RECEPTACLE');
    expect(exp.map(e => [e.hostType, e.status, e.binding, e.hostCount])).toEqual([
      ['tag:1', 'expanded', 'tag', 1], ['tag:2', 'expanded', 'tag', 1], ['tag:3', 'expanded', 'tag', 0], ['tag:4', 'expanded', 'tag', 0], ['tag:6', 'expanded', 'tag', 1]]);
    const added = exp.reduce((n, e) => n + e.expanded + e.drawnAtHosts, 0);
    expect(added).toBe(5);
    expect(sharedHostTypes(tagged.cr.evidence!.typicals, tagged.cr.targets).has('PP-1..6')).toBe(true);
    expect(guardSharedHostCounts(tagged.cr.evidence!.expansions)).toEqual(tagged.cr.evidence!.expansions);
  });
});
