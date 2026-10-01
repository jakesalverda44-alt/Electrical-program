// Small-fixes — "Add a pole not shown on the plans": stated tag #3 is really two poles.
// Pure rules + the real POST /review/resolve { action: 'add_pole' } route on a stored synthetic item. Test DB only.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import {
  addExtraPoleMember, perPoleHostLine, hostAssignmentAdds, carryOverResolutions, MAX_EXTRA_POLES, type ReviewItem,
} from '../ai/reviewItems';

const base = (): ReviewItem => ({
  id: 'typicalassign:PP', kind: 'count', title: 't', detail: 'd', actions: ['answer'], options: ['tag:1', 'tag:3', 'not_a_host'],
  fingerprint: 'typicalassign|PP|poles:2/3|pole:E-2:1,pole:E-2:2|x',
  reconcileMembers: [
    { key: 'pole:E-2:1', type: 'power pole at E-2', description: 'd', unit: 'count', currentQty: 0, headsPerPole: null },
    { key: 'pole:E-2:2', type: 'power pole at E-2', description: 'd', unit: 'count', currentQty: 0, headsPerPole: null },
  ],
  hostAssignment: {
    hostKey: 'PP', hostCount: 2, hostNoun: 'power pole', members: [],
    perPole: {
      types: [{ typeId: 'tag:1', label: '#1 Office', devices: [{ key: 'DUPLEX', perHost: 1 }] }, { typeId: 'tag:3', label: '#3 Parts pod', devices: [{ key: 'DUPLEX', perHost: 2 }] }],
      poles: [{ id: 'pole:E-2:1', sheetLabel: 'E-2', tag: '1' }, { id: 'pole:E-2:2', sheetLabel: 'E-2', tag: '3' }],
      found: 2, stated: { total: 3, tags: ['1', '2', '3'], label: 'the schedule' },
    },
  },
});
const answered = (item: ReviewItem, key: string, answer: string): ReviewItem => ({
  ...item, reconcileMembers: item.reconcileMembers!.map(m => (m.key === key ? { ...m, resolution: { action: 'answer', answer, by: 'Jake', at: 't' } } : m)),
});

describe('addExtraPoleMember (pure)', () => {
  it('adds an unlocated pole:extra:<n> member; the next one is n+1; the item reopens', () => {
    const a = addExtraPoleMember({ ...base(), resolution: { action: 'confirm', by: 'x', at: 't' } });
    expect(a.ok && a.key).toBe('pole:extra:1');
    if (!a.ok) return;
    expect(a.item.resolution).toBeUndefined();
    expect(a.item.reconcileMembers!.map(m => m.key)).toEqual(['pole:E-2:1', 'pole:E-2:2', 'pole:extra:1']);
    expect(a.item.hostAssignment!.perPole!.poles.at(-1)).toEqual({ id: 'pole:extra:1', unlocated: true, extra: true });
    const b = addExtraPoleMember(a.item);
    expect(b.ok && b.key).toBe('pole:extra:2');
  });

  it('once typed the extra pole counts in the line and takes the type\'s devices; "not a pole" adds nothing', () => {
    let item = answered(answered(base(), 'pole:E-2:1', 'tag:1'), 'pole:E-2:2', 'tag:3');
    expect(perPoleHostLine(item)).toBe(2);
    const a = addExtraPoleMember(item); if (!a.ok) throw new Error(a.error);
    item = answered(a.item, 'pole:extra:1', 'tag:3');
    expect(perPoleHostLine(item)).toBe(3);
    expect(hostAssignmentAdds(item).get('DUPLEX')).toBe(1 + 2 + 2);
    item = answered(a.item, 'pole:extra:1', 'not_a_host');
    expect(perPoleHostLine(answered(answered(item, 'pole:E-2:1', 'tag:1'), 'pole:E-2:2', 'tag:3'))).toBe(2);
  });

  it('refuses a non-per-pole item and caps the extras', () => {
    expect(addExtraPoleMember({ ...base(), id: 'count:A' }).ok).toBe(false);
    const { perPole: _p, ...ha } = base().hostAssignment!;
    expect(addExtraPoleMember({ ...base(), hostAssignment: ha }).ok).toBe(false);
    let item = base();
    for (let n = 0; n < MAX_EXTRA_POLES; n++) { const r = addExtraPoleMember(item); if (!r.ok) throw new Error(r.error); item = r.item; }
    expect(addExtraPoleMember(item).ok).toBe(false);
  });

  it('survives a re-run of an unchanged assignment with its answer', () => {
    const a = addExtraPoleMember(base()); if (!a.ok) throw new Error(a.error);
    const prev = answered(a.item, 'pole:extra:1', 'tag:3');
    const [out] = carryOverResolutions([base()], [prev]);
    expect(out.reconcileMembers!.map(m => m.key)).toContain('pole:extra:1');
    expect(out.reconcileMembers!.find(m => m.key === 'pole:extra:1')!.resolution).toMatchObject({ answer: 'tag:3', carriedOver: true });
    expect(out.hostAssignment!.perPole!.poles.some(p => p.id === 'pole:extra:1' && p.extra)).toBe(true);
  });
});

let ok = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);
async function bid(item: ReviewItem): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`ExtraPole ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify([item])]);
  return rows[0].id as string;
}
const post = (bidId: string, body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);

describe('POST /review/resolve { action: "add_pole" }', () => {
  it('adds the member, answers like any pole, and is stored', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await bid(base());
    const r = await post(bidId, { itemIds: ['typicalassign:PP'], action: 'add_pole' });
    expect(r.status).toBe(200);
    expect(r.body.addedMemberKey).toBe('pole:extra:1');
    const item = (r.body.items as ReviewItem[]).find(i => i.id === 'typicalassign:PP')!;
    expect(item.reconcileMembers!.map(m => m.key)).toContain('pole:extra:1');
    const a = await post(bidId, { itemIds: ['typicalassign:PP'], action: 'answer', answer: 'tag:3', memberKey: 'pole:extra:1' });
    expect(a.status).toBe(200);
    const bad = await post(bidId, { itemIds: ['typicalassign:PP'], action: 'answer', answer: 'tag:9', memberKey: 'pole:extra:1' });
    expect(bad.status).toBe(400);
    const stored = (await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [bidId])).rows[0].review_items as ReviewItem[];
    expect(stored[0].reconcileMembers!.find(m => m.key === 'pole:extra:1')!.resolution).toMatchObject({ answer: 'tag:3' });
  });

  it('validates: one item only, per-pole assignments only, unknown item 404', async (ctx) => {
    if (!ok) return ctx.skip();
    const other: ReviewItem = { id: 'count:A', kind: 'count', title: 't', detail: 'd', actions: ['count'] };
    const bidId = await bid(base());
    expect((await post(bidId, { itemIds: ['typicalassign:PP', 'count:A'], action: 'add_pole' })).status).toBe(400);
    expect((await post(bidId, { itemIds: ['typicalassign:NOPE'], action: 'add_pole' })).status).toBe(404);
    const b2 = await bid(other);
    expect((await post(b2, { itemIds: ['count:A'], action: 'add_pole' })).status).toBe(400);
  });
});
