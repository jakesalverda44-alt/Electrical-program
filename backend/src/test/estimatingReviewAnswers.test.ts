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

    // Saved through sync-takeoff too (the same rows), and 'confirm' is a legal stored value.
    const synced = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    expect((synced.body.lines as Line[]).filter(l => /^Type H\b/.test(l.description)).map(l => l.qty)).toEqual([13]);
    expect((synced.body.lines as Line[]).some(l => l.match_confidence === 'confirm')).toBe(true); // the meter → METERCT suggestion
  });
});
