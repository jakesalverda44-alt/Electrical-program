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

describe('object-level authorization — IDOR fixes (integration)', () => {
  it("forbids a salesperson from reading another rep's bid estimate", async (ctx) => {
    if (!ok) return ctx.skip();
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    const bid = await request(app).post('/api/bids').set(auth(b.token))
      .send({ name: `EST ${Date.now()}`, gc: 'GC' }).expect(200);
    await request(app).get(`/api/estimates/${bid.body.id}`).set(auth(a.token)).expect(403);
    // The owner (b) can still read it.
    await request(app).get(`/api/estimates/${bid.body.id}`).set(auth(b.token)).expect(200);
  });

  it("forbids a salesperson from reading another rep's preconstruction data", async (ctx) => {
    if (!ok) return ctx.skip();
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    const bid = await request(app).post('/api/bids').set(auth(b.token))
      .send({ name: `PRE ${Date.now()}`, gc: 'GC' }).expect(200);
    await request(app).get(`/api/preconstruction/intelligence/${bid.body.id}`).set(auth(a.token)).expect(403);
  });

  it('lets a manager read any bid estimate (sees all)', async (ctx) => {
    if (!ok) return ctx.skip();
    const b = await makeUser('salesperson');
    const mgr = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(b.token))
      .send({ name: `MGR ${Date.now()}`, gc: 'GC' }).expect(200);
    await request(app).get(`/api/estimates/${bid.body.id}`).set(auth(mgr.token)).expect(200);
  });
});

describe('input validation — 400 not 500 (integration)', () => {
  it('rejects a bad enum value on lead create with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).post('/api/leads').set(auth(sales.token))
      .send({ name: 'Bad Enum', source: 'not-a-real-source' }).expect(400);
  });

  it('rejects a non-existent salesperson_id (valid UUID, missing FK) with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).post('/api/leads').set(auth(sales.token))
      .send({ name: 'Bad FK', salesperson_id: '00000000-0000-0000-0000-0000000000ff' }).expect(400);
  });

  it('accepts a valid lead create', async (ctx) => {
    if (!ok) return ctx.skip();
    const sales = await makeUser('salesperson');
    await request(app).post('/api/leads').set(auth(sales.token))
      .send({ name: `Good ${Date.now()}`, source: 'web', interest_level: 'warm' }).expect(201);
  });
});

describe('lead auto follow-ups (integration)', () => {
  // Helper: poll the tasks list (scheduleFollowUpTask is fire-and-forget) until a
  // lead-linked task matching `match` appears, or the budget runs out.
  const leadTasks = async (
    token: string, leadId: string,
    match: (t: { title: string }) => boolean = () => true, tries = 15,
  ) => {
    for (let i = 0; i < tries; i++) {
      const { body } = await request(app).get('/api/tasks').set(auth(token));
      const found = (body as { linked_id: string; linked_type: string; title: string }[])
        .filter(t => t.linked_id === leadId && t.linked_type === 'lead');
      if (found.some(match)) return found;
      await new Promise(r => setTimeout(r, 100));
    }
    return [];
  };

  it('creates a real, visible follow-up task when a stage is entered', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('owner');
    const created = await request(app).post('/api/leads').set(auth(owner.token))
      .send({ name: `AF ${Date.now()}`, phone: '555' }).expect(201);
    const id = created.body.id as string;

    await request(app).patch(`/api/leads/${id}`).set(auth(owner.token)).send({ stage: 'quoted' }).expect(200);
    const tasks = await leadTasks(owner.token, id, t => /Check in on quote/.test(t.title));
    expect(tasks.some((t: { title: string }) => /Check in on quote/.test(t.title))).toBe(true);
  });

  it("assigns the follow-up to the rep so it surfaces in their Follow-ups view", async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');
    // Lead assigned to the rep (so the rep is allowed to advance it).
    const created = await request(app).post('/api/leads').set(auth(rep.token))
      .send({ name: `RF ${Date.now()}`, phone: '555', salesperson_id: rep.id, salesperson_name: rep.name }).expect(201);
    const id = created.body.id as string;

    await request(app).patch(`/api/leads/${id}`).set(auth(rep.token)).send({ stage: 'contacted' }).expect(200);
    const tasks = await leadTasks(rep.token, id, t => /Re-contact/.test(t.title));
    // The restricted rep can SEE the task — proving it was assigned to them, not left null.
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('does not stack duplicate follow-ups when a lead re-enters a stage', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('owner');
    const created = await request(app).post('/api/leads').set(auth(owner.token))
      .send({ name: `DUP ${Date.now()}`, phone: '555' }).expect(201);
    const id = created.body.id as string;

    await request(app).patch(`/api/leads/${id}`).set(auth(owner.token)).send({ stage: 'contacted' }).expect(200);
    await leadTasks(owner.token, id);
    await request(app).patch(`/api/leads/${id}`).set(auth(owner.token)).send({ stage: 'new' }).expect(200);
    await request(app).patch(`/api/leads/${id}`).set(auth(owner.token)).send({ stage: 'contacted' }).expect(200);
    await new Promise(r => setTimeout(r, 400));

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM tasks WHERE linked_id=$1 AND title LIKE 'Re-contact%' AND status='open'`, [id]
    );
    expect(rows[0].n).toBe(1);
  });
});
