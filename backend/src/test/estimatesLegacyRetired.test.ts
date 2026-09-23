// Fix round 1 / S9 — PUT /api/estimates/:bidId (the flat-rate estimate
// engine) is retired; it returns 410 Gone now instead of upserting
// bid_estimates. This file used to prove a saved line item's `confidence`
// field round-tripped through THIS route — that coverage moved to
// estimatingComposeBidDataFix.test.ts, which proves the same thing for the
// new engine (PUT /api/estimating/:bidId -> saveBidEstimate()). GET
// /api/estimates/:bidId is UNCHANGED (still read by the frontend's overhead/
// profit hydration) and still returns whatever bid_estimates row exists.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PUT /api/estimates/:bidId — retired (fix round 1 / S9)', () => {
  it('returns 410 Gone instead of writing anything', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EstRetired ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const line_items = [
      { category: 'LIGHTING', item: 'LED Troffer 2x4', qty: 48, unit: 'EA', unit_cost: 45, total: 2160, overridden: false, confidence: 'VERIFIED' },
    ];
    const res = await request(app).put(`/api/estimates/${bidId}`).set(auth(u.token))
      .send({ line_items, overhead_pct: 10, profit_pct: 15 })
      .expect(410);
    expect(res.body.error).toContain('/api/estimating/');

    // Nothing was written — GET still returns null (no bid_estimates row).
    const getRes = await request(app).get(`/api/estimates/${bidId}`).set(auth(u.token)).expect(200);
    expect(getRes.body).toBeNull();
  });

  it('still requires auth/ownership before returning 410 (not a bypass of the access check)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    const bid = await request(app).post('/api/bids').set(auth(b.token))
      .send({ name: `EstRetiredAuth ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app).put(`/api/estimates/${bid.body.id}`).set(auth(a.token))
      .send({ line_items: [], overhead_pct: 10, profit_pct: 15 })
      .expect(403);
  });
});

describe('GET /api/estimates/:bidId — unchanged, still reads bid_estimates', () => {
  it('returns null for a bid with no saved estimate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EstGetOnly ${Date.now()}`, gc: 'G' }).expect(200);
    const res = await request(app).get(`/api/estimates/${bid.body.id}`).set(auth(u.token)).expect(200);
    expect(res.body).toBeNull();
  });
});
