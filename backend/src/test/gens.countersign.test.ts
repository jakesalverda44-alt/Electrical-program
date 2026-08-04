import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

describe('POST /gens/:id/countersign', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  // POST /api/gens returns the created gen row directly (res.json(gen)).
  async function createGen(token: string, amount = 15000) {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Countersign Test ${Date.now()}_${Math.random()}`, mfr: 'Kohler', model: '20RCA', kw: 20, amount })
      .expect(200);
    return res.body as { id: string; customer: string };
  }

  // The public sign endpoint is the real path to signed_at, but a direct SQL
  // stamp is equivalent here and keeps these tests focused on countersigning.
  async function markSigned(id: string) {
    await pool.query(
      `UPDATE generator_proposals SET signed_at = now(), signature_data = 'data:customer-sig', stage='signed' WHERE id=$1`,
      [id]
    );
  }

  async function setSignature(userId: string, sig: string | null) {
    await pool.query('UPDATE users SET signature_data=$1 WHERE id=$2', [sig, userId]);
  }

  it('rejects a proposal the customer has not signed (409)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await setSignature(u.id, 'data:apt-sig');
    const gen = await createGen(u.token);
    const res = await request(app).post(`/api/gens/${gen.id}/countersign`).set(auth(u.token)).expect(409);
    expect(res.body.error).toMatch(/not been signed/i);
  });

  it('rejects a caller with no saved signature (400)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    // Fresh test user never got a signature_data value set.
    const gen = await createGen(u.token);
    await markSigned(gen.id);
    const res = await request(app).post(`/api/gens/${gen.id}/countersign`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/signature/i);
  });

  it('is idempotent — a second call neither re-stamps nor re-awards', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await setSignature(u.id, 'data:apt-sig');
    const gen = await createGen(u.token);
    await markSigned(gen.id);

    const first = await request(app).post(`/api/gens/${gen.id}/countersign`).set(auth(u.token)).expect(200);
    expect(first.body.gen.countersigned_at).toBeTruthy();
    expect(first.body.wonJob).toBeTruthy();

    const second = await request(app).post(`/api/gens/${gen.id}/countersign`).set(auth(u.token)).expect(200);
    expect(second.body.gen.countersigned_at).toBe(first.body.gen.countersigned_at);
    // Idempotent no-op: no new award happened, so nothing to report.
    expect(second.body.wonJob).toBeNull();
    expect(second.body.superseded).toEqual([]);

    const { rows: wj } = await pool.query('SELECT * FROM won_jobs WHERE proposal_id=$1', [gen.id]);
    expect(wj).toHaveLength(1);
  });

  it('awards exactly once: one won_jobs row, project created, siblings superseded', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await setSignature(u.id, 'data:apt-sig');
    const winner = await createGen(u.token, 20000);
    const sibling = await createGen(u.token, 18000);
    const groupId = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await pool.query('UPDATE generator_proposals SET group_id=$1 WHERE id = ANY($2::uuid[])', [groupId, [winner.id, sibling.id]]);
    await markSigned(winner.id);

    const res = await request(app).post(`/api/gens/${winner.id}/countersign`).set(auth(u.token)).expect(200);
    expect(res.body.gen.stage).toBe('awarded');
    expect(res.body.wonJob).toBeTruthy();
    expect(res.body.superseded).toHaveLength(1);
    expect(res.body.superseded[0].id).toBe(sibling.id);

    const { rows: wj } = await pool.query('SELECT * FROM won_jobs WHERE proposal_id=$1', [winner.id]);
    expect(wj).toHaveLength(1);

    const { rows: proj } = await pool.query('SELECT * FROM projects WHERE id=$1', [winner.id]);
    expect(proj).toHaveLength(1);

    const { rows: siblingRow } = await pool.query('SELECT stage FROM generator_proposals WHERE id=$1', [sibling.id]);
    expect(siblingRow[0].stage).toBe('superseded');
  });

  it('awardGen produces identical won_jobs results whether reached by stage drag or by countersign', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    await setSignature(u.id, 'data:apt-sig');

    const dragged = await createGen(u.token, 12345);
    await request(app).patch(`/api/gens/${dragged.id}/stage`).set(auth(u.token)).send({ stage: 'awarded' }).expect(200);

    const countersigned = await createGen(u.token, 12345);
    await markSigned(countersigned.id);
    await request(app).post(`/api/gens/${countersigned.id}/countersign`).set(auth(u.token)).expect(200);

    const { rows: wjDragged } = await pool.query('SELECT value, commission_rate, commission_amount, commission_status FROM won_jobs WHERE proposal_id=$1', [dragged.id]);
    const { rows: wjCountersigned } = await pool.query('SELECT value, commission_rate, commission_amount, commission_status FROM won_jobs WHERE proposal_id=$1', [countersigned.id]);
    expect(wjCountersigned[0]).toEqual(wjDragged[0]);

    const { rows: projDragged } = await pool.query('SELECT source_type, status FROM projects WHERE id=$1', [dragged.id]);
    const { rows: projCountersigned } = await pool.query('SELECT source_type, status FROM projects WHERE id=$1', [countersigned.id]);
    expect(projCountersigned[0]).toEqual(projDragged[0]);
  });
});

describe('PATCH /users/me/signature', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  it('saves the caller\'s own signature', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    const res = await request(app).patch('/api/users/me/signature').set(auth(u.token))
      .send({ signature_data: 'data:my-sig' }).expect(200);
    expect(res.body.signature_data).toBe('data:my-sig');
    const { rows } = await pool.query('SELECT signature_data FROM users WHERE id=$1', [u.id]);
    expect(rows[0].signature_data).toBe('data:my-sig');
  });

  it('rejects an empty signature', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('salesperson');
    await request(app).patch('/api/users/me/signature').set(auth(u.token))
      .send({ signature_data: '' }).expect(400);
  });
});
