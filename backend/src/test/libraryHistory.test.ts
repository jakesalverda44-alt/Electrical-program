// Gap-closing T1 — migration 164's history triggers + getLibraryForBid: a submitted, non-calibration bid keeps
// its price through a library change; a due bid and a Calibration bid see the new units.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { createItem, updateItem, getLibraryForBid } from '../estimating/library';
import { computeRecapForBid } from '../estimating/bidEstimate';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
const SETTINGS = { labor_rate: 50, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 1 };

describe('library history (migration 164) and the as-of library', () => {
  it('a library edit writes the old row to history; the submitted bid prices as before, due / calibration bids price live', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const code = `T1-HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const it0 = await createItem({ code, name: `History probe ${code}`, category: 'Branch Power', unit: 'EA', material_cost: 10, labor_hours: 1 });
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `T1 ${code}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Probe', qty: 10, unit: 'EA', item_id: it0.id, source: 'manual', evidence_note: 'T1 probe line.' }], settings: SETTINGS,
    }).expect(200);
    await pool.query(`UPDATE bids SET stage = 'submitted', submitted_at = now() - interval '1 minute', calibration = false WHERE id = $1`, [bidId]);
    const before = await computeRecapForBid(bidId);
    expect(before.totals.laborHours).toBeCloseTo(10, 6);

    await updateItem(it0.id, { labor_hours: 2.5, material_cost: 40 });
    const { rows: hist } = await pool.query('SELECT labor_hours, material_cost, valid_until FROM est_item_history WHERE item_id = $1', [it0.id]);
    expect(hist.map(h => [Number(h.labor_hours), Number(h.material_cost)])).toEqual([[1, 10]]);

    const submitted = await computeRecapForBid(bidId);
    expect(submitted.totals.laborHours).toBeCloseTo(10, 6);
    expect(submitted.totals.grandTotal).toBe(before.totals.grandTotal);
    expect((await getLibraryForBid(bidId)).items.find(i => i.id === it0.id)!.labor_hours).toBe(1);

    await pool.query('UPDATE bids SET calibration = true WHERE id = $1', [bidId]);
    expect((await computeRecapForBid(bidId)).totals.laborHours).toBeCloseTo(25, 6);
    await pool.query(`UPDATE bids SET calibration = false, stage = 'due' WHERE id = $1`, [bidId]);
    expect((await computeRecapForBid(bidId)).totals.laborHours).toBeCloseTo(25, 6);
  });

  it('an item created after a bid was submitted is not in that bid\'s library; an update that changes nothing priced writes no history', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `T1b ${Date.now()}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query(`UPDATE bids SET stage = 'submitted', submitted_at = now() - interval '1 minute' WHERE id = $1`, [bidId]);
    const code = `T1-NEW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const it1 = await createItem({ code, name: `New ${code}`, category: 'Branch Power', unit: 'EA', material_cost: 1, labor_hours: 1 });
    expect((await getLibraryForBid(bidId)).items.some(i => i.id === it1.id)).toBe(false);
    await pool.query(`UPDATE bids SET stage = 'due' WHERE id = $1`, [bidId]);
    expect((await getLibraryForBid(bidId)).items.some(i => i.id === it1.id)).toBe(true);
    await pool.query('UPDATE est_items SET updated_at = now() WHERE id = $1', [it1.id]);
    const { rows } = await pool.query('SELECT 1 FROM est_item_history WHERE item_id = $1', [it1.id]);
    expect(rows).toEqual([]);
  });
});
