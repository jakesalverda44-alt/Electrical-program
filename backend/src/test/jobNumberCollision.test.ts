// Phase 4 Task 6.2 — same-day job_number collision (carried from the Phase 3
// review). Two bids generated the same day compute the identical
// JS.MMDDYYYY (jobNumber() is a pure function of today's date, nothing
// else) — on persist, the second one now gets suffixed -2, -3, ... (first
// free) instead of silently colliding. An existing/manually-entered
// job_number is never touched by this — only a freshly GENERATED one.
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

// Same gate-passing fixture bidStandardGeneration.test.ts uses (4 ECFECI
// mentions, correctly placed; no banned language/placeholders/sq-ft).
const CLEAN_AGENT4_OUTPUT = {
  sections: [
    { title: 'A. Service & Distribution', bullets: [
      'Service entrance assembly and MDP (ECFECI).',
      'Distribution gear (ECFECI): panels A, B.',
    ] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan.'] },
    { title: 'C. Lighting & Controls', bullets: [
      'Complete lighting package (ECFECI) — Southern Lighting Source.',
      'Controls & testing: occupancy sensors and photocells.',
    ] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: ['Site lighting per photometric plan.'] },
  ],
  exclusions: ['Painting and patching are excluded from this scope.'],
  fixture_types: ['A', 'AE'],
  allowances_bullets: ["160' allowance - service feeder from transformer secondary to MDP."],
  takeoff: [
    { name: 'Service & Distribution', items: [
      { item: '1.1', description: '800A service entrance assembly (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6 Riser Diagram', conf: 'VERIFIED' },
    ] },
    { name: 'Interior Lighting', items: [
      { item: '2.1', description: 'Type A troffer (ECFECI)', unit: 'EA', qty: 20, source: 'E2.0 Luminaire Schedule', conf: 'ASSUMED', furnish_by: 'APT (ECFECI)' },
    ] },
  ],
};

async function makeBidWithAgent4(token: string, name: string) {
  const bid = await request(app).post('/api/bids').set(auth(token))
    .send({
      name: `${name} ${Date.now()}`,
      gc: `JobNoCollision GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      loc: '1234 Main St, Eustis, FL',
    }).expect(200);
  const bidId = bid.body.id as string;
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent2_output, agent4_output, agent4_price, agent4_status)
     VALUES ($1,'{}',$2,248750,'complete')`,
    [bidId, JSON.stringify(CLEAN_AGENT4_OUTPUT)]
  );
  return bidId;
}

const JOB_NUMBER_RE = /^JS\.\d{8}(-\d+)?$/;

describe('job_number same-day collision', () => {
  // Assertions are deliberately relative (format + distinctness + shared
  // calendar-day base) rather than an exact predicted suffix — this test DB
  // accumulates bids with today's date across the whole suite run (it is
  // NOT reset per file), so a fresh bid's first-free suffix depends on how
  // much same-day pollution already exists, not just this test's own bids.
  // resolveUniqueJobNumber's exact "-2, -3, ... first free" behavior is
  // covered precisely, deterministically, by boilerplate.test.ts's pure
  // unit tests; this integration test proves the wiring, not the arithmetic.
  it('two bids generated the same day get distinct, correctly-formatted job numbers sharing the same calendar-day base', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidA = await makeBidWithAgent4(u.token, 'Collision A');
    const bidB = await makeBidWithAgent4(u.token, 'Collision B');

    await request(app).get(`/api/preconstruction/${bidA}/generate-docx`).set(auth(u.token)).expect(200);
    await request(app).get(`/api/preconstruction/${bidB}/generate-docx`).set(auth(u.token)).expect(200);

    const { rows } = await pool.query(
      `SELECT id, job_number FROM bids WHERE id = ANY($1::uuid[])`, [[bidA, bidB]]
    );
    const byId = Object.fromEntries(rows.map(r => [r.id, r.job_number]));
    expect(byId[bidA]).toMatch(JOB_NUMBER_RE);
    expect(byId[bidB]).toMatch(JOB_NUMBER_RE);
    expect(byId[bidA]).not.toBe(byId[bidB]);
    // Same base date (JS.MMDDYYYY prefix before any -N suffix).
    expect(byId[bidB].split('-')[0]).toBe(byId[bidA].split('-')[0]);
  });

  it('an explicit manually-entered job_number survives generation untouched (never suffixed, never overwritten)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await makeBidWithAgent4(u.token, 'Manual');
    await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token))
      .send({ job_number: 'JS.CUSTOM-001' }).expect(200);

    await request(app).get(`/api/preconstruction/${bidId}/generate-docx`).set(auth(u.token)).expect(200);

    const { rows } = await pool.query('SELECT job_number FROM bids WHERE id=$1', [bidId]);
    expect(rows[0].job_number).toBe('JS.CUSTOM-001');
  });

  it('a manual value that collides with another bid is left alone too — only generated numbers get suffixed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidA = await makeBidWithAgent4(u.token, 'ManualCollideA');
    const bidB = await makeBidWithAgent4(u.token, 'ManualCollideB');
    await request(app).patch(`/api/bids/${bidA}`).set(auth(u.token)).send({ job_number: 'JS.SHARED-1' }).expect(200);
    await request(app).patch(`/api/bids/${bidB}`).set(auth(u.token)).send({ job_number: 'JS.SHARED-1' }).expect(200);

    await request(app).get(`/api/preconstruction/${bidA}/generate-docx`).set(auth(u.token)).expect(200);
    await request(app).get(`/api/preconstruction/${bidB}/generate-docx`).set(auth(u.token)).expect(200);

    const { rows } = await pool.query(`SELECT id, job_number FROM bids WHERE id = ANY($1::uuid[])`, [[bidA, bidB]]);
    for (const row of rows) expect(row.job_number).toBe('JS.SHARED-1');
  });
});
