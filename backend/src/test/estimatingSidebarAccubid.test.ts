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

describe('C6 — per-bid "use the default equipment / GE" opt-in', () => {
  async function oldBidWithLines(stage = 'due') {
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `C6 ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    // A bid from before migration 151: fix round BL-1 marked it "handled".
    await pool.query(`INSERT INTO est_bid_cost_line_seeds (bid_id, kind) VALUES ($1,'equipment'),($1,'general_expense')`, [bidId]);
    const settings = { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3, floors_above_2: 0, pricing_mode: 'accubid' };
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Hand-priced work', qty: 1, unit: 'EA', material_unit_override: 1000, labor_hours_override: 150, source: 'manual', evidence_note: 'Priced by hand from the plans' }],
      settings,
    }).expect(200);
    await pool.query('UPDATE bids SET stage = $1 WHERE id = $2', [stage, bidId]);
    return { app, u, bidId };
  }

  it('saving never adds them; the panel offers them; the button adds only the kind asked for and re-prices', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await oldBidWithLines();
    const { rows: none } = await pool.query('SELECT count(*)::int AS n FROM est_bid_cost_lines WHERE bid_id = $1', [bidId]);
    expect(none[0].n).toBe(0);
    const panel = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(panel.body.defaultOptIns.sort()).toEqual(['equipment', 'general_expense']);
    const amountBefore = Number((await pool.query('SELECT amount FROM bids WHERE id = $1', [bidId])).rows[0].amount);

    const used = await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines/use-defaults`).set(auth(u.token)).send({ kinds: ['equipment'] }).expect(200);
    expect(used.body.seeded).toEqual(['equipment']);
    expect(used.body.defaultOptIns).toEqual(['general_expense']);
    const eq = (used.body.costLines as Array<{ kind: string; amount: number; autoDefault: boolean }>).filter(c => c.kind === 'equipment');
    expect(eq).toHaveLength(1);
    expect(eq[0].amount).toBeCloseTo(Math.max(890, 7.3 * 150), 2);
    const amountAfter = Number((await pool.query('SELECT amount FROM bids WHERE id = $1', [bidId])).rows[0].amount);
    expect(amountAfter).toBeGreaterThan(amountBefore);

    // Asked again: nothing to add (409), nothing changes.
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines/use-defaults`).set(auth(u.token)).send({ kinds: ['equipment'] }).expect(409);
  });

  it('a submitted bid is never offered them, and the button refuses (its price never moves)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await oldBidWithLines('submitted');
    const panel = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(panel.body.defaultOptIns).toEqual([]);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines/use-defaults`).set(auth(u.token)).send({}).expect(409);
  });
});

describe('decision 3 — a quote flagged as the fixture package', () => {
  it('fixture lines drop their material (labor kept) while the flag is on; off again restores it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seededBid();
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({ lines: got.body.lines, settings: got.body.settings }).expect(200);
    const base = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body;

    const q = await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token))
      .send({ description: 'Lighting package — Southern Lighting Source', amount: 3795, taxPct: 7, markupPct: 10, status: 'firm', fixturePackage: true }).expect(200);
    expect(q.body.fixturePackage).toBe(true);
    const on = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body;
    expect(on.totalHours).toBeCloseTo(base.totalHours, 6);
    expect(on.recap.materialTotal).toBeLessThan(base.recap.materialTotal - 1000);
    const phaseA = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.recap;
    const troffer = phaseA.lines.find((l: { description: string }) => /2X4 LED recessed troffer/.test(l.description));
    expect(troffer.materialExt).toBe(0);
    expect(troffer.hoursExt).toBeGreaterThan(0);

    await request(app).put(`/api/estimating/${bidId}/accubid/quotes/${q.body.id}`).set(auth(u.token)).send({ fixturePackage: false }).expect(200);
    const off = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body;
    expect(off.recap.materialTotal).toBeCloseTo(base.recap.materialTotal, 2);
    await request(app).put(`/api/estimating/${bidId}/accubid/quotes/${q.body.id}`).set(auth(u.token)).send({ fixturePackage: 'yes' }).expect(400);
  });
});
