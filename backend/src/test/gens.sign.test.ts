import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

describe('public sign route: initials', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  // POST /api/gens returns the created gen row directly (res.json(gen)), which
  // includes proposal_token since the column defaults to gen_random_uuid().
  async function createGen(token: string) {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Sign Test ${Date.now()}`, mfr: 'Kohler', model: '20RCA', kw: 20, amount: 15000 })
      .expect(200);
    return res.body as { id: string; proposal_token: string };
  }

  it('persists both signatureData and initialsData when both are posted', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).post(`/api/gens/p/${gen.proposal_token}/sign`)
      .send({ signatureData: 'data:sig1', initialsData: 'data:init1' })
      .expect(200);
    const { rows } = await pool.query(
      'SELECT signature_data, initials_data FROM generator_proposals WHERE id=$1', [gen.id]
    );
    expect(rows[0].signature_data).toBe('data:sig1');
    expect(rows[0].initials_data).toBe('data:init1');
  });

  it('signing with only signatureData succeeds and leaves initials_data null', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).post(`/api/gens/p/${gen.proposal_token}/sign`)
      .send({ signatureData: 'data:sig-only' })
      .expect(200);
    const { rows } = await pool.query(
      'SELECT signature_data, initials_data FROM generator_proposals WHERE id=$1', [gen.id]
    );
    expect(rows[0].signature_data).toBe('data:sig-only');
    expect(rows[0].initials_data).toBeNull();
  });

  it('a re-sign that omits initialsData does not clobber a previously stored value', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).post(`/api/gens/p/${gen.proposal_token}/sign`)
      .send({ signatureData: 'data:sig1', initialsData: 'data:init1' })
      .expect(200);
    // Stale-client re-sign: only signatureData in the body this time.
    await request(app).post(`/api/gens/p/${gen.proposal_token}/sign`)
      .send({ signatureData: 'data:sig2' })
      .expect(200);
    const { rows } = await pool.query(
      'SELECT signature_data, initials_data FROM generator_proposals WHERE id=$1', [gen.id]
    );
    expect(rows[0].signature_data).toBe('data:sig2');
    expect(rows[0].initials_data).toBe('data:init1');
  });

  it('the public GET returns initials_data via its SELECT *', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).post(`/api/gens/p/${gen.proposal_token}/sign`)
      .send({ signatureData: 'data:sig1', initialsData: 'data:init1' })
      .expect(200);
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    expect(res.body.initials_data).toBe('data:init1');
  });
});
