// Audit batch 3, Task 11 ("Pricing fields join the workspace autosave" —
// struck from Batch 2). bid_workspaces gains overhead_pct, profit_pct,
// estimate_overrides; PUT stores them, GET returns them.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PUT/GET /api/preconstruction/:bidId/workspace — pricing fields (Task 11)', () => {
  it('PUT stores overhead_pct, profit_pct and estimate_overrides; GET returns them', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Workspace pricing ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const overrides = { 'ELEC-100': 1250.5, 'ELEC-200': 980 };
    const putRes = await request(app).put(`/api/preconstruction/${bidId}/workspace`).set(auth(u.token))
      .send({
        step: 'estimate', active_tab: 'pricing', notes: '', scope: {}, rfis: [], files: [],
        overhead_pct: 12.5, profit_pct: 18, estimate_overrides: overrides,
      })
      .expect(200);
    expect(Number(putRes.body.overhead_pct)).toBe(12.5);
    expect(Number(putRes.body.profit_pct)).toBe(18);
    expect(putRes.body.estimate_overrides).toEqual(overrides);

    const getRes = await request(app).get(`/api/preconstruction/${bidId}/workspace`).set(auth(u.token)).expect(200);
    expect(Number(getRes.body.overhead_pct)).toBe(12.5);
    expect(Number(getRes.body.profit_pct)).toBe(18);
    expect(getRes.body.estimate_overrides).toEqual(overrides);
  });

  it('GET returns null for a bid with no workspace row yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Workspace none ${Date.now()}`, gc: 'G' }).expect(200);
    const res = await request(app).get(`/api/preconstruction/${bid.body.id}/workspace`).set(auth(u.token)).expect(200);
    expect(res.body).toBeNull();
  });

  it('estimate_overrides defaults to {} when omitted, not null', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Workspace default ${Date.now()}`, gc: 'G' }).expect(200);
    const putRes = await request(app).put(`/api/preconstruction/${bid.body.id}/workspace`).set(auth(u.token))
      .send({ step: 'intake', active_tab: 'overview', notes: '', scope: {}, rfis: [], files: [] })
      .expect(200);
    expect(putRes.body.estimate_overrides).toEqual({});
    expect(putRes.body.overhead_pct).toBeNull();
    expect(putRes.body.profit_pct).toBeNull();
  });
});
