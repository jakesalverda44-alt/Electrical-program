// Fix round B6 — a legend-zero group resolves member by member: each
// legend item in the group gets its OWN action (not on job / a count /
// confirmed markers), and the group stays open (still blocks) until every
// member has answered — never a single blanket flag for the whole group.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { takeoffGate } from '../estimating/takeoffReview';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);

const GROUP_ID = 'legend-zero:MS-OS-PC';
const ITEMS: ReviewItem[] = [
  {
    id: GROUP_ID, kind: 'count',
    title: '3 legend items not found on any counted sheet — answer each one',
    detail: 'Motion sensor; Occupancy sensor; Photocell.',
    actions: ['count', 'markers', 'not_on_job'],
    groupedTypes: [
      { key: 'MS', type: 'Motion sensor', description: 'Motion sensor' },
      { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
      { key: 'PC', type: 'Photocell', description: 'Photocell' },
    ],
  },
];

async function bid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`GroupMembers ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify(ITEMS)]);
  return rows[0].id as string;
}

describe('B6 — a legend-zero group resolves member by member', () => {
  it('answering one member leaves the group (and the gate) blocked; the last member answered resolves it', async () => {
    if (!ok) return;
    const bidId = await bid();
    expect(await takeoffGate(bidId)).not.toBeNull(); // starts blocked

    // 1. Answer MS alone: "not on this job".
    let res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'MS', action: 'not_on_job', reason: 'Design-build scope, not this job' });
    expect(res.status).toBe(200);
    let group = (res.body.items as ReviewItem[]).find(i => i.id === GROUP_ID)!;
    expect(group.resolution).toBeUndefined(); // OS, PC still unanswered — the group itself is not done
    expect(group.groupedTypes!.find(g => g.key === 'MS')!.resolution).toMatchObject({ action: 'not_on_job' });
    expect(group.groupedTypes!.find(g => g.key === 'OS')!.resolution).toBeUndefined();
    expect(await takeoffGate(bidId)).not.toBeNull(); // still blocked — 2 members left

    // 2. Answer OS alone: a real count.
    res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'OS', action: 'count', qty: 6 });
    expect(res.status).toBe(200);
    group = (res.body.items as ReviewItem[]).find(i => i.id === GROUP_ID)!;
    expect(group.resolution).toBeUndefined(); // PC still unanswered
    expect(await takeoffGate(bidId)).not.toBeNull();

    // 3. Answer PC, the last member: the group (and the gate) clears.
    res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'PC', action: 'not_on_job', reason: 'Design-build scope, not this job' });
    expect(res.status).toBe(200);
    group = (res.body.items as ReviewItem[]).find(i => i.id === GROUP_ID)!;
    expect(group.resolution).toBeTruthy(); // every member answered
    expect(group.groupedTypes!.map(g => ({ key: g.key, action: g.resolution?.action, qty: g.resolution?.qty })))
      .toEqual([
        { key: 'MS', action: 'not_on_job', qty: undefined },
        { key: 'OS', action: 'count', qty: 6 },
        { key: 'PC', action: 'not_on_job', qty: undefined },
      ]);
    expect(await takeoffGate(bidId)).toBeNull(); // clear now
  });

  it('an unknown memberKey is rejected; re-answering a member (by its own key) updates its own resolution, same as any other item', async () => {
    if (!ok) return;
    const bidId = await bid();
    let res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'NOT-A-MEMBER', action: 'not_on_job', reason: 'whatever reason text' });
    expect(res.status).toBe(404);

    res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'MS', action: 'not_on_job', reason: 'Design-build scope, not this job' });
    expect(res.status).toBe(200);

    // Re-answering the SAME member is an update to just that member — never
    // touches its siblings, and the group is still open (OS, PC unanswered).
    res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'MS', action: 'not_on_job', reason: 'a different reason entirely' });
    expect(res.status).toBe(200);
    const group = (res.body.items as ReviewItem[]).find(i => i.id === GROUP_ID)!;
    expect(group.groupedTypes!.find(g => g.key === 'MS')!.resolution).toMatchObject({ reason: 'a different reason entirely' });
    expect(group.groupedTypes!.find(g => g.key === 'OS')!.resolution).toBeUndefined();
    expect(group.resolution).toBeUndefined();
  });

  it('omitting memberKey answers every member that has no answer yet, each with its own resolution record', async () => {
    if (!ok) return;
    const bidId = await bid();
    // Pre-answer MS alone first.
    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], memberKey: 'MS', action: 'not_on_job', reason: 'Design-build scope, not this job' });
    // Now the "apply to all" shortcut: OS and PC (the only ones left).
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: [GROUP_ID], action: 'not_on_job', reason: 'Design-build scope, not this job' });
    expect(res.status).toBe(200);
    const group = (res.body.items as ReviewItem[]).find(i => i.id === GROUP_ID)!;
    expect(group.resolution).toBeTruthy();
    expect(group.groupedTypes!.every(g => g.resolution?.action === 'not_on_job')).toBe(true);
  });
});
