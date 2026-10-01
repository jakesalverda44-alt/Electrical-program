// Accuracy round, fix round 2 — the shared-host line and its devices once the
// per-pole questions are answered, and the typicalalign "same poles or more?"
// question. The reviewer's repro: E-1 and E-2 show the same 4 poles and could
// not be lined up (carried count 4, the per-pole item lists 8).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { applyReconcileMemberResolution, buildReviewItems, enforcedCounts, syncHostAssignmentFollowUps, validateResolution, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import type { HostAssignmentGroup, TypicalPackage } from '../ai/evidence/typicals';
import type { CountResult } from '../ai/countingStage';
import { mergeCountsIntoTakeoff, type SheetCountInput } from '../ai/countMerge';
import type { CountTarget } from '../ai/countTargets';

const hosts = ['E-1', 'E-2'].flatMap(lab => [1, 2, 3, 4].map(i => ({ id: `pole:${lab}:${i}`, sheetKey: lab, sheetLabel: lab, x: i * 10, y: lab === 'E-1' ? 0 : 50 })));
const group: HostAssignmentGroup = {
  hostKey: 'PP', hostNoun: 'power pole', hostCount: 4, viewportLabel: '#9 LEGEND', sheetKey: 'E-1',
  types: [
    { typeId: 'tag:1', packageId: 'p1', host: 'Office power pole', hostTag: '1', quote: '', devices: [{ key: 'DUP', text: 'duplex', perHost: 2 }], unstated: [], suggested: null },
    { typeId: 'tag:2', packageId: 'p2', host: 'Checkout power pole', hostTag: '2', quote: '', devices: [{ key: 'DUP', text: 'duplex', perHost: 1 }], unstated: [], suggested: null },
  ],
  suggestion: null, drawnNearHosts: [], hosts, found: 8, stated: { total: 4, tags: [], label: 'E-1' },
};
const cr = (): CountResult => ({
  types: [
    { key: 'PP', type: 'PP', status: 'counted', count: 4, flags: [], sheets: [], category: 'equipment', description: '' },
    { key: 'DUP', type: 'DUP', status: 'counted', count: 10, flags: [], sheets: [], category: 'device', description: '' },
  ],
  targets: [],
  evidence: { hostAssignments: [group], hostAlign: [{ hostKey: 'PP', hostType: 'PP', carried: 4, ifMore: 8, sheets: [{ sheetLabel: 'E-2', refLabel: 'E-1', hosts: 4, refHosts: 4 }], text: 'E-2 could not be lined up — same poles, or more?' }] },
}) as unknown as CountResult;

const built = () => buildReviewItems(cr());
function answerPoles(items: ReviewItem[], answers: Record<string, string>): ReviewItem[] {
  return items.map(i => {
    if (i.id !== 'typicalassign:PP') return i;
    let it = i;
    for (const [k, a] of Object.entries(answers)) it = applyReconcileMemberResolution(it, k, { action: 'answer', answer: a }, 'Jake');
    return it;
  });
}
function answerAlign(items: ReviewItem[], idx: number): ReviewItem[] {
  return items.map(i => {
    if (i.id !== 'typicalalign:PP') return i;
    const v = validateResolution(i, { action: 'answer', answer: i.options![idx] }, null) as { ok: true; resolution: NonNullable<ReviewItem['resolution']> };
    return { ...i, resolution: { ...v.resolution, by: 'Jake', at: 't' } };
  });
}
const E1 = (a: string) => Object.fromEntries([1, 2, 3, 4].map(i => [`pole:E-1:${i}`, a]));
const E2 = (a: string) => Object.fromEntries([1, 2, 3, 4].map(i => [`pole:E-2:${i}`, a]));
const run = (items: ReviewItem[]) => { const b = enforcedCounts(cr(), items).byType; return [b.get('PP'), b.get('DUP')]; };

