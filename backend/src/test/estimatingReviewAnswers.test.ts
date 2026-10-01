// Price accuracy round, C2 — resolving a takeoff-review item changes the
// Labor & Pricing proposal on the very next GET, with no new analysis run.
// Real input: the 36th Street re-run (2026-09-29b) and Jake's answer on H.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/estimating/price-accuracy/36th-street-run-2026-09-29b.json'), 'utf8'));
const unanswered = (run.review_items as Array<Record<string, unknown>>).map(i => { const { resolution: _r, ...rest } = i; return rest; });

type Line = { description: string; qty: number; item_id: string | null; assembly_id: string | null; evidence_note: string | null; match_confidence: string | null };

describe('C2 — review answers reach the estimate without a re-run', () => {
  it('naming + counting unlisted H adds a 13 × 2x4 LED high-bay line to the proposal on the next GET', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `C2 ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, review_items, review_status, status)
       VALUES ($1,$2,$3,$4,$5,'needs_review','agent2_complete')`,
      [bidId, JSON.stringify(run.agent1), '```json\n' + JSON.stringify(run.agent2) + '\n```', JSON.stringify(run.count_result), JSON.stringify(unanswered)],
    );

    const before = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    expect(before.body.proposed).toBe(true);
    expect((before.body.lines as Line[]).some(l => /^Type H\b/.test(l.description))).toBe(false);
    // C1 on the live path: the circuit list is unresolved with its note, never a transformer.
    const circuits = (before.body.lines as Line[]).find(l => /^1 1; 2 1/.test(l.description))!;
    expect(circuits.item_id).toBeNull();
    expect(circuits.evidence_note).toBe('Branch circuit count — wiring carried by the allowance');

    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token))
      .send({ itemIds: ['unlisted:H'], action: 'count', qty: 13, reason: 'LED high bay 2x4 - warehouse (per Chris)' }).expect(200);

    const after = await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200);
    const h = (after.body.lines as Line[]).filter(l => /^Type H\b/.test(l.description));
    expect(h).toHaveLength(1);
    expect(h[0].qty).toBe(13);
    const { rows } = await pool.query('SELECT code FROM est_items WHERE id = $1', [h[0].item_id]);
    expect(rows[0]?.code).toBe('LTG-HIBAY24');
    const priced = (after.body.recap.lines as Array<{ description: string; hoursExt: number }>).find(l => /^Type H\b/.test(l.description))!;
    expect(priced.hoursExt).toBeCloseTo(13, 5);
    expect(after.body.recap.totals.laborHours).toBeGreaterThan(before.body.recap.totals.laborHours + 12.9);

    // Fix round S4 — the enforcement's own warnings reach the estimate.
    expect(after.body.reviewFlags.some((f: { kind: string; message: string }) => f.kind === 'possible_double' && /^Possible double count: "WP GFCI receptacle exterior at condensers/.test(f.message))).toBe(true);
    const wpLine = (after.body.lines as Line[]).find(l => /WP GFCI receptacle exterior/.test(l.description) || l.evidence_note?.startsWith('⚠'));
    expect(wpLine?.evidence_note ?? '').toMatch(/^⚠ Possible double count/);

    // Fix round S4 — answering count:WP (2) sets the existing WP line, never adds a second one.
    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token))
      .send({ itemIds: ['count:WP'], action: 'count', qty: 2 }).expect(200);
    const wp = ((await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.lines as Array<Line & { category: string }>)
      .filter(l => l.category === 'Branch Power' && /\bWP\b|weather protected/i.test(l.description));
    expect(wp).toHaveLength(1);
    expect(wp.reduce((n, l) => n + l.qty, 0)).toBe(2);

    // Saved through sync-takeoff too (the same rows), and 'confirm' is a legal stored value.
    const synced = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect((synced.body.lines as Line[]).filter(l => /^Type H\b/.test(l.description)).map(l => l.qty)).toEqual([13]);
    expect((synced.body.lines as Line[]).some(l => l.match_confidence === 'confirm')).toBe(true); // the meter → METERCT suggestion
  });
});

describe('C3 — box / fitting / hardware allowance lines on a synced bid', () => {
  async function seeded(stage: string) {
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `C3 ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    await pool.query('UPDATE bids SET stage = $1 WHERE id = $2', [stage, bidId]);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, agent1_output, agent2_output, count_result, review_items, review_status, status)
       VALUES ($1,$2,$3,$4,$5,'needs_review','agent2_complete')`,
      [bidId, JSON.stringify(run.agent1), '```json\n' + JSON.stringify(run.agent2) + '\n```', JSON.stringify(run.count_result), JSON.stringify(run.review_items)],
    );
    return { app, u, bidId };
  }

  it('a bid still being estimated gets the allowance lines (no PVC on this job → no PVC line), each priced from its ALW-* item', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seeded('due');
    const res = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const allow = (res.body.lines as Array<Line & { category: string }>).filter(l => l.category === 'Boxes, Fittings & Hardware (allowance)');
    expect(allow).toHaveLength(6);
    const { rows } = await pool.query('SELECT id, code FROM est_items WHERE code LIKE $1', ['ALW-%']);
    const codeById = new Map(rows.map(r => [r.id, r.code]));
    expect(allow.map(l => codeById.get(l.item_id!)).sort()).toEqual(['ALW-BOX', 'ALW-FIT-EMT', 'ALW-FIT-MCLUM', 'ALW-HW-FIXTURE', 'ALW-HW-RACEWAY', 'ALW-SPLICE']); // gap-closing migration 168 (J10): MC connectors per luminaire
    const box = allow.find(l => l.description.startsWith('Box allowance'))!;
    expect(box.qty).toBeGreaterThan(40);
    expect(box.evidence_note).toMatch(/calibrated on 5 of Chris's jobs/);
  });

  it('a submitted bid never gets them (its price never moves on a sync)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app, u, bidId } = await seeded('submitted');
    const res = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect((res.body.lines as Array<{ category: string }>).some(l => l.category === 'Boxes, Fittings & Hardware (allowance)')).toBe(false);
  });

  it('PUT /api/settings refuses a bad est_box_fitting_allowance', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const r = await request(app).put('/api/settings').set(auth(admin.token)).send({ est_box_fitting_allowance: '{"scale":{"box":-2}}' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/scale.box must be at least 0/);
  });
});
