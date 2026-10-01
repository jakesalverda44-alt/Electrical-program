// Accuracy round, fix round 2 — the shared-host line and its devices once the
// per-pole questions are answered, and the typicalalign "same poles or more?"
// question. The reviewer's repro: E-1 and E-2 show the same 4 poles and could
// not be lined up (carried count 4, the per-pole item lists 8).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { applyReconcileMemberResolution, buildReviewItems, enforcedCounts, validateResolution, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import type { HostAssignmentGroup } from '../ai/evidence/typicals';
import type { CountResult } from '../ai/countingStage';

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
    expect(q.options).toEqual(['Same poles — keep 4', 'Different poles — 8']);
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
