// Fix round 1 / S6 — the learning capture hook can never affect a committed
// marker save, and it reads only the rows a batch touches. Test DB only.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

vi.mock('../ai/learning/capture', async (orig) => ({
  ...(await orig<typeof import('../ai/learning/capture')>()),
  capturesFromMarkupBatch: () => { throw new Error('boom: capture build failed'); },
}));

import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { buildSampleSheetPdf } from './fixtures/estimating/buildSheetPdf';
import { getMarkupsByIds } from '../estimating/markups';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('the markup batch with a failing capture hook', () => {
  it('a save is committed and answered 200 even when the capture build throws; getMarkupsByIds reads only the named rows', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `Guard ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
    const bidId = bid.body.id as string;
    const d = await pool.query(`INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by) VALUES ($1,'plans.pdf','plans','application/pdf',$2,'test') RETURNING id`, [bidId, buildSampleSheetPdf().toString('base64')]);
    const docId = d.rows[0].id as string;
    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    const a = randomUUID(), b = randomUUID();
    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id: a, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 10, y: 10 }] }, { id: b, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 20, y: 20 }] }], updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created).toHaveLength(2);
    // an update + delete batch (the path that reads the "before" rows) is also safe
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({ creates: [], updates: [{ id: a, status: 'confirmed' }], deletes: [b] }).expect(200);
    expect((await getMarkupsByIds(bidId, [a])).map(r => r.id)).toEqual([a]);
    expect(await getMarkupsByIds(bidId, [])).toEqual([]);
    expect(await getMarkupsByIds(bidId, [b])).toEqual([]); // soft-deleted
  });
});
