// Job profile fix round — the plan-profile columns are editable through the
// bid PATCH route (review B1 fix 6), and plan_date comes back as a plain
// ISO date with no time (review B3).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('PATCH /api/bids/:id — plan-profile fields', () => {
  it('sets and clears prototype, plan_date, owner, architect, engineer, store #, build type', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const created = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `Fields ${Date.now()}`, gc: 'GC' }).expect(200);
    const id = created.body.id;
    const set = await request(app).patch(`/api/bids/${id}`).set(auth(u.token)).send({
      prototype: ' 7N2-L ', plan_date: '2025-09-22', owner_name: 'AUTOZONE STORES LLC', architect: 'RLBA',
      engineer: 'DANNY E. DOSS P.E.', store_number: '10077', build_type: 'new',
    }).expect(200);
    expect(set.body.bid).toMatchObject({
      prototype: '7N2-L', plan_date: '2025-09-22', owner_name: 'AUTOZONE STORES LLC', architect: 'RLBA',
      engineer: 'DANNY E. DOSS P.E.', store_number: '10077', build_type: 'new',
    });
    const cleared = await request(app).patch(`/api/bids/${id}`).set(auth(u.token)).send({
      prototype: '', plan_date: '', owner_name: '', architect: '', engineer: '', store_number: '', build_type: '',
    }).expect(200);
    expect(cleared.body.bid).toMatchObject({ prototype: null, plan_date: null, owner_name: null, architect: null, engineer: null, store_number: null, build_type: null });
  });

  it('rejects a bad plan date or build type', async () => {
    if (!ok) return;
    const { app } = await import('../index');
    const u = await makeUser('estimator');
    const created = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `Fields ${Date.now()}`, gc: 'GC' }).expect(200);
    await request(app).patch(`/api/bids/${created.body.id}`).set(auth(u.token)).send({ plan_date: '9/22/2025' }).expect(400);
    await request(app).patch(`/api/bids/${created.body.id}`).set(auth(u.token)).send({ build_type: 'ground-up' }).expect(400);
  });
});
