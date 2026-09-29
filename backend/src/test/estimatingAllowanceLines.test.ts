// Remodel + footage round, B1 — Agent 2's allowances[] reach est_bid_lines
// through the normal sync: footage > 0 is a priced line with Agent 2's note
// as its evidence; footage 0 is a visible 0-qty "NEEDS FOOTAGE" line; an
// estimator's typed footage survives a re-sync.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makePhaseABid(app: import('express').Express, user: TestUser) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `Allow ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = res.body.id as string;
  await pool.query(
    `INSERT INTO est_bid_settings (bid_id, labor_rate, factor_ids, material_tax_pct, small_tools_pct, supervision_pct, consumables_pct, overhead_pct, profit_pct, crew_size, floors_above_2, pricing_mode)
     VALUES ($1,40,$2,0,0,0,0,0,0,3,0,'phase_a') ON CONFLICT (bid_id) DO UPDATE SET pricing_mode='phase_a'`,
    [bidId, []],
  );
  return bidId;
}

async function seedAgent2(bidId: string, body: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
     ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2, status='agent2_complete'`,
    [bidId, '```json\n' + JSON.stringify(body) + '\n```'],
  );
}

type Line = { category: string; description: string; qty: number; qty_overridden: boolean; evidence_note: string | null; takeoff_key: string; unit: string };

describe('B1 — allowances become est lines', () => {
  it('priced when footage > 0, visible at 0 when not, evidence = Agent 2\'s note', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await seedAgent2(bidId, {
      takeoff: [],
      allowances: [
        { item: 'Trenching & backfill allowance', footage: 150, unit: 'LF', notes: 'E1.0 dimensioned run' },
        { item: 'HVAC feeders 3/4" 3#6 1#10G', footage: 0, unit: 'LF', notes: 'E3.0; footage not shown — field measure' },
        // Fix round BL-3 — branch conduit with no wire is not a complete set: never priced conduit-only.
        { item: '3/4" EMT branch conduit', footage: 200, unit: 'LF' },
      ],
    });
    const res = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = res.body.lines as Line[];
    const priced = lines.find(l => l.takeoff_key.endsWith('Allowance — Trenching & backfill allowance'))!;
    expect(priced.qty).toBe(150);
    expect(priced.unit).toBe('LF');
    expect(priced.evidence_note).toBe('Agent 2 allowance, ESTIMATED: 150 LF — E1.0 dimensioned run');
    const needs = lines.find(l => l.description.startsWith('NEEDS FOOTAGE — HVAC feeders'))!;
    expect(needs).toBeTruthy();
    expect(needs.qty).toBe(0);
    expect(needs.evidence_note).toMatch(/field measure/);

    const partial = lines.find(l => l.takeoff_key.endsWith('Allowance — 3/4" EMT branch conduit'))!;
    expect(partial.qty).toBe(0);
    expect(partial.evidence_note).toMatch(/couldn't be matched completely/);

    // The priced allowance actually prices (it resolves in the library).
    const recap = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const pricedLine = recap.body.recap.lines.find((l: { description: string }) => l.description === 'Trenching & backfill allowance');
    expect(pricedLine.materialExt).toBeGreaterThan(0);
  });

  it('an estimator\'s typed footage on a NEEDS FOOTAGE line survives the next sync', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await seedAgent2(bidId, { takeoff: [], allowances: [{ item: 'Branch circuit conduit/wire 1/2" EMT 2#12 1#10G', footage: 0, unit: 'LF' }] });
    const first = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = first.body.lines as Array<Line & Record<string, unknown>>;
    const target = lines.find(l => l.description.startsWith('NEEDS FOOTAGE'))!;
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: lines.map(l => (l === target ? { ...l, qty: 420, qty_overridden: true, evidence_note: 'Measured on E1.0 by hand, 420 ft.' } : l)),
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);
    const again = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const kept = (again.body.lines as Line[]).find(l => l.takeoff_key === target.takeoff_key)!;
    expect(kept.qty).toBe(420);
    expect(kept.qty_overridden).toBe(true);
    // The estimator's own reason is never overwritten by Agent 2's note.
    expect(kept.evidence_note).toBe('Measured on E1.0 by hand, 420 ft.');
  });

  it('Q4 — a typed run on the HVAC feeder NEEDS FOOTAGE line prices conduit + wire (run × conductors)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await seedAgent2(bidId, { takeoff: [], allowances: [{ item: 'HVAC feeders 3/4" 3#6 1#10G', footage: 0, unit: 'LF', notes: 'E3.0' }] });
    const first = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Array<Line & Record<string, unknown>>;
    const hvac = first.find(l => l.description.startsWith('NEEDS FOOTAGE — HVAC'))!;
    expect(hvac.evidence_note).toMatch(/price automatically/);
    const saved = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: first.map(l => (l === hvac ? { ...l, qty: 200, qty_overridden: true, evidence_note: 'Measured HVAC run, 200 ft.' } : l)),
      settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 },
    }).expect(200);
    const { rows } = await pool.query(`SELECT code, unit, material_cost, labor_hours FROM est_items WHERE code IN ('EMT-075','THHN-6','THHN-10')`);
    const by = Object.fromEntries(rows.map(r => [r.code, { m: Number(r.material_cost), h: Number(r.labor_hours) }]));
    const priced = saved.body.recap.lines.find((l: { description: string }) => l.description.startsWith('NEEDS FOOTAGE — HVAC'));
    expect(priced.unresolved).toBe(false);
    expect(priced.hoursExt).toBeCloseTo(2 * by['EMT-075'].h + 0.6 * by['THHN-6'].h + 0.2 * by['THHN-10'].h, 4);
    expect(priced.materialExt).toBeCloseTo(2 * by['EMT-075'].m + 0.6 * by['THHN-6'].m + 0.2 * by['THHN-10'].m, 2);
  });
});
