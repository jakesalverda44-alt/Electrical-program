// Remodel + footage round, B2 — the footage allowance lands on every synced
// bid as "Branch Wiring (allowance)" lines mapped to real library items,
// with the math as evidence; an estimator's typed qty and a confirmed
// measured run both survive later syncs. Real input: the 2026-09-29 36th
// Street live run.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { buildSampleSheetPdf } from './fixtures/estimating/buildSheetPdf';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/estimating/36th-street-run-2026-09-29.json'), 'utf8'));

async function makePhaseABid(app: import('express').Express, user: TestUser) {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `Footage ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = res.body.id as string;
  await pool.query(
    `INSERT INTO est_bid_settings (bid_id, labor_rate, factor_ids, material_tax_pct, small_tools_pct, supervision_pct, consumables_pct, overhead_pct, profit_pct, crew_size, floors_above_2, pricing_mode)
     VALUES ($1,40,$2,0,0,0,0,0,0,3,0,'phase_a') ON CONFLICT (bid_id) DO UPDATE SET pricing_mode='phase_a'`,
    [bidId, []],
  );
  return bidId;
}

async function seedRun(bidId: string) {
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, status) VALUES ($1,$2,$3,$4,'agent2_complete')
     ON CONFLICT (bid_id) DO UPDATE SET agent1_output=$2, agent2_output=$3, count_result=$4, status='agent2_complete'`,
    [bidId, JSON.stringify(run.agent1), '```json\n' + JSON.stringify(run.agent2) + '\n```', JSON.stringify(run.count_result)],
  );
}

type Line = Record<string, unknown> & { line_key: string; category: string; description: string; qty: number; qty_overridden: boolean; qty_source: string; evidence_note: string | null; takeoff_key: string; item_id: string | null };

const SETTINGS = { labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3 };

