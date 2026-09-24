// Evidence round 5.1 — labeled data: every review resolution, marker
// confirm/reject/move/reclass and accepted gap-fill mark is logged, tagged
// with the bid's client/project type, best-effort (a logging failure never
// breaks the actual action).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { logLabeledEvent, logLabeledEvents } from '../estimating/labeledEvents';
import { resolveReviewItems } from '../estimating/takeoffReview';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string, brand: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `LabeledEvents Test ${Date.now()}`, gc: `Labeled Events Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 50_000, brand })
    .expect(200);
  return res.body.id as string;
}

async function eventsFor(bidId: string, kind?: string) {
  const { rows } = await pool.query(
    kind ? 'SELECT * FROM takeoff_labeled_events WHERE bid_id=$1 AND event_kind=$2 ORDER BY id' : 'SELECT * FROM takeoff_labeled_events WHERE bid_id=$1 ORDER BY id',
    kind ? [bidId, kind] : [bidId]
  );
  return rows;
}

describe('logLabeledEvent / logLabeledEvents', () => {
  it('writes a row with the given kind/type/sheet/client and detail', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token, 'TestBrand');
    await logLabeledEvent({ bidId, kind: 'crop_check', typeKey: 'GFCI', sheetKey: 'set.pdf#49', client: 'TestBrand', projectType: 'Retail', detail: { decision: 'accept' } });
    const rows = await eventsFor(bidId, 'crop_check');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type_key: 'GFCI', sheet_key: 'set.pdf#49', client: 'TestBrand', project_type: 'Retail' });
    expect(rows[0].detail).toEqual({ decision: 'accept' });
  });
  it('a bad bid_id is swallowed (non-fatal), never throws', async (ctx) => {
    if (!ok) return ctx.skip();
    await expect(logLabeledEvent({ bidId: '00000000-0000-0000-0000-000000000000', kind: 'marker_update', detail: {} })).resolves.toBeUndefined();
  });
  it('logLabeledEvents writes several independently', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token, 'Batch Brand');
    await logLabeledEvents([
      { bidId, kind: 'gapfill_accept', typeKey: 'GFCI', detail: { x: 1, y: 2 } },
      { bidId, kind: 'gapfill_accept', typeKey: 'GFCI', detail: { x: 3, y: 4 } },
    ]);
    expect(await eventsFor(bidId, 'gapfill_accept')).toHaveLength(2);
  });
});

describe('review resolution logging', () => {
  it('resolving a review item logs a review_resolution event tagged with the bid brand', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token, 'AutoZone');
    const item: ReviewItem = { id: 'count:X', kind: 'count', title: 'Type X', detail: '', typeKey: 'X', actions: ['count', 'not_on_job'] };
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1,'agent1_complete',$2,'needs_review')
       ON CONFLICT (bid_id) DO UPDATE SET review_items=$2, review_status='needs_review'`,
      [bidId, JSON.stringify([item])]
    );
    const out = await resolveReviewItems(bidId, ['count:X'], { action: 'not_on_job', reason: 'Confirmed not on this job with the estimator' }, 'Test User');
    expect(out.ok).toBe(true);
    // Fire-and-forget: give the microtask queue a tick to land the insert.
    await new Promise(r => setTimeout(r, 200));
    const rows = await eventsFor(bidId, 'review_resolution');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type_key: 'X', client: 'AutoZone', created_by: 'Test User' });
    expect(rows[0].detail).toMatchObject({ itemId: 'count:X', action: 'not_on_job' });
  });
});
