// Audit batch 4, Task 2 (audit ux #5) — Undo on deletes.
//
// The three soft-delete restore routes (bids, generator_proposals, documents)
// used to be requireAdmin-only. They now also allow the user who deleted the
// row to restore it themselves, within a 10-minute window (migration 100
// added `deleted_by`; see middleware/auth.ts's `canRestore`). An admin can
// still restore anything, anytime, exactly as before.
//
// DELETE itself stays requireAdmin on all three routes (unchanged, out of
// this batch's scope) — so a non-admin "self restore" scenario is exercised
// here by writing deleted_at/deleted_by directly, the same shape an actual
// delete produces, rather than by relaxing who can delete.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('POST /bids/:id/restore — admin or the recent deleter', () => {
  it('lets the user who deleted it restore within the window, even as a non-admin', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const bid = await request(app).post('/api/bids').set(auth(deleter.token))
      .send({ name: `Restore ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    // Simulate the DELETE route's effect (which is itself requireAdmin) —
    // this is the row shape it leaves behind.
    await pool.query('UPDATE bids SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [id, deleter.id]);

    const restored = await request(app).post(`/api/bids/${id}/restore`).set(auth(deleter.token)).expect(200);
    expect(restored.body.id).toBe(id);
    expect(restored.body.deleted_at).toBeFalsy();
  });

  it('refuses a different non-admin user, even within the window', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const other = await makeUser('estimator');
    const bid = await request(app).post('/api/bids').set(auth(deleter.token))
      .send({ name: `Restore ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;
    await pool.query('UPDATE bids SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [id, deleter.id]);

    await request(app).post(`/api/bids/${id}/restore`).set(auth(other.token)).expect(403);
  });

  it('refuses the same user once the window has passed', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const bid = await request(app).post('/api/bids').set(auth(deleter.token))
      .send({ name: `Restore ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;
    await pool.query(
      "UPDATE bids SET deleted_at=now() - interval '11 minutes', deleted_by=$2 WHERE id=$1",
      [id, deleter.id]
    );

    await request(app).post(`/api/bids/${id}/restore`).set(auth(deleter.token)).expect(403);
  });

  it('still lets an admin restore anything, anytime, regardless of who deleted it', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const admin = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(deleter.token))
      .send({ name: `Restore ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;
    await pool.query(
      "UPDATE bids SET deleted_at=now() - interval '1 day', deleted_by=$2 WHERE id=$1",
      [id, deleter.id]
    );

    await request(app).post(`/api/bids/${id}/restore`).set(auth(admin.token)).expect(200);
  });
});

describe('POST /gens/:id/restore — admin or the recent deleter', () => {
  it('lets the user who deleted it restore within the window', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const gen = await request(app).post('/api/gens').set(auth(deleter.token))
      .send({ customer: `Restore Gen ${Date.now()}` }).expect(200);
    const id = gen.body.id as string;
    await pool.query('UPDATE generator_proposals SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [id, deleter.id]);

    const restored = await request(app).post(`/api/gens/${id}/restore`).set(auth(deleter.token)).expect(200);
    expect(restored.body.id).toBe(id);
  });

  it('refuses a non-deleter, non-admin user', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const other = await makeUser('estimator');
    const gen = await request(app).post('/api/gens').set(auth(deleter.token))
      .send({ customer: `Restore Gen ${Date.now()}` }).expect(200);
    const id = gen.body.id as string;
    await pool.query('UPDATE generator_proposals SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [id, deleter.id]);

    await request(app).post(`/api/gens/${id}/restore`).set(auth(other.token)).expect(403);
  });
});

describe('POST /documents/:id/restore — admin or the recent deleter', () => {
  it('lets the user who deleted it restore within the window', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const { rows } = await pool.query(
      `INSERT INTO documents (name, uploaded_by, deleted_at, deleted_by)
       VALUES ($1, $2, now(), $3) RETURNING id`,
      [`Test Doc ${Date.now()}.pdf`, deleter.name, deleter.id]
    );
    const id = rows[0].id as string;

    const restored = await request(app).post(`/api/documents/${id}/restore`).set(auth(deleter.token)).expect(200);
    expect(restored.body.id).toBe(id);
  });

  it('refuses a non-deleter, non-admin user', async (ctx) => {
    if (!ok) return ctx.skip();
    const deleter = await makeUser('estimator');
    const other = await makeUser('estimator');
    const { rows } = await pool.query(
      `INSERT INTO documents (name, uploaded_by, deleted_at, deleted_by)
       VALUES ($1, $2, now(), $3) RETURNING id`,
      [`Test Doc ${Date.now()}.pdf`, deleter.name, deleter.id]
    );
    const id = rows[0].id as string;

    await request(app).post(`/api/documents/${id}/restore`).set(auth(other.token)).expect(403);
  });

  it('404s on a document that is not in the Trash', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const { rows } = await pool.query(
      `INSERT INTO documents (name, uploaded_by) VALUES ($1, $2) RETURNING id`,
      [`Not Deleted ${Date.now()}.pdf`, u.name]
    );
    const id = rows[0].id as string;

    await request(app).post(`/api/documents/${id}/restore`).set(auth(u.token)).expect(404);
  });
});
