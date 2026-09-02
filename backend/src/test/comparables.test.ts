import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
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

  // Task 6 (phase 1 estimating chain): /costs and /intelligence/:bidId skipped the
  // rep-ownership scoping every other estimating endpoint applies (the pattern
  // exercised above via ownScopeId) — a restricted rep could read every other
  // rep's pricing history and win-rate stats.
  it('rep cannot see other reps awarded bids in /costs', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const otherName = `HiddenCost ${Date.now()}`;
    const other = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: otherName, gc: 'G', amount: 75000 }).expect(200);
    const mineName = `MineCost ${Date.now()}`;
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: mineName, gc: 'G', amount: 80000 }).expect(200);
    // /costs only returns awarded bids — flip both to 'awarded' directly (the
    // stage-transition endpoint's own behavior is exercised elsewhere).
    await pool.query(`UPDATE bids SET stage='awarded' WHERE id IN ($1,$2)`, [other.body.id, mine.body.id]);

    const asRep2 = await request(app).get('/api/preconstruction/costs').set(auth(rep2.token)).expect(200);
    const namesRep2 = (asRep2.body as Array<{ name: string }>).map(r => r.name);
    expect(namesRep2).toContain(mineName);
    expect(namesRep2).not.toContain(otherName);

    const owner = await makeUser('owner');
    const asOwner = await request(app).get('/api/preconstruction/costs').set(auth(owner.token)).expect(200);
    const namesOwner = (asOwner.body as Array<{ name: string }>).map(r => r.name);
    expect(namesOwner).toContain(otherName);
    expect(namesOwner).toContain(mineName);
  });

  it('rep intelligence stats for a shared GC only count their own bids', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const gc = `SharedGC ${Date.now()}`;
    const other = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `IntelOther ${Date.now()}`, gc, amount: 90000 }).expect(200);
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: `IntelMine ${Date.now()}`, gc, amount: 95000 }).expect(200);
    await pool.query(`UPDATE bids SET stage='awarded' WHERE id=$1`, [other.body.id]);
    await pool.query(`UPDATE bids SET stage='lost' WHERE id=$1`, [mine.body.id]);

    const r = await request(app)
      .get(`/api/preconstruction/intelligence/${mine.body.id}`).set(auth(rep2.token)).expect(200);
    // rep2's own bid for this GC lost, and rep1's award for the same GC is out of
    // scope — rep2 should see 0 wins / 1 loss, not 1 win / 1 loss.
    expect(r.body.gcWins).toBe(0);
    expect(r.body.gcLosses).toBe(1);
  });
});
