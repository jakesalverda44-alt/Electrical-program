// Price accuracy round, C4 — the sidebar follows the pricing mode: in
// Accubid mode GET / POST price carry the Accubid recap on the proposed
// (unsaved) lines too, so the selling price breakdown is never $0 before a
// save; Phase A mode carries none.
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
  const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `C4 ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = bid.body.id as string;
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, review_items, review_status, status)
     VALUES ($1,$2,$3,$4,$5,'needs_review','agent2_complete')`,
    [bidId, JSON.stringify(run.agent1), '```json\n' + JSON.stringify(run.agent2) + '\n```', JSON.stringify(run.count_result), JSON.stringify(run.review_items)],
  );
  return { app, u, bidId };
}

describe('C4 — the sidebar follows the pricing mode', () => {
  it('Accubid mode (a new bid): GET carries the Accubid recap on the proposed lines, with the default equipment / GE previewed', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seededBid();
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(got.body.proposed).toBe(true);
    expect(got.body.settings.pricing_mode).toBe('accubid');
    const acb = got.body.accubid;
    expect(acb.recap.sellingPrice).toBeGreaterThan(0);
    expect(acb.totalHours).toBeCloseTo(got.body.recap.totals.laborHours, 6);
    expect(acb.recap.materialTotal).toBeCloseTo(got.body.recap.totals.materialSubtotal, 2); // 0% tax default
    const previews = (acb.costLines as Array<{ kind: string; preview?: boolean; amount: number }>).filter(c => c.preview);
    expect(previews.map(c => c.kind).sort()).toEqual(['equipment', 'general_expense']);
    // Nothing was written.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM est_bid_cost_lines WHERE bid_id = $1', [bidId]);
    expect(rows[0].n).toBe(0);

    // The Accubid panel's own endpoint: never $0 before the first save.
    const panel = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(panel.body.proposed).toBe(true);
    expect(panel.body.recap.sellingPrice).toBeCloseTo(acb.recap.sellingPrice, 2);

    // Unsaved edits re-price live.
    const lines = got.body.lines.map((l: { description: string; qty: number }) => (l.description === 'Type A — 2X4 LED recessed troffer, Lithonia 2GTL4LP840' || /2X4 LED recessed troffer/.test(l.description) ? { ...l, qty: l.qty + 10 } : l));
    const priced = await request(app).post(`/api/estimating/${bidId}/price`).set(auth(u.token)).send({ lines, settings: got.body.settings }).expect(200);
    expect(priced.body.accubid.recap.sellingPrice).toBeGreaterThan(acb.recap.sellingPrice);

    // After a save, the saved recap equals what the sidebar showed for the same lines.
    const saved = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({ lines, settings: got.body.settings }).expect(200);
    expect(saved.status).toBe(200);
    const after = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(after.body.accubid.recap.sellingPrice).toBeCloseTo(priced.body.accubid.recap.sellingPrice, 2);
    expect(Number((await pool.query('SELECT amount FROM bids WHERE id = $1', [bidId])).rows[0].amount)).toBeCloseTo(priced.body.accubid.recap.sellingPrice, 2);
  });

  it('Phase A mode: no Accubid recap in the response', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seededBid();
    await pool.query(
      `INSERT INTO est_bid_settings (bid_id, labor_rate, factor_ids, material_tax_pct, small_tools_pct, supervision_pct, consumables_pct, overhead_pct, profit_pct, crew_size, floors_above_2, pricing_mode)
       VALUES ($1,40,$2,0,0,0,0,10,15,3,0,'phase_a')`, [bidId, []],
    );
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(got.body.accubid).toBeNull();
    const priced = await request(app).post(`/api/estimating/${bidId}/price`).set(auth(u.token)).send({ lines: got.body.lines, settings: got.body.settings }).expect(200);
    expect(priced.body.accubid).toBeNull();
  });
});