describe('typicalalign item', () => {
  it('is answerable with two options carrying the carried / if-more counts, stays blocking until answered', () => {
    const q = built().find(i => i.id === 'typicalalign:PP')!;
    expect(q.options).toEqual(['Same poles — 4', 'Different poles — 8']);
    expect(q.actions).toEqual(['answer']);
    expect(q.detail).not.toMatch(/markers/);
    expect(reviewItemIsOpen(q)).toBe(true);
    expect(reviewItemIsOpen(answerAlign([q], 0)[0])).toBe(false);
  });
});

describe('the reviewer repro: E-1 and E-2 show the same 4 poles, unalignable (carried 4, 8 listed)', () => {
  it('nothing answered: the carried 4 stands, devices as drawn', () => {
    expect(run(built())).toEqual([4, 10]); // the carried count and the drawn devices stand
  });
  it('(a) E-1 typed, E-2\'s 4 answered "not a power pole": line 4, devices for 4', () => {
    expect(run(answerPoles(built(), { ...E1('tag:1'), ...E2('not_a_host') }))).toEqual([4, 10 + 4 * 2]);
  });
  it('(b) all 8 typed (they really are 8 poles): line 8, devices for 8', () => {
    expect(run(answerPoles(built(), { ...E1('tag:1'), ...E2('tag:2') }))).toEqual([8, 10 + 4 * 2 + 4 * 1]);
  });
  it('(c) typicalalign "same": line 4 with no per-pole answers; E-2 members collapse — answers on them neither move the line nor add devices', () => {
    expect(run(answerAlign(built(), 0))[0]).toBe(4);
    const items = answerAlign(answerPoles(built(), { ...E1('tag:1'), ...E2('tag:2') }), 0);
    expect(run(items)).toEqual([4, 10 + 4 * 2]);
  });
  it('(d) typicalalign "different": line 8; typed per pole it stays 8 with devices for 8', () => {
    expect(run(answerAlign(built(), 1))[0]).toBe(8);
    expect(run(answerAlign(answerPoles(built(), { ...E1('tag:1'), ...E2('tag:2') }), 1))).toEqual([8, 10 + 8 + 4]);
  });
  it('the per-pole answers set the line themselves even while typicalalign is unanswered or contradicts (never double-applied)', () => {
    expect(run(answerAlign(answerPoles(built(), { ...E1('tag:1'), ...E2('not_a_host') }), 1))[0]).toBe(4);
  });
});

