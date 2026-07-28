import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('bid brand capture', () => {
  it('POST /bids stores brand and lists it in meta/brands', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const res = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CW ${Date.now()}`, gc: 'Test GC', brand: "  Sonny's  " })
      .expect(200);
    expect(res.body.brand).toBe("Sonny's");
    const brands = await request(app).get('/api/bids/meta/brands').set(auth(u.token)).expect(200);
    expect(brands.body).toContain("Sonny's");
  });
});
