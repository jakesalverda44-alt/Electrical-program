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

  // Review round 2 / N15 — a night rate used to go straight through
  // `Number(v)` unchecked: a bad value (NaN, or a negative number) would
  // reach a NUMERIC(10,2) DB column and 500, instead of 400ing here.
  it('N15: rejects a non-numeric night rate with 400, never a 500', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const base = {
      shift: 'night', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 10, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    };
    const bad = await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token))
      .send({ ...base, nightJourneymanRate: 'not-a-number' }).expect(400);
    expect(bad.body.error).toMatch(/nightJourneymanRate/);
    const negative = await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token))
      .send({ ...base, nightApprenticeRate: -5 }).expect(400);
    expect(negative.body.error).toMatch(/nightApprenticeRate/);
  });

  it('N15: a blank/omitted night rate is null (use the day rate), and a real number saves correctly', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const base = {
      shift: 'night', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 10, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    };
    await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token))
      .send({ ...base, nightJourneymanRate: '', nightForemanRate: 45 }).expect(200);
    const res = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(res.body.settings.nightJourneymanRate).toBeNull();
    expect(res.body.settings.nightForemanRate).toBe(45);
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

  it('N14: mixed-tax equipment lines sum EXACT per-line tax, never a blended %', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    // $600 @ 7% ($42.00) + $400 @ 0% ($0.00) — two different tax rates in
    // the same equipment list, the exact shape the old blended-% approach
    // mishandled.
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({
      kind: 'equipment', description: 'Taxed lift rental', amount: 600, taxPct: 7,
    }).expect(200);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({
      kind: 'equipment', description: 'Untaxed equipment fee', amount: 400, taxPct: 0,
    }).expect(200);
    const recap = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(recap.body.recap.equipmentTax).toBeCloseTo(42.00, 2);
    expect(recap.body.recap.equipmentTotal).toBeCloseTo(1042.00, 2);
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

  it('B4: bids.amount tracks the Accubid recap through the reviewer\'s exact flip sequence, never the Phase A engine', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u); // new bid -> pricing_mode defaults to 'accubid'

    const accubidTotal = async () => {
      const r = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
      return r.body.recap.sellingPrice as number;
    };
    const dbAmount = async () => {
      const { rows } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
      return Number(rows[0].amount);
    };

    // Step 1 — "Save lines" via the Phase A save endpoint (PUT /:bidId is
    // shared by both modes — it's how est_bid_lines itself gets written no
    // matter which pricing engine is active). Since this bid is in Accubid
    // mode, bids.amount must land on the ACCUBID recap for these lines, not
    // whatever the Phase A engine alone would have computed for them.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Manual material item', qty: 1, unit: 'EA', material_unit_override: 1000, labor_hours_override: 0, source: 'manual' }],
      settings: { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3, floors_above_2: 0 },
    }).expect(200);
    expect(await dbAmount()).toBeCloseTo(await accubidTotal(), 2);
    const afterLines = await dbAmount();

    // Step 2 — "Save Accubid settings" changes the recap (a real markup %).
    await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send({
      shift: 'day', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 25, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    }).expect(200);
    const afterSettings = await dbAmount();
    expect(afterSettings).toBeCloseTo(await accubidTotal(), 2);
    expect(afterSettings).not.toBeCloseTo(afterLines, 2); // the markup change actually moved the number

    // Step 3 — "Add a $5,000 quote": bids.amount must reflect it IMMEDIATELY,
    // not stay frozen at the settings-save number until some other button is
    // pressed (the reviewer's exact regression).
    await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token)).send({
      description: 'Switchgear', amount: 5000, markupPct: 0, status: 'firm',
    }).expect(200);
    const afterQuote = await dbAmount();
    expect(afterQuote).toBeCloseTo(await accubidTotal(), 2);
    expect(afterQuote).toBeGreaterThan(afterSettings + 4000); // the $5,000 quote is really in there

    // Step 4 — "Press Labor & Pricing Save" again: must NOT drop back to a
    // stale pre-quote number (the reviewer's repro went from 7,762.40 back
    // down to 1,669.80 here).
    await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send({
      shift: 'day', journeymanCount: 1, journeymanRate: 40, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 25, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    }).expect(200);
    expect(await dbAmount()).toBeCloseTo(afterQuote, 2);

    // Step 5 — the actual "Phase A buttons can't overwrite it" assertion:
    // pressing the SAME Phase A save endpoint again (still shared for lines)
    // must keep reflecting the Accubid recap, never fall back to whatever
    // the Phase A engine alone computes for these same lines/settings.
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Manual material item', qty: 1, unit: 'EA', material_unit_override: 1000, labor_hours_override: 0, source: 'manual' }],
      settings: { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3, floors_above_2: 0 },
    }).expect(200);
    const finalAmount = await dbAmount();
    expect(finalAmount).toBeCloseTo(await accubidTotal(), 2);
    expect(finalAmount).toBeGreaterThan(afterSettings + 4000); // still carries the quote — never reverted to the pre-quote Phase A number
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

  // Fix round 2 / B6 — the reviewer's repro: a salesperson with no access to
  // the OWNER's bid used their OWN accessible bid's URL with the OWNER's
  // quote/cost-line/alternate id, bypassing loadAccessibleBid entirely
  // (which only ever checked :bidId, never that the row itself belongs to
  // it). Every by-id query must now be scoped `bid_id=$2` too, turning that
  // into an ordinary 404.
  it("B6: a quote id from bid A can't be read/edited/deleted through bid B's URL", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const bidA = await makeBid(app, owner);
    const bidB = await makeBid(app, owner);

    const created = await request(app).post(`/api/estimating/${bidA}/accubid/quotes`).set(auth(owner.token)).send({
      description: 'Owner-only switchgear quote', amount: 1, markupPct: 0, status: 'budget_pending',
    }).expect(200);

    await request(app).put(`/api/estimating/${bidB}/accubid/quotes/${created.body.id}`).set(auth(owner.token))
      .send({ status: 'firm', amount: 1 }).expect(404);
    await request(app).delete(`/api/estimating/${bidB}/accubid/quotes/${created.body.id}`).set(auth(owner.token)).expect(404);

    // Untouched — still budget_pending, at bid A.
    const stillThere = await request(app).get(`/api/estimating/${bidA}/accubid`).set(auth(owner.token)).expect(200);
    expect(stillThere.body.quotes).toHaveLength(1);
    expect(stillThere.body.quotes[0].status).toBe('budget_pending');
  });

  it('B6: a cost-line id and an alternate id are scoped by bid the same way', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const bidA = await makeBid(app, owner);
    const bidB = await makeBid(app, owner);

    const costLine = await request(app).post(`/api/estimating/${bidA}/accubid/cost-lines`).set(auth(owner.token)).send({
      kind: 'equipment', description: 'Scissor lift', amount: 500,
    }).expect(200);
    const alt = await request(app).post(`/api/estimating/${bidA}/accubid/alternates`).set(auth(owner.token)).send({
      kind: 'deduct', description: 'Deduct existing fixtures', amount: 100,
    }).expect(200);

    await request(app).put(`/api/estimating/${bidB}/accubid/cost-lines/${costLine.body.id}`).set(auth(owner.token))
      .send({ amount: 99999 }).expect(404);
    await request(app).delete(`/api/estimating/${bidB}/accubid/cost-lines/${costLine.body.id}`).set(auth(owner.token)).expect(404);
    await request(app).put(`/api/estimating/${bidB}/accubid/alternates/${alt.body.id}`).set(auth(owner.token))
      .send({ amount: 99999 }).expect(404);
    await request(app).delete(`/api/estimating/${bidB}/accubid/alternates/${alt.body.id}`).set(auth(owner.token)).expect(404);

    const recap = await request(app).get(`/api/estimating/${bidA}/accubid`).set(auth(owner.token)).expect(200);
    expect(Number(recap.body.costLines[0].amount)).toBe(500);
    expect(Number(recap.body.alternates[0].amount)).toBe(100);
  });

  it('B6: a malformed patch (a non-numeric amount) is a 400, never a 500', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    const bidId = await makeBid(app, owner);

    const quote = await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(owner.token)).send({
      description: 'Switchgear', amount: 100, markupPct: 0, status: 'budget_pending',
    }).expect(200);
    await request(app).put(`/api/estimating/${bidId}/accubid/quotes/${quote.body.id}`).set(auth(owner.token))
      .send({ amount: 'abc' }).expect(400);

    const costLine = await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(owner.token)).send({
      kind: 'equipment', description: 'Scissor lift', amount: 500,
    }).expect(200);
    await request(app).put(`/api/estimating/${bidId}/accubid/cost-lines/${costLine.body.id}`).set(auth(owner.token))
      .send({ amount: 'abc' }).expect(400);
    await request(app).put(`/api/estimating/${bidId}/accubid/cost-lines/${costLine.body.id}`).set(auth(owner.token))
      .send({ kind: 'not-a-real-kind' }).expect(400);

    const alt = await request(app).post(`/api/estimating/${bidId}/accubid/alternates`).set(auth(owner.token)).send({
      kind: 'deduct', description: 'Deduct existing fixtures', amount: 100,
    }).expect(200);
    await request(app).put(`/api/estimating/${bidId}/accubid/alternates/${alt.body.id}`).set(auth(owner.token))
      .send({ amount: 'abc' }).expect(400);

    // Nothing was corrupted by the rejected patches.
    const recap = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(owner.token)).expect(200);
    expect(Number(recap.body.quotes[0].amount)).toBe(100);
    expect(Number(recap.body.costLines[0].amount)).toBe(500);
    expect(Number(recap.body.alternates[0].amount)).toBe(100);
  });
});
