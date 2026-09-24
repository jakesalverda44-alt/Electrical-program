// Next round Part B, coordinator follow-up — the 7-Eleven account rule
// default (fixtures/panels/switchgear/SPD/receptacles/disconnects are APT
// F&I via the Graybar national account) and its auto deduct alternate
// ("if furnished by others instead, deduct $X — installation stays APT").
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { syncAutoDeductAlternateForBid, getAlternates } from '../estimating/accubidBidData';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `7-Eleven test ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC', brand: '7-Eleven', ...extra })
    .expect(200);
  return res.body.id as string;
}

describe('7-Eleven account rule default', () => {
  it('reads APT furnish/install for fixtures, panels and disconnects (the "furnished by GC" wording is gone)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query("SELECT terms FROM account_rules WHERE name='7-Eleven'");
    const terms = rows[0].terms;
    for (const key of ['lighting', 'panels', 'disconnects', 'other_equipment']) {
      expect(terms[key].furnishBy).toBe('APT');
      expect(terms[key].installBy).toBe('APT');
      expect(terms[key].vendor).toContain('Graybar');
    }
  });

  it('never overwrites an admin\'s own edit of the 7-Eleven rule (migration guard)', async (ctx) => {
    if (!ok) return ctx.skip();
    // Simulate an admin having already customized the rule, then confirm a
    // second run of the SAME migration file (idempotent by design) leaves it alone.
    await pool.query("UPDATE account_rules SET terms = '{\"lighting\": {\"mode\": \"ask\"}}'::jsonb WHERE name='7-Eleven'");
    const { runMigrations } = await import('../migrate');
    await runMigrations();
    const { rows } = await pool.query("SELECT terms FROM account_rules WHERE name='7-Eleven'");
    expect(rows[0].terms).toEqual({ lighting: { mode: 'ask' } });
    // Restore the real default for the rest of this file's tests.
    await pool.query(`
      UPDATE account_rules SET terms = '{
        "lighting": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
        "panels": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
        "disconnects": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"},
        "other_equipment": {"mode": "fixed", "furnishBy": "APT", "installBy": "APT", "vendor": "Graybar 7-Eleven national account", "contact": "Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com"}
      }'::jsonb WHERE name='7-Eleven'
    `);
  });
});

describe('syncAutoDeductAlternateForBid — a 7-Eleven-shaped bid', () => {
  it('creates an auto deduct alternate priced from the matched lines\' material + markup, never from labor', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { category: 'Interior Lighting', description: '2x4 LED troffer', qty: 1, unit: 'EA', material_unit_override: 5000, labor_hours_override: 100, source: 'manual' },
        { category: 'Service & Distribution', description: '225A panelboard', qty: 1, unit: 'EA', material_unit_override: 3000, labor_hours_override: 20, source: 'manual' },
        { category: 'Branch Power', description: '3/4" EMT conduit', qty: 1, unit: 'EA', material_unit_override: 10000, labor_hours_override: 50, source: 'manual' },
      ],
      settings: { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3, floors_above_2: 0 },
    }).expect(200);

    await request(app).put(`/api/estimating/${bidId}/accubid/settings`).set(auth(u.token)).send({
      shift: 'day', journeymanCount: 1, journeymanRate: 37, apprenticeCount: 0, apprenticeRate: 0, foremanCount: 0, foremanRate: 0,
      burdenPct: 0, fringePerHr: 0, materialTaxPct: 0, laborOverheadPct: 0, materialMarkupPct: 20, laborMarkupPct: 0,
      quoteMarkupDefaultPct: 18, adjustmentMarkupPct: 0, salesMarkupPct: 0,
    }).expect(200);

    const alternates = await getAlternates(bidId);
    const auto = alternates.find(a => a.auto);
    expect(auto).toBeTruthy();
    expect(auto!.kind).toBe('deduct');
    // matched material: lighting 5000 + panel 3000 = 8000 (conduit/branch power line excluded); +20% markup = 9600
    expect(auto!.amount).toBeCloseTo(9600, 2);
    expect(auto!.description).toContain('$9,600.00');
    expect(auto!.description).toContain('installation remains in APT scope');
  });

  it('the base selling price is unchanged by the alternate (it prints separately)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const before = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    await syncAutoDeductAlternateForBid(bidId);
    const after = await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200);
    expect(after.body.recap.sellingPrice).toBe(before.body.recap.sellingPrice);
  });

  it('removes the auto alternate for a non-7-Eleven bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u, { brand: 'AutoZone' });
    await syncAutoDeductAlternateForBid(bidId);
    const alternates = await getAlternates(bidId);
    expect(alternates.find(a => a.auto)).toBeUndefined();
  });
});
