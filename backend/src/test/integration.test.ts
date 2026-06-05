import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

// These hit a real Postgres via supertest. They run in CI (postgres service)
// and skip automatically when no database is reachable locally.
let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('authorization (integration)', () => {
  it('rejects unauthenticated requests', async (ctx) => {
    if (!ok) return ctx.skip();
    await request(app).get('/api/users').expect(401);
  });

  it('blocks a salesperson from creating users (C1)', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).post('/api/users').set(auth(sales.token))
      .send({ name: 'X', email: `x${Date.now()}@t.local`, password: 'password1', role: 'owner' })
      .expect(403);
  });

  it('lets an admin create users', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const res = await request(app).post('/api/users').set(auth(admin.token))
      .send({ name: 'New', email: `new${Date.now()}@t.local`, password: 'password1', role: 'salesperson' })
      .expect(200);
    expect(res.body.role).toBe('salesperson');
  });

  it('blocks a salesperson from writing settings (C2)', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).put('/api/settings').set(auth(sales.token)).send({ company_name: 'Hacked' }).expect(403);
  });

  it('scopes a salesperson to their own bids', async (ctx) => {
    if (!ok) return ctx.skip();
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    await request(app).post('/api/bids').set(auth(a.token)).send({ name: `A ${Date.now()}`, gc: 'GC A' }).expect(200);
    await request(app).post('/api/bids').set(auth(b.token)).send({ name: `B ${Date.now()}`, gc: 'GC B' }).expect(200);
    const aList = await request(app).get('/api/bids').set(auth(a.token)).expect(200);
    expect(aList.body.every((x: { salesperson_id: string }) => x.salesperson_id === a.id)).toBe(true);
    expect(aList.body.some((x: { salesperson_id: string }) => x.salesperson_id === b.id)).toBe(false);
  });

  it('forbids a salesperson from deleting a bid (N1)', async (ctx) => {
    if (!ok) return ctx.skip();
    const a = await makeUser('salesperson');
    const created = await request(app).post('/api/bids').set(auth(a.token)).send({ name: `D ${Date.now()}`, gc: 'GC' }).expect(200);
    await request(app).delete(`/api/bids/${created.body.id}`).set(auth(a.token)).expect(403);
  });
});

describe('soft-delete & audit (integration)', () => {
  it('soft-deletes a bid, hides it, shows it in trash, audits it, and restores it', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    const created = await request(app).post('/api/bids').set(auth(admin.token)).send({ name: `SD ${Date.now()}`, gc: 'GC SD' }).expect(200);
    const id = created.body.id as string;

    await request(app).delete(`/api/bids/${id}`).set(auth(admin.token)).expect(200);

    const list = await request(app).get('/api/bids').set(auth(admin.token)).expect(200);
    expect(list.body.some((b: { id: string }) => b.id === id)).toBe(false);

    const trash = await request(app).get('/api/admin/trash').set(auth(admin.token)).expect(200);
    expect(trash.body.bids.some((b: { id: string }) => b.id === id)).toBe(true);

    const audit = await pool.query(`SELECT action FROM audit_log WHERE entity_type='bid' AND entity_id=$1`, [id]);
    expect(audit.rows.some((r: { action: string }) => r.action === 'delete')).toBe(true);

    await request(app).post(`/api/bids/${id}/restore`).set(auth(admin.token)).expect(200);
    const list2 = await request(app).get('/api/bids').set(auth(admin.token)).expect(200);
    expect(list2.body.some((b: { id: string }) => b.id === id)).toBe(true);
  });

  it('writes an audit entry when an admin updates settings', async (ctx) => {
    if (!ok) return ctx.skip();
    const admin = await makeUser('owner');
    await request(app).put('/api/settings').set(auth(admin.token)).send({ company_name: `Co ${Date.now()}` }).expect(200);
    const audit = await pool.query(`SELECT 1 FROM audit_log WHERE entity_type='settings' ORDER BY created_at DESC LIMIT 1`);
    expect(audit.rows.length).toBe(1);
  });

  it('blocks a non-admin from the trash and audit endpoints', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).get('/api/admin/trash').set(auth(sales.token)).expect(403);
    await request(app).get('/api/admin/audit').set(auth(sales.token)).expect(403);
  });
});