describe('route — answering typicalalign', () => {
  it('a listed option 200 (stored with its qty, enforced); anything else 400; confirm 400', async (ctx) => {
    if (!(await dbAvailable())) return ctx.skip();
    const user: TestUser = await makeUser('owner');
    const q = built().find(i => i.id === 'typicalalign:PP')!;
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`TypicalAlign ${Date.now()}`, user.id]);
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify([q])]);
    const post = (body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${rows[0].id}/review/resolve`).set(auth(user.token)).send(body);
    expect((await post({ itemIds: [q.id], action: 'answer', answer: 'Maybe' })).status).toBe(400);
    expect((await post({ itemIds: [q.id], action: 'confirm', reason: 'looks the same to me' })).status).toBe(400);
    expect((await post({ itemIds: [q.id], action: 'answer', answer: q.options![1] })).status).toBe(200);
    const stored = (await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [rows[0].id])).rows[0].review_items as ReviewItem[];
    expect(stored[0].resolution).toMatchObject({ action: 'answer', answer: 'Different poles — 8', qty: 8 });
    expect(enforcedCounts(cr(), stored).byType.get('PP')).toBe(8);
  });
});

// ── Fix round 3 — the re-check blocker and the two should-fixes, through the
// REAL pipeline (mergeCountsIntoTakeoff → buildReviewItems → enforcedCounts).
// E-1 draws 4 poles (no legible tag) and 10 duplex; E-2 (another sheet size —
// it cannot be lined up) draws the same 4 poles and reads hexagons #1 and #2.
const T: CountTarget[] = [
  { type: 'PP', key: 'PP', description: 'Power poles #1-#4', symbolHint: '', wattage: null, category: 'equipment', source: 'equipment_schedule', sourceSheet: '', headsPerPole: null, emergency: false },
  { type: 'DUP', key: 'DUP', description: 'Duplex receptacle', symbolHint: '', wattage: null, category: 'device', source: 'legend', sourceSheet: '', headsPerPole: null, emergency: false },
];
const PKG = (tag: string, host: string, qty: number): TypicalPackage => ({ id: `L#${tag}`, host, quote: host, source: 'vision', devices: [{ qty, text: 'duplex', targetKey: 'DUP' }], hostTag: tag, sheetKey: 'E-1', hostMarker: '', viewportId: null, viewportLabel: '#9 LEGEND', hostTargetKey: 'PP' } as never);
const G1 = { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 };
const G2 = { originX: 0, originY: 0, widthPt: 3024, heightPt: 2160, rotation: 0 };
const SH = (key: string, g: typeof G1, placed: SheetCountInput['placed']): SheetCountInput => ({ sheet: { key, label: `${key} "Power"`, level: '', role: 'building', focus: 'combined' } as never, status: 'counted', placed, unreadable: [], geometry: g, viewports: null });
const DUPS = Array.from({ length: 10 }, (_, i) => ({ typeKey: 'DUP', x: 100 + i * 150, y: 1200 }));
function pipeline(opts: { e2Tags?: Array<string | undefined>; e1Tags?: Array<string | undefined>; e2Geometry?: typeof G1; e2Poles?: number } = {}) {
  const e1 = SH('E-1', G1, [...[0, 1, 2, 3].map(i => ({ typeKey: 'PP', x: 300 + i * 200, y: 300, ...(opts.e1Tags?.[i] ? { tag: opts.e1Tags[i] } : {}) })), ...DUPS]);
  const e2 = SH('E-2', opts.e2Geometry ?? G2, Array.from({ length: opts.e2Poles ?? 4 }, (_, i) => ({ typeKey: 'PP', x: 500 + i * 230, y: 900, ...(opts.e2Tags?.[i] ? { tag: opts.e2Tags[i] } : {}) })));
  const r = mergeCountsIntoTakeoff({ quantities: [] }, T, [e1, e2], { countingRan: true, evidence: { typicals: [PKG('1', 'Office power pole', 2), PKG('2', 'Checkout power pole', 1)], tables: [], scheduleCounts: new Map() } });
  const c = { types: r.types, targets: T, evidence: r.evidence } as unknown as CountResult;
  return { c, items: buildReviewItems(c) };
}
const ans = (items: ReviewItem[], poles: Record<string, string>, align?: number) => {
  let out = answerPolesOn(items, poles);
  if (align != null) out = out.map(i => (i.id !== 'typicalalign:PP' ? i : { ...i, resolution: { ...(validateResolution(i, { action: 'answer', answer: i.options![align] }, null) as { ok: true; resolution: NonNullable<ReviewItem['resolution']> }).resolution, by: 'Jake', at: 't' } }));
  return out;
};
function answerPolesOn(items: ReviewItem[], answers: Record<string, string>): ReviewItem[] {
  return items.map(i => {
    if (i.id !== 'typicalassign:PP') return i;
    let it = i;
    for (const [k, a] of Object.entries(answers)) it = applyReconcileMemberResolution(it, k, { action: 'answer', answer: a }, 'Jake');
    return it;
  });
}
const enforce = (c: CountResult, items: ReviewItem[]) => { const b = enforcedCounts(c, items).byType; return [b.get('PP'), b.get('DUP')]; };
const E1T = { 'pole:E-1:1': 'tag:1', 'pole:E-1:2': 'tag:2', 'pole:E-1:3': 'tag:1', 'pole:E-1:4': 'tag:1' }; // 2+1+2+2 = 7 duplex

describe('fix round 3 — tags read on a sheet that could not be lined up never bind (the re-check blocker)', () => {
  it('E-2\'s #1 / #2 are suggestions on per-pole members, nothing is expanded before an answer; one question, no area:PP', () => {
    const { c, items } = pipeline({ e2Tags: ['1', '2'] });
    expect(c.evidence!.expansions.filter(e => e.status === 'expanded' && e.expanded > 0)).toEqual([]);
    expect(c.types.find(t => t.key === 'DUP')!.count).toBe(10);
    expect(c.evidence!.hostAlign!.map(a => [a.carried, a.same, a.ifMore, a.unalignedHosts])).toEqual([[4, 4, 8, 4]]);
    const pp = items.find(i => i.id === 'typicalassign:PP')!;
    expect(pp.reconcileMembers!.map(m => m.key)).toEqual(['pole:E-1:1', 'pole:E-1:2', 'pole:E-1:3', 'pole:E-1:4', 'pole:E-2:1', 'pole:E-2:2', 'pole:E-2:3', 'pole:E-2:4']);
    expect(pp.hostAssignment!.perPole!.poles.filter(p => p.suggestedType).map(p => [p.id, p.suggestedType])).toEqual([['pole:E-2:1', 'tag:1'], ['pole:E-2:2', 'tag:2']]);
    expect(pp.reconcileMembers!.find(m => m.key === 'pole:E-2:1')!.description).toMatch(/Suggested: #1 Office power pole .*could not be lined up.*not counted/);
    expect(items.some(i => i.id === 'area:PP')).toBe(false);
    expect(items.filter(i => i.id === 'typicalalign:PP').length).toBe(1);
    expect(enforce(c, items)).toEqual([4, 10]);
  });

  it('the reviewer repro: "same poles" + E-1\'s 4 typed -> duplex 17 (was 20), line 4', () => {
    const { c, items } = pipeline({ e2Tags: ['1', '2'] });
    expect(enforce(c, ans(items, E1T, 0))).toEqual([4, 10 + 7]);
    // Typing E-2's members too changes nothing under "same".
    expect(enforce(c, ans(items, { ...E1T, 'pole:E-2:1': 'tag:1', 'pole:E-2:2': 'tag:2' }, 0))).toEqual([4, 17]);
  });

  it('"different poles" with E-2 typed (#1, #2, #1, #2): line 8, devices for all 8', () => {
    const { c, items } = pipeline({ e2Tags: ['1', '2'] });
    const E2T = { 'pole:E-2:1': 'tag:1', 'pole:E-2:2': 'tag:2', 'pole:E-2:3': 'tag:1', 'pole:E-2:4': 'tag:2' }; // 2+1+2+1 = 6
    expect(enforce(c, ans(items, { ...E1T, ...E2T }, 1))).toEqual([8, 10 + 7 + 6]);
  });

  it('a tag read on BOTH copies stays undecided (counted over both sheets), and an aligned main sheet\'s own unique tag still binds', () => {
    const both = pipeline({ e1Tags: ['1'], e2Tags: ['1'] });
    expect(both.c.evidence!.expansions.filter(e => e.status === 'expanded' && e.expanded > 0)).toEqual([]);
    const main = pipeline({ e1Tags: [undefined, '2'], e2Tags: ['1'] });
    expect(main.c.evidence!.hostAssignments![0].bound).toEqual([{ typeId: 'tag:2', count: 1, tags: ['2'] }]);
    expect(main.c.types.find(t => t.key === 'DUP')!.count).toBe(11); // E-1's bound #2: +1
    // "Same" then types E-1's other three: 10 + 1 (bound #2) + 2+2+2 = 17; the E-2 #1 suggestion adds nothing.
    expect(enforce(main.c, ans(main.items, { 'pole:E-1:1': 'tag:1', 'pole:E-1:2': 'tag:1', 'pole:E-1:3': 'tag:1' }, 0))).toEqual([4, 17]);
  });
});

describe('fix round 3 — the "same" option is the line it gives (should-fix 1)', () => {
  // E-1 4 poles, E-2 3 (could not be lined up); the type's own combining
  // carried 4 + 3 − 2 = 5 (complementary). Same = 4, different = 7.
  const hosts7 = [...[1, 2, 3, 4].map(i => ({ id: `pole:E-1:${i}`, sheetKey: 'E-1', sheetLabel: 'E-1', x: i, y: 0 })), ...[1, 2, 3].map(i => ({ id: `pole:E-2:${i}`, sheetKey: 'E-2', sheetLabel: 'E-2', x: i, y: 9 }))];
  const cr7 = () => ({
    types: [
      { key: 'PP', type: 'PP', status: 'counted', count: 5, flags: [], sheets: [], category: 'equipment', description: '' },
      { key: 'DUP', type: 'DUP', status: 'counted', count: 10, flags: [], sheets: [], category: 'device', description: '' },
    ],
    targets: [],
    evidence: { hostAssignments: [{ ...group, hostCount: 5, hosts: hosts7, found: 7 }], hostAlign: [{ hostKey: 'PP', hostType: 'PP', carried: 5, same: 4, ifMore: 7, unalignedHosts: 3, sheets: [{ sheetLabel: 'E-2', refLabel: 'E-1', hosts: 3, refHosts: 4, sheetKey: 'E-2' }], text: 'E-2 could not be lined up — same poles, or more?' }] },
  }) as unknown as CountResult;
  const items7 = () => buildReviewItems(cr7());
  it('labels: "Same poles — 4" / "Different poles — 7"; the carried 5 is in the detail until answered', () => {
    const q = items7().find(i => i.id === 'typicalalign:PP')!;
    expect(q.options).toEqual(['Same poles — 4', 'Different poles — 7']);
    expect(q.detail).toMatch(/carries 5 PP/);
    expect(enforce(cr7(), items7())[0]).toBe(5);
  });
  it('"same" is 4 before AND after E-1\'s poles are typed (never 5, never moves); "different" is 7 before and after all 7 are typed', () => {
    expect(enforce(cr7(), ans(items7(), {}, 0))[0]).toBe(4);
    expect(enforce(cr7(), ans(items7(), E1T, 0))).toEqual([4, 17]);
    expect(enforce(cr7(), ans(items7(), {}, 1))[0]).toBe(7);
    const all7 = { ...E1T, 'pole:E-2:1': 'tag:1', 'pole:E-2:2': 'tag:1', 'pole:E-2:3': 'tag:2' };
    expect(enforce(cr7(), ans(items7(), all7, 1))).toEqual([7, 10 + 7 + 5]);
  });
});

describe('fix round 3 — area:<host> and typicalalign never both set the pole line (should-fix 2)', () => {
  it('same sheet size (the type\'s own combining asked "same area?"): the poles take the typicalalign path; area:PP is not asked', () => {
    const { c, items } = pipeline({ e2Geometry: G1 });
    expect(items.some(i => i.id === 'area:PP')).toBe(false);
    expect(c.types.find(t => t.key === 'PP')!.areaQuestion).toBeUndefined();
    const q = items.find(i => i.id === 'typicalalign:PP')!;
    expect(q.options).toEqual(['Same poles — 4', 'Different poles — 8']);
    // Never raised before an answer (was 8 "distinct" on a sheet-frame guess, with area:PP still open).
    expect(enforce(c, items)).toEqual([4, 10]);
  });
  it('a stored area:PP answer (an earlier run) is overridden by typicalalign when both exist — typicalalign is applied after it', () => {
    const { c, items } = pipeline();
    const stale: ReviewItem = { id: 'area:PP', kind: 'area', title: 'x', detail: 'x', options: ['a', 'b'], resolution: { action: 'answer', answer: 'b', qty: 8, by: 'J', at: 't' } };
    expect(enforce(c, ans([...items, stale], {}, 0))[0]).toBe(4);
  });
});

describe('fix round 3 audit — stated poles not found are counted against the main sheets, not the union', () => {
  it('stated 6, E-1 4 + E-2 the same 4 (unaligned): 2 stated poles are still asked (the union 8 never hides them)', () => {
    const t6 = [{ ...T[0], description: 'Power poles #1-#6' }, T[1]];
    const e1 = SH('E-1', G1, [...[0, 1, 2, 3].map(i => ({ typeKey: 'PP', x: 300 + i * 200, y: 300 })), ...DUPS]);
    const e2 = SH('E-2', G2, [0, 1, 2, 3].map(i => ({ typeKey: 'PP', x: 500 + i * 230, y: 900 })));
    const r = mergeCountsIntoTakeoff({ quantities: [] }, t6, [e1, e2], { countingRan: true, evidence: { typicals: [PKG('1', 'Office power pole', 2), PKG('2', 'Checkout power pole', 1)], tables: [], scheduleCounts: new Map() } });
    expect(r.evidence!.hostAssignments![0].unlocated!.length).toBe(2);
  });
});

// ── Fix round 4 — enlarged-plan poles held for "repeats or adds?" on a host
// answered pole by pole: per-pole members, no viewport:<host> question.
describe('fix round 4 — held enlarged-plan poles are per-pole members (no viewport:PP beside the per-pole item)', () => {
  const T6 = [{ ...T[0], description: 'Power poles #1-#6' }, T[1]];
  function held(withViewports = true) {
    const e2: SheetCountInput = {
      ...SH('E-2', G1, [...[0, 1, 2, 3, 4, 5].map(i => ({ typeKey: 'PP', x: 300 + i * 200, y: 300 })), ...DUPS]),
      ...(withViewports ? { pendingEnlarged: [{ typeKey: 'PP', viewportId: 'v@11', viewportLabel: '#11 OFFICE AREA POWER PLAN', marks: [{ typeKey: 'PP', x: 140, y: 495, viewportId: 'v@11', viewportKind: 'enlarged_plan' }, { typeKey: 'PP', x: 337, y: 679, viewportId: 'v@11', viewportKind: 'enlarged_plan' }] }] as never } : {}),
    };
    const r = mergeCountsIntoTakeoff({ quantities: [] }, T6, [e2], { countingRan: true, evidence: { typicals: [PKG('1', 'Office power pole', 2), PKG('2', 'Checkout power pole', 1)], tables: [], scheduleCounts: new Map() } });
    const c = { types: r.types, targets: T6, evidence: r.evidence } as unknown as CountResult;
    return { c, items: buildReviewItems(c) };
  }
  const SIX = Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [`pole:E-2:${i}`, i <= 3 ? 'tag:1' : 'tag:2'])); // 3×2 + 3×1 = 9 duplex
  const HELD = (a: string) => ({ 'pole:held:E-2:1': a, 'pole:held:E-2:2': a });

  it('the 2 held marks are members ("may repeat a main-plan pole"); no viewport:PP; the line is the 6 found until answered', () => {
    const { c, items } = held();
    expect(c.types.find(t => t.key === 'PP')!.viewportQuestion).toBeUndefined();
    expect(items.some(i => i.id === 'viewport:PP')).toBe(false);
    const pp = items.find(i => i.id === 'typicalassign:PP')!;
    expect(pp.reconcileMembers!.map(m => m.key)).toEqual([...Object.keys(SIX), 'pole:held:E-2:1', 'pole:held:E-2:2']);
    expect(pp.reconcileMembers!.find(m => m.key === 'pole:held:E-2:1')!.description).toMatch(/on enlarged plan #11 OFFICE AREA POWER PLAN — may repeat a main-plan power pole/);
    expect(c.evidence!.hostAssignments![0].unlocated).toBeUndefined(); // stated 6 = 6 found: the held two are not "missing" too
    expect(enforce(c, items)).toEqual([6, 10]);
  });

  it('typing the 6 never lowers the line; the held two answered "not a power pole" -> 6 (devices for 6); typed -> 8 with devices for 8', () => {
    const { c, items } = held();
    expect(enforce(c, ans(items, SIX))).toEqual([6, 10 + 9]);
    expect(enforce(c, ans(items, { ...SIX, ...HELD('not_a_host') }))).toEqual([6, 10 + 9]);
    expect(enforce(c, ans(items, { ...SIX, ...HELD('tag:1') }))).toEqual([8, 10 + 9 + 4]);
  });

  it('a stale stored viewport:PP "adds — 8" answer (an earlier run) never sets the line of a per-pole host', () => {
    const { c, items } = held();
    const stale: ReviewItem = { id: 'viewport:PP', kind: 'area', title: 'x', detail: 'x', options: ['Repeats — 6', 'Adds — 8'], resolution: { action: 'answer', answer: 'Adds — 8', qty: 8, by: 'J', at: 't' } };
    expect(enforce(c, [...items, stale])[0]).toBe(6);
    expect(enforce(c, ans([...items, stale], { ...SIX, ...HELD('tag:2') }))).toEqual([8, 10 + 9 + 2]);
  });

  it('a non-host type keeps today\'s viewport question and its enforcement', () => {
    const tt: CountTarget[] = [{ ...T[1] }];
    const e2: SheetCountInput = { ...SH('E-2', G1, DUPS), pendingEnlarged: [{ typeKey: 'DUP', viewportId: 'v@11', viewportLabel: '#11', marks: [{ typeKey: 'DUP', x: 140, y: 495, viewportId: 'v@11', viewportKind: 'enlarged_plan' }] }] as never };
    const r = mergeCountsIntoTakeoff({ quantities: [] }, tt, [e2], { countingRan: true, evidence: { typicals: [], tables: [], scheduleCounts: new Map() } });
    expect(r.types.find(t => t.key === 'DUP')!.viewportQuestion).toEqual({ keep: 10, add: 11, items: [{ sheet: 'E-2 "Power"', viewport: '#11', count: 1 }] });
    const c = { types: r.types, targets: tt, evidence: r.evidence } as unknown as CountResult;
    const v = buildReviewItems(c).find(i => i.id === 'viewport:DUP')!;
    expect(v).toBeTruthy();
    const answered = { ...v, resolution: { action: 'answer' as const, answer: v.options![1], qty: 11, by: 'J', at: 't' } };
    expect(enforcedCounts(c, [answered]).byType.get('DUP')).toBe(11);
  });
});

// ── Fix round 5 — the fix-round-4 re-check's should-fix and nit.
describe('fix round 5 — held poles never hide a stated pole that was not found', () => {
  const T6 = [{ ...T[0], description: 'Power poles #1-#6' }, T[1]];
  function run4(): { c: CountResult; items: ReviewItem[] } {
    const e2: SheetCountInput = {
      ...SH('E-2', G1, [...[0, 1, 2, 3].map(i => ({ typeKey: 'PP', x: 300 + i * 200, y: 300 })), ...DUPS]),
      pendingEnlarged: [{ typeKey: 'PP', viewportId: 'v@11', viewportLabel: '#11', marks: [{ typeKey: 'PP', x: 140, y: 495, viewportId: 'v@11', viewportKind: 'enlarged_plan' }, { typeKey: 'PP', x: 337, y: 679, viewportId: 'v@11', viewportKind: 'enlarged_plan' }] }] as never,
    };
    const r = mergeCountsIntoTakeoff({ quantities: [] }, T6, [e2], { countingRan: true, evidence: { typicals: [PKG('1', 'Office power pole', 2), PKG('2', 'Checkout power pole', 1)], tables: [], scheduleCounts: new Map() } });
    const c = { types: r.types, targets: T6, evidence: r.evidence } as unknown as CountResult;
    return { c, items: buildReviewItems(c) };
  }
  const FOUR = Object.fromEntries([1, 2, 3, 4].map(i => [`pole:E-2:${i}`, 'tag:1'])); // 8 duplex
  it('stated 6, found 4, 2 held: the 2 stated-not-found members stay, worded "if it is not one of the enlarged-plan poles above"', () => {
    const { items } = run4();
    const pp = items.find(i => i.id === 'typicalassign:PP')!;
    const unloc = pp.reconcileMembers!.filter(m => m.key.startsWith('pole:unlocated:'));
    expect(unloc.length).toBe(2);
    expect(unloc[0].description).toMatch(/if it is not one of the enlarged-plan power poles above/);
    expect(pp.reconcileMembers!.filter(m => m.key.startsWith('pole:held:')).length).toBe(2);
  });
  it('held answered "not a power pole" (repeats) + the 2 stated poles typed -> 6, devices for 6', () => {
    const { c, items } = run4();
    const keys = items.find(i => i.id === 'typicalassign:PP')!.reconcileMembers!.map(m => m.key);
    const unloc = Object.fromEntries(keys.filter(k => k.startsWith('pole:unlocated:')).map(k => [k, 'tag:2']));
    expect(enforce(c, ans(items, { ...FOUR, 'pole:held:E-2:1': 'not_a_host', 'pole:held:E-2:2': 'not_a_host', ...unloc }))).toEqual([6, 10 + 8 + 2]);
  });
  it('everything typed (8 > the stated 6): a NON-blocking warning, in sync with the answers', () => {
    const { items } = run4();
    let list = items;
    const keys = list.find(i => i.id === 'typicalassign:PP')!.reconcileMembers!.map(m => m.key);
    let a = list.find(i => i.id === 'typicalassign:PP')!;
    for (const k of keys) a = applyReconcileMemberResolution(a, k, { action: 'answer', answer: 'tag:2' }, 'Jake');
    list = syncHostAssignmentFollowUps(list.map(i => (i.id === a.id ? a : i)), a.id);
    const w = list.find(i => i.id === 'typicalassignover:PP')!;
    expect([w.blocking, w.title]).toEqual([false, '8 power poles answered — E-1 states 6']);
    // Answer one held pole "not a power pole" and one stated one too: 6 — the warning goes away.
    a = applyReconcileMemberResolution(a, 'pole:held:E-2:1', { action: 'answer', answer: 'not_a_host' }, 'Jake');
    a = applyReconcileMemberResolution(a, keys.find(k => k.startsWith('pole:unlocated:'))!, { action: 'answer', answer: 'not_a_host' }, 'Jake');
    list = syncHostAssignmentFollowUps(list.map(i => (i.id === a.id ? a : i)), a.id);
    expect(list.some(i => i.id === 'typicalassignover:PP')).toBe(false);
  });
});

describe('fix round 5 — a shared host answered per type: viewport numbers from the distinct count', () => {
  it('PP 6 + a pole-tag legend mark at a 7th place (distinct 7) + 2 held: "keep 7 / add 9", not the pre-de-dup 6 / 8', () => {
    const tl: CountTarget = { type: 'POWER POLE TAG', key: 'POWER POLE TAG', description: 'Power pole tag', symbolHint: '', wattage: null, category: 'equipment', source: 'legend', sourceSheet: '', headsPerPole: null, emergency: false, mergeKind: 'tag_legend', mergedInto: ['PP'] };
    const tt = [{ ...T[0], description: 'Power poles' }, T[1], tl];
    const e2: SheetCountInput = {
      ...SH('E-2', G1, [...[0, 1, 2, 3, 4, 5].map(i => ({ typeKey: 'PP', x: 300 + i * 200, y: 300 })), { typeKey: 'POWER POLE TAG', x: 1800, y: 900 }, ...DUPS]),
      pendingEnlarged: [{ typeKey: 'PP', viewportId: 'v@11', viewportLabel: '#11', marks: [{ typeKey: 'PP', x: 140, y: 495, viewportId: 'v@11', viewportKind: 'enlarged_plan' }, { typeKey: 'PP', x: 337, y: 679, viewportId: 'v@11', viewportKind: 'enlarged_plan' }] }] as never,
    };
    const r = mergeCountsIntoTakeoff({ quantities: [] }, tt, [e2], { countingRan: true, evidence: { typicals: [PKG('1', 'Office power pole', 2), PKG('2', 'Checkout power pole', 1)], tables: [], scheduleCounts: new Map() } });
    const pp = r.types.find(t => t.key === 'PP')!;
    expect(pp.count).toBe(7);
    expect([pp.viewportQuestion?.keep, pp.viewportQuestion?.add]).toEqual([7, 9]);
  });
});
