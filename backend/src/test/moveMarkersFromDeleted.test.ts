// Move markers from a deleted plan copy onto the current copy (explicit action).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `MoveMk ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  return res.body.id as string;
}
async function insertDoc(bidId: string, name: string, opts: { deleted?: boolean; sha?: string } = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, uploaded_by, deleted_at, content_sha256)
     VALUES ($1, $2, 'plans', 'application/pdf', 'test', ${opts.deleted ? 'now()' : 'NULL'}, $3) RETURNING id`,
    [bidId, name, opts.sha ?? null]
  );
  return rows[0].id as string;
}
async function insertSheet(bidId: string, docId: string, page: number, w = 2592, h = 1728) {
  await pool.query(
    `INSERT INTO est_sheets (bid_id, document_id, page_index, sheet_no, title, width_pt, height_pt) VALUES ($1,$2,$3,'E-1','T',$4,$5)`,
    [bidId, docId, page, w, h]
  );
}
async function insertMarkup(bidId: string, docId: string, page: number) {
  await pool.query(
    `INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status) VALUES ($1,$2,$3,'count','[[10,10]]'::jsonb,'confirmed')`,
    [bidId, docId, page]
  );
}
const onDoc = async (docId: string) =>
  Number((await pool.query(`SELECT count(*)::int AS n FROM est_markups WHERE document_id = $1 AND deleted_at IS NULL`, [docId])).rows[0].n);
const url = (bidId: string) => `/api/estimating/${bidId}/markups/move-from-deleted`;

describe('POST /api/estimating/:bidId/markups/move-from-deleted', () => {
  it('moves markers to the same-hash current copy; pages with a different size stay and are reported', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const sha = 'a'.repeat(64);
    const old = await insertDoc(bidId, 'old.pdf', { deleted: true, sha });
    const cur = await insertDoc(bidId, 'new.pdf', { sha });
    await insertSheet(bidId, old, 0); await insertSheet(bidId, old, 1, 2592, 1728);
    await insertSheet(bidId, cur, 0); await insertSheet(bidId, cur, 1, 1224, 792);
    await insertMarkup(bidId, old, 0); await insertMarkup(bidId, old, 0); await insertMarkup(bidId, old, 1);

    const res = await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: old }).expect(200);
    expect(res.body).toEqual({ moved: 2, skipped: 1, targetDocumentId: cur });
    expect(await onDoc(cur)).toBe(2);
    expect(await onDoc(old)).toBe(1);
  });

  it('falls back to the same file name when there is no hash match', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const old = await insertDoc(bidId, 'Plans.pdf', { deleted: true });
    const cur = await insertDoc(bidId, 'plans.pdf');
    await insertDoc(bidId, 'other.pdf');
    await insertSheet(bidId, old, 0); await insertSheet(bidId, cur, 0);
    await insertMarkup(bidId, old, 0);
    const res = await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: old }).expect(200);
    expect(res.body).toMatchObject({ moved: 1, skipped: 0, targetDocumentId: cur });
  });

  it('409 when there is no unique current copy', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const old = await insertDoc(bidId, 'old.pdf', { deleted: true });
    const a = await insertDoc(bidId, 'a.pdf'); const b = await insertDoc(bidId, 'b.pdf');
    for (const d of [old, a, b]) await insertSheet(bidId, d, 0);
    await insertMarkup(bidId, old, 0);
    const res = await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: old }).expect(409);
    expect(res.body.error).toMatch(/exactly one current copy/);
    expect(await onDoc(old)).toBe(1);
  });

  it('404 for another bid\'s document, 403 for another user, 400 for a live copy', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('salesperson');
    const bidId = await makeBid(app, u);
    const otherBid = await makeBid(app, u);
    const foreign = await insertDoc(otherBid, 'x.pdf', { deleted: true });
    await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: foreign }).expect(404);
    const live = await insertDoc(bidId, 'live.pdf');
    await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: live }).expect(400);
    await request(app).post(url(bidId)).set(auth(u.token)).send({ fromDocumentId: 'nope' }).expect(400);
    const intruder = await makeUser('salesperson');
    await request(app).post(url(bidId)).set(auth(intruder.token)).send({ fromDocumentId: live }).expect(403);
  });
});
