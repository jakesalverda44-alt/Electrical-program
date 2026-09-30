// Estimating-refresh fix — a quote / cost-line / settings save on a bid that
// only has the UNSAVED takeoff proposal must not write bids.amount or
// bid_estimates (they would be priced from zero saved lines). Once lines are
// saved the old behavior (re-persist the price after every edit) is unchanged.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/estimating/price-accuracy/36th-street-run-2026-09-29b.json'), 'utf8'));

async function seededBid() {
  const { app } = await import('../index');
  const u = await makeUser('owner');
  const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `NoWrite ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = bid.body.id as string;
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, review_items, review_status, status)
     VALUES ($1,$2,$3,$4,$5,'needs_review','agent2_complete')`,
    [bidId, JSON.stringify(run.agent1), '```json\n' + JSON.stringify(run.agent2) + '\n```', JSON.stringify(run.count_result), JSON.stringify(run.review_items)],
  );
  return { app, u, bidId };
}

const amountOf = async (bidId: string) => (await pool.query('SELECT amount FROM bids WHERE id = $1', [bidId])).rows[0].amount;
const estimateRows = async (bidId: string) => (await pool.query('SELECT count(*)::int AS n FROM bid_estimates WHERE bid_id = $1', [bidId])).rows[0].n;

describe('unsaved proposal — quote / cost line saves write no price', () => {
  it('leaves bids.amount and bid_estimates alone and the GET recap prices the proposal', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seededBid();
    const before = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(before.body.proposed).toBe(true);
    const proposalPrice = before.body.recap.sellingPrice as number;
    expect(proposalPrice).toBeGreaterThan(5000);
    const amountBefore = await amountOf(bidId);

    await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token)).send({ description: 'Fixture package', amount: 4470, markupPct: 18, status: 'firm' }).expect(200);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({ kind: 'equipment', description: 'Scissor lift', amount: 1200 }).expect(200);

    expect(await estimateRows(bidId)).toBe(0);
    expect(await amountOf(bidId)).toEqual(amountBefore);
    // No default cost lines were seeded by the zero-lines recap.
    const { rows: cl } = await pool.query('SELECT kind FROM est_bid_cost_lines WHERE bid_id = $1', [bidId]);
    expect(cl.map(c => c.kind)).toEqual(['equipment']);

    // The settings save returns the recap on the proposed lines, still no write.
    const put = await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send(before.body.settings).expect(200);
    expect(put.body.totalHours).toBeCloseTo(before.body.totalHours, 6);
    expect(put.body.recap.sellingPrice).toBeGreaterThan(proposalPrice);
    expect(await estimateRows(bidId)).toBe(0);
    expect(await amountOf(bidId)).toEqual(amountBefore);
  });

  it('with saved lines the price is still re-persisted after a quote', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seededBid();
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({ lines: got.body.lines, settings: got.body.settings }).expect(200);
    const saved = Number(await amountOf(bidId));
    expect(saved).toBeGreaterThan(0);
    await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token)).send({ description: 'Fixture package', amount: 4470, markupPct: 18, status: 'firm' }).expect(200);
    const after = Number(await amountOf(bidId));
    expect(after).toBeGreaterThan(saved);
    const { rows } = await pool.query('SELECT grand_total FROM bid_estimates WHERE bid_id = $1', [bidId]);
    expect(Number(rows[0].grand_total)).toBeCloseTo(after, 2);
  });
});
