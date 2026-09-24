// Evidence round 5.2 — POST /:bidId/finish-bid: an eval case derived from
// the bid's own confirmed counts, stored with its inputs referenced.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import type { CountResult } from '../ai/countingStage';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `FinishBid Test ${Date.now()}`, gc: `Finish Bid Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 75_000, brand: 'AutoZone' })
    .expect(200);
  return res.body.id as string;
}

const type = (over: Partial<CountResult['types'][number]>): CountResult['types'][number] => ({
  key: 'X', type: 'X', description: '', category: 'device', count: 0, heads: null, status: 'zero', reason: '',
  sheets: [], flags: [], wattage: null, ...over,
});

async function setCountResult(bidId: string, types: CountResult['types']) {
  const cr: CountResult = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types,
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [], marks: [] };
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, status, count_result, review_status) VALUES ($1,'agent1_complete',$2,'clear')
     ON CONFLICT (bid_id) DO UPDATE SET count_result=$2`,
    [bidId, JSON.stringify(cr)]
  );
}

describe('POST /:bidId/finish-bid', () => {
  it('400s with no takeoff analysis yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    const res = await request(app).post(`/api/preconstruction/${bidId}/finish-bid`).set(auth(u.token));
    expect(res.status).toBe(400);
  });

  it('400s when nothing is confirmed yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [type({ key: 'Z', status: 'zero', count: 0 })]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/finish-bid`).set(auth(u.token));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resolve the takeoff review/);
  });

  it('stores an eval case from the bid\'s confirmed counts, tagged with the brand, referencing its inputs', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [
      type({ key: 'A', type: 'A', description: 'Troffer', status: 'counted', count: 12 }),
      type({ key: 'B', status: 'zero', count: 0 }), // still open — never in the answer key
    ]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/finish-bid`).set(auth(u.token)).expect(200);
    expect(res.body.itemCount).toBe(1);
    expect(res.body.expected).toEqual([{ id: 'A', label: 'Type A — Troffer', expected: 12, types: ['A'], source: 'confirmed' }]);

    const { rows } = await pool.query('SELECT * FROM takeoff_eval_cases WHERE bid_id=$1', [bidId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client: 'AutoZone', source: 'confirmed_counts', created_by: u.name });
    expect(rows[0].expected).toEqual(res.body.expected);
    expect(rows[0].inputs_ref).toMatchObject({ runId: null });
  });

  it('a caller-named BOM import reference is recorded as the eval case\'s source, not re-derived', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [type({ key: 'A', status: 'counted', count: 5 })]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/finish-bid`).set(auth(u.token)).send({ bomImportDocumentId: 'doc-123' }).expect(200);
    expect(res.body.itemCount).toBe(1);
    const { rows } = await pool.query('SELECT source, inputs_ref FROM takeoff_eval_cases WHERE bid_id=$1', [bidId]);
    expect(rows[0].source).toBe('bom_import');
    expect(rows[0].inputs_ref).toMatchObject({ bomImportDocumentId: 'doc-123' });
  });
});
