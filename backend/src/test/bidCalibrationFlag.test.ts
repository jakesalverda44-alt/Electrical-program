// Accuracy round — Jake's decision 4: the per-bid "Calibration job" flag
// (bids.calibration, migration 160). A calibration bid gets the default
// equipment / GE lines (and every other generated row) whatever its stage;
// every other submitted bid is untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { isEstimatingBid } from '../estimating/costLineDefaults';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const SETTINGS = { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 };
async function makeBid(app: import('express').Express, user: TestUser) {
  const res = await request(app).post('/api/bids').set(auth(user.token)).send({ name: `Calib ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  return res.body.id as string;
}
async function saveHours(app: import('express').Express, user: TestUser, bidId: string, hours: number) {
  await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({
    lines: [{ category: 'Branch Power', description: 'Labor bucket', qty: 1, unit: 'EA', material_unit_override: 0, labor_hours_override: hours, source: 'manual', evidence_note: 'Test labor bucket.' }],
    settings: SETTINGS,
  }).expect(200);
}

describe('calibration flag', () => {
  it('isEstimatingBid: due, or calibration at any stage', () => {
    expect([isEstimatingBid({ stage: 'due' }), isEstimatingBid({ stage: 'submitted' }), isEstimatingBid({ stage: 'submitted', calibration: true }), isEstimatingBid({ stage: 'awarded', calibration: false }), isEstimatingBid(null)])
      .toEqual([true, false, true, false, false]);
  });

  it('PATCH /api/bids/:id accepts calibration true/false only; defaults false', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { rows } = await pool.query('SELECT calibration FROM bids WHERE id = $1', [bidId]);
    expect(rows[0].calibration).toBe(false);
    await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token)).send({ calibration: 'yes' }).expect(400);
    const res = await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token)).send({ calibration: true }).expect(200);
    expect(res.body.calibration ?? res.body.bid?.calibration).toBe(true);
  });

  it('a submitted bid gets no default lines; flagged a calibration job, it does', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await pool.query(`UPDATE bids SET stage = 'submitted' WHERE id = $1`, [bidId]);
    await saveHours(app, u, bidId, 400);
    let lines = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body.costLines;
    expect(lines).toEqual([]);
    await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token)).send({ calibration: true }).expect(200);
    await saveHours(app, u, bidId, 400);
    lines = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body.costLines;
    expect(lines.map((l: { kind: string }) => l.kind).sort()).toEqual(['equipment', 'general_expense']);
  });
});
