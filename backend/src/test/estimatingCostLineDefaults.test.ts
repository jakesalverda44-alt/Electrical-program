// Remodel + footage round, B4 — an Accubid-mode bid with labor hours and no
// Equipment / General Expenses line gets an editable default; an untouched
// default follows the hours; an edited one is the estimator's for good; a
// deleted one never comes back; a bid with its own lines never gets one.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const SETTINGS = { labor_rate: 38, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 };

async function makeBid(app: import('express').Express, user: TestUser) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `CostDef ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  return res.body.id as string;
}

async function saveHours(app: import('express').Express, user: TestUser, bidId: string, hours: number) {
  await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({
    lines: [{ category: 'Branch Power', description: 'Labor bucket', qty: 1, unit: 'EA', material_unit_override: 0, labor_hours_override: hours, source: 'manual', evidence_note: 'Test labor bucket for the default rule.' }],
    settings: SETTINGS,
  }).expect(200);
}

type CostLine = { id: string; kind: string; description: string; amount: number; autoDefault: boolean };
async function costLines(app: import('express').Express, user: TestUser, bidId: string): Promise<CostLine[]> {
  return (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(user.token)).expect(200)).body.costLines;
}

describe('B4 — default equipment / general expenses lines', () => {
  it('seeds both on a bid with hours, follows the hours while untouched, and prices them', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await saveHours(app, u, bidId, 189.21);
    let lines = await costLines(app, u, bidId);
    expect(lines.map(l => [l.kind, l.description, l.amount, l.autoDefault]).sort()).toEqual([
      ['equipment', 'Equipment — default', 1381.23, true],
      ['general_expense', 'General expenses — default', 270, true],
    ]);
    const recap = (await request(app).get(`/api/estimating/${bidId}/accubid`).set(auth(u.token)).expect(200)).body.recap;
    expect(recap.equipmentTotal).toBe(1381.23);
    expect(recap.generalExpensesTotal).toBe(270);

    await saveHours(app, u, bidId, 1000);
    lines = await costLines(app, u, bidId);
    expect(lines.find(l => l.kind === 'equipment')!.amount).toBe(7300);
    expect(lines.find(l => l.kind === 'general_expense')!.amount).toBe(2500);
  });

  it('an edited default is never touched again; a deleted one is never re-seeded', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await saveHours(app, u, bidId, 500);
    let lines = await costLines(app, u, bidId);
    const eq = lines.find(l => l.kind === 'equipment')!;
    const ge = lines.find(l => l.kind === 'general_expense')!;
    await request(app).put(`/api/estimating/${bidId}/accubid/cost-lines/${eq.id}`).set(auth(u.token)).send({ amount: 1250, description: 'Scissor lift (Sunbelt)' }).expect(200);
    await request(app).delete(`/api/estimating/${bidId}/accubid/cost-lines/${ge.id}`).set(auth(u.token)).expect(204);
    await saveHours(app, u, bidId, 2000);
    lines = await costLines(app, u, bidId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'equipment', description: 'Scissor lift (Sunbelt)', amount: 1250, autoDefault: false });
  });

  it("a bid that already has its own lines never gets a default; adding one removes the untouched default", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({ kind: 'equipment', description: 'Boom lift', amount: 950 }).expect(200);
    await saveHours(app, u, bidId, 400);
    let lines = await costLines(app, u, bidId);
    expect(lines.filter(l => l.kind === 'equipment').map(l => [l.description, l.amount, l.autoDefault])).toEqual([['Boom lift', 950, false]]);
    expect(lines.find(l => l.kind === 'general_expense')).toMatchObject({ amount: 2500, autoDefault: true });

    await request(app).post(`/api/estimating/${bidId}/accubid/cost-lines`).set(auth(u.token)).send({ kind: 'general_expense', description: 'Permits', amount: 310 }).expect(200);
    lines = await costLines(app, u, bidId);
    expect(lines.filter(l => l.kind === 'general_expense').map(l => [l.description, l.amount])).toEqual([['Permits', 310]]);
  });

  it('a bid with no labor hours gets nothing', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await saveHours(app, u, bidId, 0);
    expect(await costLines(app, u, bidId)).toEqual([]);
  });

  it('BL-1 repro: a SUBMITTED bid never gets defaults — a $0 quote leaves bids.amount unchanged', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await pool.query(`UPDATE bids SET stage='submitted' WHERE id=$1`, [bidId]);
    await saveHours(app, u, bidId, 208);
    const before = Number((await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId])).rows[0].amount);
    expect(await costLines(app, u, bidId)).toEqual([]);
    await request(app).post(`/api/estimating/${bidId}/accubid/quotes`).set(auth(u.token))
      .send({ description: 'Budget', amount: 0, markupPct: 18, status: 'budget_pending' }).expect(200);
    const after = Number((await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId])).rows[0].amount);
    expect(after).toBe(before);
    expect(await costLines(app, u, bidId)).toEqual([]);
  });

  it('BL-1: an untouched default freezes once the bid is submitted (no follow-the-hours)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await saveHours(app, u, bidId, 1000);
    await pool.query(`UPDATE bids SET stage='submitted' WHERE id=$1`, [bidId]);
    await saveHours(app, u, bidId, 2000);
    expect((await costLines(app, u, bidId)).find(l => l.kind === 'equipment')!.amount).toBe(7300);
  });

  it('BL-1: migration 151 marks every bid that already exists as "defaults handled"', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u); // exists "before the migration"
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/151_cost_line_defaults.sql'), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql); // idempotent re-run
      const { rows } = await client.query('SELECT kind FROM est_bid_cost_line_seeds WHERE bid_id=$1 ORDER BY kind', [bidId]);
      expect(rows.map(r => r.kind)).toEqual(['equipment', 'general_expense']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
