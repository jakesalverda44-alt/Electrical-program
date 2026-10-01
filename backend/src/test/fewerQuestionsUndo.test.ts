// Fewer-questions round Task 1 — Undo of an automatic answer is the ordinary
// reopen: the item opens again and records the declined source (so a re-run
// does not answer it again), and a single member of a grouped item can be
// reopened on its own. Test DB only; no model is reachable.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { finalizeReview, reviewStatus, AUTO_BY, type ReviewItem } from '../ai/reviewItems';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const AT = '2026-10-01T00:00:00.000Z';
function items(): ReviewItem[] {
  return [
    {
      id: 'area:X', kind: 'area', title: 'Type X: same area or different areas?', detail: 'E1 1 / E2 1', typeKey: 'X',
      options: ['Same area — keep 1', 'Different areas — sum 2'], keepQty: 1, sumQty: 2, actions: ['answer', 'count'], fingerprint: 'fp-x',
      resolution: { action: 'answer', answer: 'Same area — keep 1', qty: 1, by: AUTO_BY, at: AT, auto: { source: 'registration', reason: 'the sheets line up', evidence: ['1 of 1 marks sit in the same place'] } },
    },
    {
      id: 'legend-zero:A-B', kind: 'count', title: '2 legend items', detail: '', actions: ['count', 'markers', 'not_on_job'], fingerprint: 'legend-zero|A|B',
      groupedTypes: [
        { key: 'A', type: 'A', description: 'a', fingerprint: 'zero|0|', resolution: { action: 'not_on_job', reason: 'From Lake Mary: by the sign vendor', by: 'CRM (from Lake Mary)', at: AT, auto: { source: 'account_memory', reason: 'Same account', evidence: ['not on job'], fromBid: { id: '00000000-0000-0000-0000-000000000001', name: 'Lake Mary' }, memoryKey: 'zero|A|a' } } },
        { key: 'B', type: 'B', description: 'b', fingerprint: 'zero|0|', resolution: { action: 'count', qty: 2, by: 'Jake', at: AT } },
      ],
      resolution: { action: 'confirm', reason: 'every item in the group answered', by: 'Jake', at: AT },
    },
  ];
}

async function setup(): Promise<{ user: TestUser; bidId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Here',$2) RETURNING id`, [`Undo ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const its = items();
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1,'complete',$2,$3)`, [rows[0].id, JSON.stringify(its), reviewStatus(its)]);
  return { user, bidId: rows[0].id as string };
}

describe('Undo of an automatic answer', () => {
  it('reopen clears it, records autoDeclined, and a re-run keeps it open', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const r = await request(app).post(`/api/preconstruction/${bidId}/review/reopen`).set(auth(user.token)).send({ itemId: 'area:X' }).expect(200);
    const x = r.body.items.find((i: ReviewItem) => i.id === 'area:X') as ReviewItem;
    expect(x.resolution).toBeUndefined();
    expect(x.autoDeclined).toEqual(['registration']);
    expect(r.body.status).toBe('needs_review');
    // the next run re-derives the automatic answer — and drops it again
    const [again] = finalizeReview([items()[0]], { previous: r.body.items });
    expect(again.resolution).toBeUndefined();
    const ev = await pool.query(`SELECT detail FROM takeoff_labeled_events WHERE bid_id=$1 AND event_kind='auto_answer_undo'`, [bidId]);
    for (let k = 0; k < 20 && !ev.rows.length; k++) { await new Promise(res => setTimeout(res, 50)); ev.rows.push(...(await pool.query(`SELECT detail FROM takeoff_labeled_events WHERE bid_id=$1 AND event_kind='auto_answer_undo'`, [bidId])).rows); }
    expect(ev.rows[0]?.detail).toMatchObject({ itemId: 'area:X', source: 'registration' });
  });

  it('a member of a grouped item reopens on its own (memberKey); the group opens again', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await setup();
    const r = await request(app).post(`/api/preconstruction/${bidId}/review/reopen`).set(auth(user.token)).send({ itemId: 'legend-zero:A-B', memberKey: 'A' }).expect(200);
    const g = r.body.items.find((i: ReviewItem) => i.id === 'legend-zero:A-B') as ReviewItem;
    expect(g.resolution).toBeUndefined();
    expect(g.groupedTypes![0].resolution).toBeUndefined();
    expect(g.groupedTypes![0].autoDeclined).toEqual(['account_memory']);
    expect(g.groupedTypes![1].resolution).toMatchObject({ action: 'count', qty: 2 });
    await request(app).post(`/api/preconstruction/${bidId}/review/reopen`).set(auth(user.token)).send({ itemId: 'legend-zero:A-B', memberKey: 'A' }).expect(404);
  });
});
