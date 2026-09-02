// Task 5.5 (phase 2 takeoff fidelity): confidence survives to the estimator's
// screen. bid_estimates.line_items is JSONB and this route already round-trips
// whatever fields the frontend sends (no migration needed — see estimates.ts's
// PUT handler) — this proves a saved line item's `confidence` field actually
// comes back on the next GET, the way the Pricing tab's chips depend on.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('bid_estimates line_items carry confidence through save/load', () => {
  it('round-trips a per-line confidence value via PUT then GET', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EstConfidence ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const line_items = [
      { category: 'LIGHTING', item: 'LED Troffer 2x4', qty: 48, unit: 'EA', unit_cost: 45, total: 2160, overridden: false, confidence: 'VERIFIED' },
      { category: 'BRANCH POWER', item: 'Duplex Receptacle', qty: 64, unit: 'EA', unit_cost: 12, total: 768, overridden: false, confidence: 'ASSUMED' },
      { category: 'LOW VOLTAGE', item: 'Data Cable', qty: 1200, unit: 'LF', unit_cost: 0.5, total: 600, overridden: false, confidence: 'NOT SHOWN' },
    ];

    const putRes = await request(app).put(`/api/estimates/${bidId}`).set(auth(u.token))
      .send({ line_items, overhead_pct: 10, profit_pct: 15 })
      .expect(200);
    expect(putRes.body.line_items.map((li: { confidence?: string }) => li.confidence))
      .toEqual(['VERIFIED', 'ASSUMED', 'NOT SHOWN']);

    const getRes = await request(app).get(`/api/estimates/${bidId}`).set(auth(u.token)).expect(200);
    expect(getRes.body.line_items.map((li: { confidence?: string }) => li.confidence))
      .toEqual(['VERIFIED', 'ASSUMED', 'NOT SHOWN']);
  });

  it('still works for a line item with no confidence field at all (older saves)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EstNoConfidence ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const line_items = [
      { category: 'LIGHTING', item: 'LED Troffer 2x4', qty: 48, unit: 'EA', unit_cost: 45, total: 2160, overridden: false },
    ];
    await request(app).put(`/api/estimates/${bidId}`).set(auth(u.token))
      .send({ line_items, overhead_pct: 10, profit_pct: 15 })
      .expect(200);

    const getRes = await request(app).get(`/api/estimates/${bidId}`).set(auth(u.token)).expect(200);
    expect(getRes.body.line_items[0].confidence).toBeUndefined();
  });
});
