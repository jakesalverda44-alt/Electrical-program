// Accuracy round C7 — GET /api/estimating/:bidId/feeders on the real
// Kissimmee 0930 export: every feeder with its math / tier / holds; an
// estimator pin turns a hold into an estimate with a route on its sheet.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { loadKissimmeeLive0930 } from './fixtures/realrun/live0930';
import { SCRIPTED_0930 } from './fixtures/realrun/feeders0930';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const live = loadKissimmeeLive0930();
const OLD_DOC = '97025d73-1630-49f9-bd7a-03d22c2e0e1b';

async function seed(app: import('express').Express, token: string) {
  const res = await request(app).post('/api/bids').set(auth(token)).send({ name: `Feeders ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = res.body.id as string;
  const docId = randomUUID();
  await pool.query(`INSERT INTO documents (id, linked_id, name, uploaded_by) VALUES ($1,$2,$3,'test')`, [docId, bidId, '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf']);
  const count = JSON.parse(JSON.stringify(live.countResult).split(OLD_DOC).join(docId));
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, status) VALUES ($1,$2,$3,$4,'agent2_complete')`,
    [bidId, JSON.stringify(live.agent1), '```json\n' + JSON.stringify(live.agent2) + '\n```', JSON.stringify(count)],
  );
  await pool.query('UPDATE bids SET sq_ft = 7147 WHERE id = $1', [bidId]);
  return { bidId, docId };
}

describe('C7 — GET /feeders', () => {
  it('lists the six Kissimmee feeders; without pins every one is a specific hold', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const { bidId } = await seed(app, u.token);
    const body = (await request(app).get(`/api/estimating/${bidId}/feeders`).set(auth(u.token)).expect(200)).body;
    expect([body.priced, body.stage, body.calibration, body.slackPct]).toEqual([true, 'due', false, 10]);
    expect(body.edges.map((e: { id: string }) => e.id).sort()).toEqual(['DISCON A→PANEL A', 'DISCON B→PANEL B', 'METER→WIREWAY', 'PANEL B→RTU-1', 'PANEL B→RTU-2', 'XFMR→METER']);
    expect(body.edges.every((e: { status: string }) => e.status === 'hold')).toBe(true);
    const rtu = body.edges.find((e: { id: string }) => e.id === 'PANEL B→RTU-1');
    expect(rtu.endpoints[0]).toMatchObject({ node: 'PANEL B', located: false, hold: 'Pin PANEL B on the Plans view' });
    expect(rtu.endpoints[1]).toMatchObject({ node: 'RTU-1', located: true, confidence: 'interchangeable' });
    expect(body.taps.length).toBe(2);
    expect(body.summary).toEqual({ suggested: 0, confirmed: 0, holds: 6 });
  });

  it('SCRIPTED pin "Panel B" on E-1 → both RTU feeders estimated, with a route on E-1', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const { bidId, docId } = await seed(app, u.token);
    const p = SCRIPTED_0930.pins.find(x => x.label === 'Panel B')!;
    await pool.query(`INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status, label, created_by) VALUES ($1,$2,48,'count',$3,'confirmed','Panel B','test')`,
      [bidId, docId, JSON.stringify([{ x: p.x, y: p.y }])]);
    const body = (await request(app).get(`/api/estimating/${bidId}/feeders`).set(auth(u.token)).expect(200)).body;
    const rtu = body.edges.find((e: { id: string }) => e.id === 'PANEL B→RTU-1');
    expect([rtu.status, rtu.tier, rtu.lengthFt]).toEqual(['estimated', 'suggested', 121]);
    expect(rtu.route).toMatchObject({ documentId: docId, pageIndex: 48 });
    expect(rtu.route.points.length).toBe(3);
    expect(rtu.math).toMatch(/PANEL B \(E-1, pinned by the estimator \("Panel B"\)\)/);
    expect(body.summary.suggested).toBe(2);
  });

  it('another salesperson\'s bid is not readable', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const a = await makeUser('salesperson');
    const b = await makeUser('salesperson');
    const { bidId } = await seed(app, b.token);
    await request(app).get(`/api/estimating/${bidId}/feeders`).set(auth(a.token)).expect(403);
  });
});
