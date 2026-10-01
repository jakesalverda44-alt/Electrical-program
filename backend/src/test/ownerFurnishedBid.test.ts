// Gap-closing T2 — resolveOptionsForBid: owner-furnished pricing is applied only to a bid being estimated.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { createItem } from '../estimating/library';
import { computeRecapForBid, resolveOptionsForBid } from '../estimating/bidEstimate';
import { scriptedAccountTerms } from './fixtures/realrun/gapScripted';
import { loadKissimmeeLive0930 } from './fixtures/realrun/live0930';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
const SETTINGS = { labor_rate: 50, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 1 };

describe('owner-furnished gating', () => {
  it('a due bid with the AutoZone terms prices its panel labor only; submitted (not calibration) keeps the material; calibration drops it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const code = `T2-PNL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const pnl = await createItem({ code, name: `Panelboard, 225A MLO probe ${code}`, category: 'Service & Distribution', unit: 'EA', material_cost: 1450, labor_hours: 3.6 });
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `T2 ${code}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, account_terms) VALUES ($1, 'complete', $2)`, [bidId, JSON.stringify(scriptedAccountTerms('kissimmee', loadKissimmeeLive0930()))]);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Service & Distribution', description: 'Panels A & B', qty: 2, unit: 'EA', item_id: pnl.id, source: 'manual', evidence_note: 'T2 probe.' }], settings: SETTINGS,
    }).expect(200);
    const due = await computeRecapForBid(bidId);
    expect(due.totals.materialSubtotal).toBe(0);
    expect(due.lines[0].furnishedBy?.mode).toBe('labor_only');
    await pool.query(`UPDATE bids SET stage = 'submitted', submitted_at = now() WHERE id = $1`, [bidId]);
    expect((await resolveOptionsForBid(bidId)).ownerFurnished).toBeUndefined();
    expect((await computeRecapForBid(bidId)).totals.materialSubtotal).toBe(2900);
    await pool.query('UPDATE bids SET calibration = true WHERE id = $1', [bidId]);
    expect((await computeRecapForBid(bidId)).totals.materialSubtotal).toBe(0);
  });
});