describe('B2 — footage allowance on a real synced bid', () => {
  it('adds mapped Branch Wiring (allowance) lines with the math as evidence', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await seedRun(bidId);
    const res = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = res.body.lines as Line[];
    const branch = lines.filter(l => l.category === 'Branch Wiring (allowance)');
    expect(branch.map(l => l.description).sort()).toEqual([
      '#10 THHN/THWN copper conductor', '#12 THHN/THWN copper conductor', '12/2 MC cable', '3/4" EMT (incl. couplings/straps)',
    ]);
    for (const l of branch) {
      expect(l.item_id, `${l.description} should resolve to a library item`).toBeTruthy();
      expect(l.qty).toBeGreaterThan(0);
      expect(l.evidence_note).toMatch(/calibrated on 5 of Chris's jobs/);
    }
    const emt = branch.find(l => l.description.startsWith('3/4" EMT'))!;
    expect(emt.qty).toBe(521);
    // The three Agent 2 allowances are there too (B1), visible at 0.
    expect(lines.filter(l => l.description.startsWith('NEEDS FOOTAGE')).length).toBe(3);

    // Priced: the LF line resolves against the per-C library item.
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const pricedEmt = got.body.recap.lines.find((l: { description: string }) => l.description === '3/4" EMT (incl. couplings/straps)');
    expect(pricedEmt.hoursExt).toBeCloseTo(521 / 100 * 4.0, 2);
  });

  it("an estimator's typed qty survives re-syncs; a confirmed measured run replaces the allowance", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await seedRun(bidId);
    const first = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Line[];
    const mc = first.find(l => l.description === '12/2 MC cable')!;
    const emt = first.find(l => l.description.startsWith('3/4" EMT'))!;
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: first.map(l => (l.line_key === mc.line_key ? { ...l, qty: 378, qty_overridden: true, evidence_note: "Chris's usual whip length on this job." } : l)),
      settings: SETTINGS,
    }).expect(200);

    // Measure the EMT run on a scaled sheet and apply it.
    const { rows } = await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
       VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', $2, 'test') RETURNING id`,
      [bidId, buildSampleSheetPdf().toString('base64')],
    );
    const docId = rows[0].id as string;
    // The sheet row directly (not through the PDF indexer, whose timing
    // under a loaded full-suite run isn't what this test is about).
    await pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, sheet_no, title, discipline, kind, width_pt, height_pt, ft_per_pt, scale_source, scale_label)
       VALUES ($1, $2, 0, 'E1.0', 'Power Plan', 'E', 'plan', 2592, 1728, 1, 'calibrated', 'Calibrated')`,
      [bidId, docId],
    );
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id: randomUUID(), document_id: docId, page_index: 0, line_key: emt.line_key, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }], drops: 0, drop_ft: 0, slack_pct: 0 }],
      updates: [], deletes: [],
    }).expect(200);
    const applied = await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [emt.line_key] }).expect(200);
    expect(applied.body.applied).toEqual([emt.line_key]);

    const again = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Line[];
    const mcAfter = again.find(l => l.line_key === mc.line_key)!;
    expect(mcAfter.qty).toBe(378);
    expect(mcAfter.evidence_note).toBe("Chris's usual whip length on this job.");
    const emtAfter = again.find(l => l.line_key === emt.line_key)!;
    expect(emtAfter.qty).toBe(600);
    expect(emtAfter.qty_source).toBe('markup');
    expect(emtAfter.evidence_note).toMatch(/^Measured on the plans \(confirmed markups\) — replaces the allowance\./);
    // SF-3 — the wire follows the measured EMT run.
    const w12 = again.find(l => l.description === '#12 THHN/THWN copper conductor')!;
    const w10 = again.find(l => l.description === '#10 THHN/THWN copper conductor')!;
    expect(w12.qty).toBe(Math.round(600 * 5.54 * 0.53));
    expect(w10.qty).toBe(Math.round(600 * 5.54 * 0.47));
    expect(w12.evidence_note).toMatch(/^Derived from your measured\/entered EMT run: 600 ft/);
  });

  it('BL-4 repro: branch wiring the estimator already entered → a re-sync adds no allowance on top', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
       ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2`,
      [bidId, '```json\n' + JSON.stringify({ takeoff: [
        { category: 'Branch Power', item: 'Duplex receptacle', qty: 20, unit: 'EA' },
        { category: 'Interior Lighting', item: 'Type A - 2x4 LED recessed troffer', qty: 30, unit: 'EA' },
      ] }) + '\n```'],
    );
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', qty: 670, unit: 'LF', source: 'manual', evidence_note: 'Measured branch EMT by hand.' },
        { category: 'Branch Power', description: '#12 THHN/THWN copper conductor', qty: 3660, unit: 'LF', source: 'manual', evidence_note: 'Branch wire, 3 conductors.' },
      ],
      settings: SETTINGS,
    }).expect(200);
    const res = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = res.body.lines as Line[];
    // MC fixture whips are their own scope — hand-entered EMT + wire never replaces them.
    const mc = lines.find(l => l.category === 'Branch Wiring (allowance)' && l.description === '12/2 MC cable')!;
    expect(mc.qty).toBe(Math.round(30 * 7.89));
    const allowance = lines.filter(l => l.category === 'Branch Wiring (allowance)' && l.description !== '12/2 MC cable');
    expect(allowance.length).toBeGreaterThan(0);
    for (const l of allowance) {
      expect(l.qty, l.description).toBe(0);
      expect(l.evidence_note).toMatch(/^Reduced by your entered\/measured footage in this scope .* = 0 ft\./);
    }
    const recap = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.recap;
    const added = recap.lines.filter((l: { category: string; description: string }) => l.category === 'Branch Wiring (allowance)' && l.description !== '12/2 MC cable').reduce((s: number, l: { materialExt: number; hoursExt: number }) => s + l.materialExt + l.hoursExt, 0);
    expect(added).toBe(0);
    // The estimator's own lines are untouched.
    expect(lines.filter(l => l.source === 'manual').map(l => Number(l.qty)).sort((a, b) => a - b)).toEqual([670, 3660]);
  });

  it("NB-1 repro: an override (500 → 650) on an Agent 2 full-run row survives two syncs; the price is stable", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
       ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2`,
      [bidId, '```json\n' + JSON.stringify({ takeoff: [{ category: 'Branch Power', item: '9.1', spec: 'Branch circuits 3/4" EMT w/ 2#12 1#12G', qty: 500, unit: 'LF' }] }) + '\n```'],
    );
    await pool.query(
      `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, takeoff_key, takeoff_item_id, source, qty_overridden, qty_source, evidence_note)
       VALUES ($1, 0, 'Branch Power', 'Branch circuits 3/4" EMT w/ 2#12 1#12G', 650, 'LF', 'Branch Power||9.1', '9.1', 'takeoff', true, 'manual', 'Measured 650 ft on E1.0.')`,
      [bidId],
    );
    const s1 = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Line[];
    const g1 = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.recap.totals.grandTotal;
    const s2 = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Line[];
    const g2 = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.recap.totals.grandTotal;
    const parts = (lines: Line[]) => lines.filter(l => l.takeoff_key.startsWith('Branch Power||9.1 — ') && !l.excluded).map(l => [l.takeoff_key, Number(l.qty), l.qty_overridden]).sort();
    expect(parts(s1)).toEqual([
      ['Branch Power||9.1 — #12 wire ×1', 650, true], ['Branch Power||9.1 — #12 wire ×2', 1300, true], ['Branch Power||9.1 — conduit', 650, true],
    ]);
    expect(parts(s2)).toEqual(parts(s1));
    expect(g1).toBeGreaterThan(0);
    expect(g2).toBeCloseTo(g1, 2);
  });

  it("NB-4 repro (DB): Agent 2's 500 ft run + the estimator's 670 ft EMT / 3,660 ft #12 → Agent 2's parts go to 0, only the estimator's lines price", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makePhaseABid(app, u);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
       ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2`,
      [bidId, '```json\n' + JSON.stringify({ takeoff: [{ category: 'Branch Power', item: '9.1', spec: 'Branch circuits 3/4" EMT w/ 2#12 1#12G', qty: 500, unit: 'LF' }] }) + '\n```'],
    );
    await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [
        { category: 'Branch Power', description: '3/4" EMT (incl. couplings/straps)', qty: 670, unit: 'LF', source: 'manual', evidence_note: 'Measured branch EMT by hand.' },
        { category: 'Branch Power', description: '#12 THHN/THWN copper conductor', qty: 3660, unit: 'LF', source: 'manual', evidence_note: 'Branch wire, 3 conductors.' },
      ],
      settings: SETTINGS,
    }).expect(200);
    const lines = (await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200)).body.lines as Line[];
    const parts = lines.filter(l => (l.takeoff_key ?? '').startsWith('Branch Power||9.1 — '));
    expect(parts.map(l => Number(l.qty))).toEqual([0, 0, 0]);
    for (const l of parts) expect(l.evidence_note).toMatch(/^Reduced by your own footage in this scope/);
    expect(lines.filter(l => l.source === 'manual').map(l => Number(l.qty)).sort((a, b) => a - b)).toEqual([670, 3660]);
  });
});
