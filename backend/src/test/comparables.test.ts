import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('comparables', () => {
  it('comparables-preview aggregates by brand', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CW1 ${Date.now()}`, gc: 'G', brand: 'PrevBrandT', amount: 100000, sq_ft: 4000 }).expect(200);
    const r = await request(app)
      .get('/api/preconstruction/comparables-preview?brand=PrevBrandT').set(auth(u.token)).expect(200);
    expect(r.body.count).toBeGreaterThanOrEqual(1);
    expect(r.body.top[0]).toHaveProperty('stage');
  });

  it('comparables-preview requires brand or project_type', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const r = await request(app)
      .get('/api/preconstruction/comparables-preview').set(auth(u.token)).expect(200);
    expect(r.body).toEqual({ count: 0, won: 0, lost: 0, avgPerSf: null, top: [] });
  });

  it('rep cannot see other reps bids in comparables', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const other = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `Hidden ${Date.now()}`, gc: 'G', brand: 'ScopeBrandT', amount: 50000 }).expect(200);
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: `Mine ${Date.now()}`, gc: 'G', brand: 'ScopeBrandT', amount: 60000 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${mine.body.id}/comparables`).set(auth(rep2.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).not.toContain(other.body.id);
  });

  it('owner sees comparables across reps', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const owner = await makeUser('owner');
    const brand = `OwnerScopeT${Date.now()}`;
    const rep1Bid = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `Rep1 ${Date.now()}`, gc: 'G', brand, amount: 50000 }).expect(200);
    const ownerBid = await request(app).post('/api/bids').set(auth(owner.token))
      .send({ name: `Owner ${Date.now()}`, gc: 'G', brand, amount: 60000 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${ownerBid.body.id}/comparables`).set(auth(owner.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).toContain(rep1Bid.body.id);
  });

  it('rep cannot see other reps bids in compare', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const other = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `HiddenCmp ${Date.now()}`, gc: 'G', brand: 'CmpScopeT', amount: 50000 }).expect(200);
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: `MineCmp ${Date.now()}`, gc: 'G', brand: 'CmpScopeT', amount: 60000 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${mine.body.id}/compare?against=${other.body.id}`)
      .set(auth(rep2.token)).expect(200);
    const jobIds = r.body.jobs.map((j: { id: string }) => j.id);
    expect(jobIds).not.toContain(other.body.id);
    expect(jobIds).toContain(mine.body.id);
  });
});
