// Next round Part B, Task 2/3 — /api/estimating/:bidId/accubid routes: the
// recap, per-bid crew/OH/markup settings, quotes, equipment/GE lines and
// alternates, plus the Settings > per-GC overhead default table.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `AccubidRt ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC', ...extra })
    .expect(200);
  return res.body.id as string;
}

describe('GET /api/estimating/:bidId/accubid', () => {
  it('defaults a new bid to the 38% labor overhead / 20% markup / 18% quote-markup defaults (Decision 5)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const res = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(res.body.settings.laborOverheadPct).toBe(38);
    expect(res.body.settings.materialMarkupPct).toBe(20);
    expect(res.body.settings.laborMarkupPct).toBe(20);
    expect(res.body.settings.quoteMarkupDefaultPct).toBe(18);
    expect(res.body.recap.sellingPrice).toBe(0); // no lines yet
    expect(Number.isFinite(res.body.recap.sellingPrice)).toBe(true);
  });

  it('picks up a per-GC overhead default when one is set (Settings table)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const gc = `Test GC ${Date.now()}`;
    const bidId = await makeBid(app, owner, { gc });
    // POST /api/bids resolves the freeform GC text against the customer
    // table (dedup) — read back whatever canonical name it actually stored,
    // rather than assuming it's the raw input unchanged.
    const { rows } = await pool.query('SELECT gc FROM bids WHERE id=$1', [bidId]);
    const storedGc = rows[0].gc as string;
    await request(app).put(`/api/estimating/gc-overhead-defaults/${encodeURIComponent(storedGc)}`).set(auth(owner.token))
      .send({ overheadPct: 45 }).expect(200);
    const res = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(owner.token)).expect(200);
    expect(res.body.settings.laborOverheadPct).toBe(45);
  });
});

describe('PUT /api/estimating/:bidId/accubid/settings', () => {
  it('saves settings and recomputes bids.amount from the new recap', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    // Add a manual takeoff line with a known material cost so the recap has
    // something to price (routing through the normal save path).
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Manual material item', qty: 1, unit: 'EA', material_unit_override: 1000, labor_hours_override: 0, source: 'manual' }],
      settings: { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3, floors_above_2: 0 },
    }).expect(200);

    const res = await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send({
      shift: 'day', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 10, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    }).expect(200);

    // material 1000, no labor hours -> field labor 0; material markup 10% = 100; selling = 1000+100 = 1100
    expect(res.body.recap.sellingPrice).toBeCloseTo(1100, 2);

    const { rows } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    expect(Number(rows[0].amount)).toBeCloseTo(1100, 2);
  });

  it('rejects a negative percentage', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send({
      shift: 'day', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: -5, materialMarkupPct: 10, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    }).expect(400);
  });
});

describe('Quotes / cost lines / alternates CRUD', () => {
  it('a budget-pending quote surfaces on the recap and blocks send', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    const created = await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token)).send({
      description: 'Switchgear', amount: 5000, markupPct: 18, status: 'budget_pending',
    }).expect(200);
    expect(created.body.status).toBe('budget_pending');

    const recap = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(recap.body.recap.blocksSend).toBe(true);
    expect(recap.body.recap.budgetPendingQuotes).toHaveLength(1);

    await request(app).put(`/api/estimating/${bidId}/accubid/quotes/${created.body.id}`).set(auth(u.token)).send({ status: 'firm' }).expect(200);
    const recap2 = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(recap2.body.recap.blocksSend).toBe(false);

    await request(app).delete(`/api/estimating/${bidId}/accubid/quotes/${created.body.id}`).set(auth(u.token)).expect(204);
  });

  it('equipment and general expenses lines add to the recap', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({
      kind: 'equipment', description: 'Scissor lift', amount: 500,
    }).expect(200);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({
      kind: 'general_expense', description: 'Permits', amount: 200,
    }).expect(200);
    const recap = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(recap.body.costLines).toHaveLength(2);
    expect(recap.body.recap.primeCost).toBeGreaterThanOrEqual(700);
  });

  it('alternates never change the recap\'s selling price (printed separately)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const before = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    await request(app).post(`/api/estimating/${bidId}/accubid/alternates`).set(auth(u.token)).send({
      kind: 'deduct', description: 'Deduct if existing fixtures stay', amount: 1830,
    }).expect(200);
    const after = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(after.body.alternates).toHaveLength(1);
    expect(after.body.recap.sellingPrice).toBe(before.body.recap.sellingPrice);
  });

  it('a non-admin cannot set a GC overhead default; an admin can', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).put(`/api/estimating/gc-overhead-defaults/${encodeURIComponent('Some GC')}`).set(auth(estimator.token))
      .send({ overheadPct: 40 }).expect(403);
    const owner = await makeUser('owner');
    await request(app).put(`/api/estimating/gc-overhead-defaults/${encodeURIComponent('Some GC')}`).set(auth(owner.token))
      .send({ overheadPct: 40 }).expect(200);
    const list = await request(app).get('/api/estimating/gc-overhead-defaults').set(auth(owner.token)).expect(200);
    expect(list.body.find((g: { gcName: string }) => g.gcName === 'Some GC')?.overheadPct).toBe(40);
  });
});
