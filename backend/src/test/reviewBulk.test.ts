// Next round A7 — bulk resolution by group (each item gets its OWN option /
// pre-filled answer) and information items that never block the gate.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { takeoffGate } from '../estimating/takeoffReview';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);

const ITEMS: ReviewItem[] = [
  { id: 'area:GFI', kind: 'area', title: 'Type GFI: same area or different areas?', detail: 'E-2 16 / E-2.1 4', options: ['Same area — keep 16', 'Different areas — sum 20'], keepQty: 16, sumQty: 20, actions: ['answer', 'count'], group: 'area:E-2 / E-2.1' },
  { id: 'area:DUP', kind: 'area', title: 'Type DUP: same area or different areas?', detail: 'E-2 11 / E-2.1 2', options: ['Same area — keep 11', 'Different areas — sum 13'], keepQty: 11, sumQty: 13, actions: ['answer', 'count'], group: 'area:E-2 / E-2.1' },
  { id: 'scope:power_poles:furnish', kind: 'scope_question', title: 'Power poles — furnished by', detail: 'q', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', actions: ['answer'], group: 'scope' },
  { id: 'scope:power_poles:install', kind: 'scope_question', title: 'Power poles — installed by', detail: 'q', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', actions: ['answer'], group: 'scope' },
  { id: 'count:EF', kind: 'count', title: 'Type EF — Exhaust fan', detail: 'info', blocking: false, actions: ['count', 'not_on_job'], group: 'info' },
];

async function bid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`Bulk ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify(ITEMS)]);
  return rows[0].id as string;
}

describe('A7 — bulk resolution by group', () => {
  it('"all different areas" answers each item with its own option and qty', async () => {
    if (!ok) return;
    const bidId = await bid();
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['area:GFI', 'area:DUP'], action: 'answer', answerIndex: 1 });
    expect(res.status).toBe(200);
    const by = Object.fromEntries((res.body.items as ReviewItem[]).map(i => [i.id, i.resolution]));
    expect(by['area:GFI']).toMatchObject({ action: 'answer', answer: 'Different areas — sum 20', qty: 20 });
    expect(by['area:DUP']).toMatchObject({ action: 'answer', answer: 'Different areas — sum 13', qty: 13 });
  });

  it('"accept the pre-filled answers" answers APT for both halves; then only the info item is open and nothing blocks', async () => {
    if (!ok) return;
    const bidId = await bid();
    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send({ itemIds: ['area:GFI', 'area:DUP'], action: 'answer', answerIndex: 0 });
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['scope:power_poles:furnish', 'scope:power_poles:install'], action: 'answer', useSuggested: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('clear');
    expect((res.body.items as ReviewItem[]).filter(i => i.id.startsWith('scope:')).map(i => i.resolution!.answer)).toEqual(['APT', 'APT']);
    expect((res.body.items as ReviewItem[]).find(i => i.id === 'count:EF')!.resolution).toBeUndefined();
    expect(await takeoffGate(bidId)).toBeNull();
  });

  it('fix round N9: a bulk request across groups is refused on the server', async () => {
    if (!ok) return;
    const bidId = await bid();
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['area:GFI', 'scope:power_poles:furnish'], action: 'answer', answerIndex: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/one group/);
  });

  it('a bad bulk request changes nothing', async () => {
    if (!ok) return;
    const bidId = await bid();
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['area:GFI', 'count:EF'], action: 'answer', useSuggested: true });
    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect((rows[0].review_items as ReviewItem[]).every(i => !i.resolution)).toBe(true);
  });
});

it('ran against the test database (not skipped)', () => { expect(ok).toBe(true); });
