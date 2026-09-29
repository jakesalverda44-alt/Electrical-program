// Typical fix (2026-09-28) — the "assign a type to each power pole" item
// resolves through the review route type by type (memberKey), exactly like
// a reconcile finding: never one number for every type, and the takeoff
// stays gated until every type has its answer.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { takeoffGate } from '../estimating/takeoffReview';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);

const ID = 'typicalassign:PP-1..6';
const member = (key: string) => ({ key, type: key, description: '', unit: 'count' as const, currentQty: 0, headsPerPole: null });
const ITEMS: ReviewItem[] = [{
  id: ID, kind: 'count', group: 'typical',
  title: '6 power poles, 3 power pole types in #9 POWER POLE LEGEND — assign a type to each power pole',
  detail: 'test', actions: ['count', 'confirm'],
  reconcileMembers: [member('#1 Office area power pole'), member('#3 Parts pod power pole'), member('#6 Commercial counter power pole')],
  hostAssignment: { hostKey: 'PP-1..6', hostCount: 6, members: [
    { key: '#1 Office area power pole', devices: [{ key: 'DUPLEX', perHost: 2 }], suggested: 1 },
    { key: '#3 Parts pod power pole', devices: [{ key: 'DUPLEX', perHost: 1 }], suggested: 2 },
    { key: '#6 Commercial counter power pole', devices: [{ key: 'DUPLEX', perHost: 2 }], suggested: 1 },
  ] },
}];

async function bid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`TypicalAssign ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify(ITEMS)]);
  return rows[0].id as string;
}
const post = (bidId: string, body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send({ itemIds: [ID], ...body });

describe('typicalassign — resolved type by type', () => {
  it('a count without memberKey is refused (never one number for every type); an unknown type 404s', async () => {
    if (!ok) return;
    const bidId = await bid();
    let res = await post(bidId, { action: 'count', qty: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Answer each type on its own/);
    res = await post(bidId, { memberKey: 'NOT A TYPE', action: 'count', qty: 1 });
    expect(res.status).toBe(404);
    res = await post(bidId, { memberKey: '#1 Office area power pole', action: 'not_on_job', reason: 'not a real action here' });
    expect(res.status).toBe(400);
  });

  it('each type answered on its own; the gate clears only when every type has its answer', async () => {
    if (!ok) return;
    const bidId = await bid();
    expect(await takeoffGate(bidId)).not.toBeNull();
    let res = await post(bidId, { memberKey: '#3 Parts pod power pole', action: 'count', qty: 2 });
    expect(res.status).toBe(200);
    let item = (res.body.items as ReviewItem[]).find(i => i.id === ID)!;
    expect(item.resolution).toBeUndefined();
    expect(item.reconcileMembers!.find(m => m.key === '#3 Parts pod power pole')!.resolution).toMatchObject({ action: 'count', qty: 2 });
    expect(await takeoffGate(bidId)).not.toBeNull();
    res = await post(bidId, { memberKey: '#1 Office area power pole', action: 'count', qty: 1 });
    expect(res.status).toBe(200);
    // "None of this type" — keep current count 0, with a reason.
    res = await post(bidId, { memberKey: '#6 Commercial counter power pole', action: 'confirm', reason: 'no commercial counter at this store' });
    expect(res.status).toBe(200);
    item = (res.body.items as ReviewItem[]).find(i => i.id === ID)!;
    expect(item.resolution).toBeTruthy();
    expect(item.reconcileMembers!.map(m => [m.key, m.resolution?.action, m.resolution?.qty])).toEqual([
      ['#1 Office area power pole', 'count', 1], ['#3 Parts pod power pole', 'count', 2], ['#6 Commercial counter power pole', 'confirm', 0],
    ]);
    // 1 + 2 + 0 = 3 of 6: accepted only because the last answer carried a reason.
    expect(item.resolution!.reason).toBe('answers add up to 3 of 6: no commercial counter at this store');
    expect(await takeoffGate(bidId)).toBeNull();
  });

  it('S1 (review repro): a bare "confirm" without a type is refused — the item stays open', async () => {
    if (!ok) return;
    const bidId = await bid();
    const res = await post(bidId, { action: 'confirm', reason: 'none of these here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Answer each type on its own/);
    expect(await takeoffGate(bidId)).not.toBeNull();
  });

  it('S2 (review repro): an answer above the pole count is refused; 6 + 6 + 6 never closes it', async () => {
    if (!ok) return;
    const bidId = await bid();
    let res = await post(bidId, { memberKey: '#1 Office area power pole', action: 'count', qty: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/enter 0 to 6/);
    expect((await post(bidId, { memberKey: '#1 Office area power pole', action: 'count', qty: 6 })).status).toBe(200);
    expect((await post(bidId, { memberKey: '#3 Parts pod power pole', action: 'count', qty: 6 })).status).toBe(200);
    res = await post(bidId, { memberKey: '#6 Commercial counter power pole', action: 'count', qty: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/add up to 18 of the 6 counted/);
    expect(await takeoffGate(bidId)).not.toBeNull();
  });

  it('S2: answers that add up to the pole count close it with no reason', async () => {
    if (!ok) return;
    const bidId = await bid();
    expect((await post(bidId, { memberKey: '#1 Office area power pole', action: 'count', qty: 2 })).status).toBe(200);
    expect((await post(bidId, { memberKey: '#3 Parts pod power pole', action: 'count', qty: 2 })).status).toBe(200);
    const res = await post(bidId, { memberKey: '#6 Commercial counter power pole', action: 'count', qty: 2 });
    expect(res.status).toBe(200);
    expect((res.body.items as ReviewItem[]).find(i => i.id === ID)!.resolution).toBeTruthy();
    expect(await takeoffGate(bidId)).toBeNull();
  });
});
