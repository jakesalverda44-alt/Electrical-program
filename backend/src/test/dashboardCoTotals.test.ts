// Audit batch 3, Task 4 (audit-data-perf.md #11) — dashboard.ts's bids query
// replaced a per-row correlated SUM(amount) subquery + a text/uuid mismatch
// join with a grouped CTE + a cast join. This proves the new query returns
// the identical co_approved_total/date_won values the OLD query would have,
// for a bid with two approved change orders (and a third, pending one that
// must NOT count), by running the exact pre-fix SQL text as a snapshot to
// compare the live route's response against.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

// Re-review non-blocker (c) — the malformed-proposal_id test below inserts a
// won_jobs row that no award/API flow would ever produce; nothing else in
// this file (or the app) would ever delete it, so it would otherwise sit in
// the test DB permanently across every future run.
const malformedProposalIds: string[] = [];
afterAll(async () => {
  if (!ok || !malformedProposalIds.length) return;
  await pool.query(`DELETE FROM won_jobs WHERE proposal_id = ANY($1)`, [malformedProposalIds]);
});

// pg parses `date`/`timestamptz` columns into JS Date objects; the HTTP
// response has already gone through JSON.stringify, which turns them into
// ISO strings. Normalize both sides the same way before comparing.
const isoOrNull = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

// Verbatim pre-fix query (dashboard.ts before Task 4), scoped to one bid id
// so it's cheap to run as a snapshot oracle without touching the whole table.
const OLD_QUERY = `
  SELECT b.*, COALESCE((SELECT SUM(amount) FROM project_change_orders WHERE project_id=b.id AND status='approved'),0) AS co_approved_total, wj.date_won
    FROM bids b
    LEFT JOIN won_jobs wj ON wj.proposal_id=b.id::text AND wj.deleted_at IS NULL
   WHERE b.id = $1`;

describe('GET /api/dashboard — bids co_approved_total (Task 4)', () => {
  it('matches the pre-fix query for a bid with two approved change orders and one pending one', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dash CO ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    // project_change_orders.project_id FKs to projects(id), and a projects row
    // only exists once a bid is awarded (utils/project.ts's ensureProject,
    // called on award — the project reuses the bid's own id). Seed it
    // directly rather than running the full award flow, which this test
    // isn't about.
    await pool.query(
      `INSERT INTO projects (id, source_type) VALUES ($1, 'elec')`, [bidId]
    );
    await pool.query(
      `INSERT INTO project_change_orders (project_id, number, description, amount, status) VALUES
        ($1, 1, 'CO 1', 1500.00, 'approved'),
        ($1, 2, 'CO 2', 2500.50, 'approved'),
        ($1, 3, 'CO 3 not approved', 9999.00, 'pending')`,
      [bidId]
    );

    const oldRow = (await pool.query(OLD_QUERY, [bidId])).rows[0];
    expect(Number(oldRow.co_approved_total)).toBe(4000.5); // sanity: only the two approved ones

    const res = await request(app).get('/api/dashboard').set(auth(u.token)).expect(200);
    const newRow = (res.body.bids as Array<{ id: string; co_approved_total: number; date_won: string | null }>)
      .find(b => b.id === bidId);
    expect(newRow).toBeTruthy();
    expect(Number(newRow!.co_approved_total)).toBe(Number(oldRow.co_approved_total));
    expect(newRow!.date_won).toBe(isoOrNull(oldRow.date_won));
  });

  it('matches the pre-fix query for a bid with an awarded won_jobs row (proposal_id join)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dash Won ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query(
      `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, date_won)
       VALUES ('IT Rep', 'Test Co', $1, 'Electrical', 50000, '2026-02-01')`,
      [bidId]
    );

    const oldRow = (await pool.query(OLD_QUERY, [bidId])).rows[0];
    expect(oldRow.date_won).not.toBeNull();

    const res = await request(app).get('/api/dashboard').set(auth(u.token)).expect(200);
    const newRow = (res.body.bids as Array<{ id: string; date_won: string | null }>)
      .find(b => b.id === bidId);
    expect(newRow).toBeTruthy();
    expect(newRow!.date_won).toBe(isoOrNull(oldRow.date_won));
  });

  it('a bid with no change orders and no won_jobs row still returns co_approved_total 0', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dash None ${Date.now()}`, gc: 'G' }).expect(200);
    const res = await request(app).get('/api/dashboard').set(auth(u.token)).expect(200);
    const row = (res.body.bids as Array<{ id: string; co_approved_total: number; date_won: string | null }>)
      .find(b => b.id === bid.body.id);
    expect(row).toBeTruthy();
    expect(Number(row!.co_approved_total)).toBe(0);
    expect(row!.date_won).toBeNull();
  });

  // Post-review hardening (5e) — proposal_id has no format constraint at the
  // schema level, so a malformed value must not throw a cast error and 500
  // the whole dashboard. It should just not match, same as any non-uuid
  // string does today.
  it('a won_jobs row with a malformed (non-uuid) proposal_id does not 500 the dashboard', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dash Malformed ${Date.now()}`, gc: 'G' }).expect(200);
    const malformedProposalId = `not-a-uuid-${Date.now()}`; // proposal_id is unique — must vary per run
    malformedProposalIds.push(malformedProposalId);
    await pool.query(
      `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, date_won)
       VALUES ('IT Rep', 'Test Co', $1, 'Electrical', 50000, '2026-02-01')`,
      [malformedProposalId]
    );

    const res = await request(app).get('/api/dashboard').set(auth(u.token)).expect(200);
    const row = (res.body.bids as Array<{ id: string; date_won: string | null }>)
      .find(b => b.id === bid.body.id);
    expect(row).toBeTruthy();
    expect(row!.date_won).toBeNull(); // no match, not a crash
  });
});
