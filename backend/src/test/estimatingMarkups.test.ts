// Estimating Phase B, Task 3 — /api/estimating/:bidId/markups* routes:
// batch create/update/delete (idempotent), soft delete, rollup, apply ->
// est_bid_lines + bid_estimates + bids.amount + composeBidData takeoff all
// show the confirmed qty, and sync-takeoff keeps a markup-confirmed qty.
//
// Real data shapes throughout (Phase A review lesson): lines come from a
// real seedTakeoff() -> sync-takeoff round trip (real takeoff_key/
// takeoff_item_id/line_key), not hand-crafted est_bid_lines rows; the sheet
// comes from the real fixture PDF parsed through the real sheets pipeline.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { buildSampleSheetPdf } from './fixtures/estimating/buildSheetPdf';
import { composeBidData, SavedConfidenceItem } from '../bidstd/composeBidData';
import { Agent4Output } from '../ai/agent4Message';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `Markups ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' })
    .expect(200);
  return res.body.id as string;
}

async function seedTakeoff(bidId: string, rows: { category: string; item: string; spec?: string; qty: number | string; unit: string; confidence?: string }[]) {
  const json = JSON.stringify({ takeoff: rows });
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
     ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2, status='agent2_complete'`,
    [bidId, '```json\n' + json + '\n```']
  );
}

async function makePlanDocAndSheet(app: import('express').Express, user: TestUser, bidId: string): Promise<{ docId: string }> {
  const buf = buildSampleSheetPdf();
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
     VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', $2, 'test') RETURNING id`,
    [bidId, buf.toString('base64')]
  );
  const docId = rows[0].id as string;
  await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(user.token)).expect(200);
  return { docId };
}

async function calibrateSheet(app: import('express').Express, user: TestUser, bidId: string, docId: string, ftPerPt: number) {
  await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(user.token))
    .send({ ft_per_pt: ftPerPt, source: 'calibrated', label: 'Calibrated' }).expect(200);
}

describe('POST /api/estimating/:bidId/markups/batch — create/update/delete', () => {
  it('creates count and linear markups, lists them, updates one, and soft-deletes another', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);

    const countId = randomUUID();
    const linearId = randomUUID();
    const toDeleteId = randomUUID();

    const created = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: countId, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 100, y: 100 }] },
        { id: linearId, document_id: docId, page_index: 0, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], drops: 1, drop_ft: 10, slack_pct: 10 },
        { id: toDeleteId, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 50, y: 50 }] },
      ],
      updates: [], deletes: [],
    }).expect(200);
    expect(created.body.created.length).toBe(3);
    expect(created.body.skipped.length).toBe(0);

    const listed = await request(app).get(`/api/estimating/${bidId}/markups`).set(auth(u.token)).expect(200);
    expect(listed.body.markups.length).toBe(3);

    // Update the linear markup's points and reassign it, delete the third.
    const batch2 = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [],
      updates: [{ id: linearId, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], label: 'Home run to panel' }],
      deletes: [toDeleteId],
    }).expect(200);
    expect(batch2.body.updated.length).toBe(1);
    expect(batch2.body.updated[0].points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    expect(batch2.body.updated[0].label).toBe('Home run to panel');
    expect(batch2.body.deleted).toEqual([toDeleteId]);

    const afterDelete = await request(app).get(`/api/estimating/${bidId}/markups`).set(auth(u.token)).expect(200);
    expect(afterDelete.body.markups.length).toBe(2); // the deleted one is gone from the live list
    expect(afterDelete.body.markups.map((m: { id: string }) => m.id)).not.toContain(toDeleteId);

    // Soft delete, not gone: deleted_at is set, the row still exists.
    const { rows } = await pool.query('SELECT deleted_at FROM est_markups WHERE id=$1', [toDeleteId]);
    expect(rows[0].deleted_at).toBeTruthy();
  });

  // Fix round 1 / B3(a) — the reviewer's exact scenario: delete a marker,
  // then undo (== re-create with the SAME id, via the client's own
  // create-idempotent-by-id batch shape). Before the fix, re-upserting a
  // soft-deleted id never matched ON CONFLICT's WHERE clause, so the
  // "revived" marker was silently skipped — it stayed deleted server-side
  // even though the client showed it reappearing and autosave said "Saved".
  it('re-upserting a SOFT-DELETED id (undo-a-delete) revives it — deleted_at clears and the new values apply', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();

    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 10, y: 10 }] }],
      updates: [], deletes: [],
    }).expect(200);

    const delRes = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [], updates: [], deletes: [id],
    }).expect(200);
    expect(delRes.body.deleted).toEqual([id]);
    const { rows: afterDelete } = await pool.query('SELECT deleted_at FROM est_markups WHERE id=$1', [id]);
    expect(afterDelete[0].deleted_at).toBeTruthy();

    // Undo: re-create the SAME id (this is exactly what a client-side undo
    // does — restore the pre-delete snapshot and let autosave's own
    // create-is-idempotent-by-id batch shape re-send it).
    const undoRes = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 10, y: 10 }] }],
      updates: [], deletes: [],
    }).expect(200);
    expect(undoRes.body.created.length).toBe(1); // NOT skipped
    expect(undoRes.body.skipped).toEqual([]);

    const { rows: revived } = await pool.query('SELECT deleted_at FROM est_markups WHERE id=$1', [id]);
    expect(revived[0].deleted_at).toBeNull();

    // It's genuinely back — counted by the rollup and by the plain markups list.
    const listed = await request(app).get(`/api/estimating/${bidId}/markups`).set(auth(u.token)).expect(200);
    expect(listed.body.markups.map((m: { id: string }) => m.id)).toContain(id);
  });

  // Regression guard for the SAME fix: only bid_id (never deleted_at) gates
  // the ON CONFLICT WHERE clause now — confirm a genuinely cross-bid id
  // collision is STILL rejected, not accidentally opened up by the
  // deleted_at removal.
  it('a create id colliding with a DIFFERENT bid\'s existing markup is still skipped, never overwritten', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidA = await makeBid(app, u);
    const bidB = await makeBid(app, u);
    const { docId: docA } = await makePlanDocAndSheet(app, u, bidA);
    const { docId: docB } = await makePlanDocAndSheet(app, u, bidB);
    const id = randomUUID();

    await request(app).post(`/api/estimating/${bidA}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docA, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }] }],
      updates: [], deletes: [],
    }).expect(200);

    const crossBidRes = await request(app).post(`/api/estimating/${bidB}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docB, page_index: 0, kind: 'count', points: [{ x: 2, y: 2 }] }],
      updates: [], deletes: [],
    }).expect(200);
    expect(crossBidRes.body.created).toEqual([]);
    expect(crossBidRes.body.skipped).toEqual([{ id, reason: 'id already belongs to a different bid' }]);

    // Bid A's own row is untouched.
    const { rows } = await pool.query('SELECT bid_id, points FROM est_markups WHERE id=$1', [id]);
    expect(rows.length).toBe(1);
    expect(rows[0].bid_id).toBe(bidA);
    expect(rows[0].points).toEqual([{ x: 1, y: 1 }]);
  });

  it('is idempotent by client-generated uuid: re-sending the same create id does not duplicate or error', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();
    const payload = { creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 10, y: 10 }] }], updates: [], deletes: [] };

    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send(payload).expect(200);
    // Retry (simulating a lost-ack autosave retry) with different point data —
    // same id, so it should re-apply (upsert), not fail or create a second row.
    const retryPayload = { creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 20, y: 20 }] }], updates: [], deletes: [] };
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send(retryPayload).expect(200);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].cnt).toBe(1); // never duplicated
    const listed = await request(app).get(`/api/estimating/${bidId}/markups`).set(auth(u.token)).expect(200);
    expect(listed.body.markups[0].points).toEqual([{ x: 20, y: 20 }]); // the retry's values won
  });

  // Fix round 1 / S5 — a malformed item used to 400 the WHOLE batch; now
  // it's a 200 with the bad item named in `skipped` and 0 rows written
  // for it specifically (a separate, valid item in the same batch would
  // still land — covered by the dedicated per-item tests below).
  it('validates points (finite x/y, correct cardinality per kind) and skips a malformed batch item without erroring', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);

    const res1 = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id: randomUUID(), document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], // 2 points on a count markup
      updates: [], deletes: [],
    }).expect(200);
    expect(res1.body.created).toEqual([]);
    expect(res1.body.skipped.length).toBe(1);

    const res2 = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      // "abc" over the wire (NaN itself isn't valid JSON — JSON.stringify
      // would silently turn it into null, which is finite as a number).
      creates: [{ id: randomUUID(), document_id: docId, page_index: 0, kind: 'linear', points: [{ x: 'abc', y: 1 }, { x: 2, y: 2 }] }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res2.body.created).toEqual([]);
    expect(res2.body.skipped.length).toBe(1);

    // 0 confirmed rows written after either rejected batch.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE bid_id=$1', [bidId]);
    expect(rows[0].cnt).toBe(0);
  });

  // Fix round 1 / B2 — the reviewer's exact repro: a proposed (never-saved)
  // estimate's lines carry a "proposed-N" placeholder line_key, not a real
  // UUID. Before the fix this was silently coerced to null (unassigned) —
  // the client never learned, the marker just looked assigned forever
  // while the server quietly dropped it.
  // Fix round 1 / S5 — a bad line_key on ONE item used to 400 the WHOLE
  // batch, which meant one poisoned item (a stray "proposed-N" from a
  // never-saved estimate still in a stale client diff) could block every
  // OTHER, perfectly valid item in the same autosave forever. Now it's a
  // 200 with the bad item named in `skipped`, and everything else still
  // lands.
  it('a present-but-malformed line_key (e.g. a "proposed-N" placeholder) is skipped (not silently coerced to null), without blocking the rest of the batch', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const badId = randomUUID();
    const goodId = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: badId, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }], line_key: 'proposed-0' },
        { id: goodId, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 2, y: 2 }] },
      ],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created.map((c: { id: string }) => c.id)).toEqual([goodId]);
    expect(res.body.skipped.some((s: { id: string }) => s.id === badId)).toBe(true);

    // The bad one was never written — not even as unassigned. The good
    // one, in the SAME batch, was.
    const { rows: bad } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [badId]);
    expect(bad[0].cnt).toBe(0);
    const { rows: good } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [goodId]);
    expect(good[0].cnt).toBe(1);
  });

  it('line_key absent or explicitly null is still valid (unassigned is a real, intentional state)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const idAbsent = randomUUID();
    const idNull = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: idAbsent, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }] }, // line_key omitted
        { id: idNull, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 2, y: 2 }], line_key: null },
      ],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created.length).toBe(2);
    expect(res.body.skipped).toEqual([]);
  });

  // Fix round 1 / B2 — a WELL-FORMED UUID that simply doesn't belong to
  // this bid's own est_bid_lines (a stale client cache, or literally
  // another bid's line_key) must also be rejected, not silently written.
  it('a well-formed line_key UUID that does not belong to THIS bid\'s lines is skipped, not written', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();
    const foreignLineKey = randomUUID(); // well-formed, but no est_bid_lines row anywhere has this key

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }], line_key: foreignLineKey }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.skipped[0]).toMatchObject({ id, reason: expect.stringContaining(foreignLineKey) });

    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].cnt).toBe(0);
  });

  it('a REAL line_key belonging to this bid is accepted normally', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);

    const saveRes = await request(app).put(`/api/estimating/${bidId}`).set(auth(u.token)).send({
      lines: [{ category: 'Branch Power', description: 'Duplex', qty: 5, unit: 'EA', source: 'manual', material_unit_override: 5, labor_hours_override: 0.5 }],
      settings: { labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0 },
    }).expect(200);
    const lineKey = saveRes.body.lines[0].line_key as string;
    const id = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }], line_key: lineKey }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created.length).toBe(1);
    expect(res.body.created[0].lineKey).toBe(lineKey);
  });

  it('an UPDATE that reassigns to a malformed/foreign line_key is skipped the same way as a create', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }] }],
      updates: [], deletes: [],
    }).expect(200);

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [], updates: [{ id, line_key: 'proposed-0' }], deletes: [],
    }).expect(200);
    expect(res.body.updated).toEqual([]);
    expect(res.body.skipped[0].id).toBe(id);

    // Still unassigned — the bad update never applied.
    const { rows } = await pool.query('SELECT line_key FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].line_key).toBeNull();
  });

  // Fix round 1 / S5 — document_id is checked against this bid now, same
  // as line_key: a count/linear markup used to be able to reference
  // ANOTHER bid's document id and still roll up (getRollup never
  // cross-checked it).
  it('a create referencing a document_id that does not belong to this bid is skipped, not written', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const otherBidId = await makeBid(app, u);
    const { docId: otherBidDocId } = await makePlanDocAndSheet(app, u, otherBidId);
    const id = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: otherBidDocId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }] }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.skipped[0]).toMatchObject({ id, reason: expect.stringContaining(otherBidDocId) });

    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].cnt).toBe(0);
  });

  // Fix round 1 / S5 — an {x: null, y: null} point used to be stored as
  // (0, 0) (Number(null) === 0, and 0 is finite); now it's rejected.
  it('a point with null/non-numeric x or y is skipped, not stored as (0, 0)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'count', points: [{ x: null, y: null }] }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.skipped[0].id).toBe(id);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM est_markups WHERE id=$1', [id]);
    expect(rows[0].cnt).toBe(0);
  });

  // Fix round 1 / S5 — drops is an INTEGER column; a fractional value
  // used to pass validation (Number.isFinite(1.5) is true) and hit the
  // DB as a type error (500 for the whole batch).
  it('a fractional drops value is skipped, not a 500 for the whole batch', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const badId = randomUUID();
    const goodId = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: badId, document_id: docId, page_index: 0, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], drops: 1.5 },
        { id: goodId, document_id: docId, page_index: 0, kind: 'count', points: [{ x: 1, y: 1 }] },
      ],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created.map((c: { id: string }) => c.id)).toEqual([goodId]);
    expect(res.body.skipped[0].id).toBe(badId);
  });

  // Fix round 1 / S5 — slack_pct is NUMERIC(6,2); an out-of-range value
  // used to overflow the column at write time (a Postgres error -> 500
  // for the whole batch).
  it('an out-of-range slack_pct is skipped, not a numeric overflow 500', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    const id = randomUUID();

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id, document_id: docId, page_index: 0, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], slack_pct: 12000 }],
      updates: [], deletes: [],
    }).expect(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.skipped[0].id).toBe(id);
  });

  // Fix round 1 / S5 — a non-UUID id in `deletes` used to reach the DB
  // layer as a raw string against a `uuid` column (a Postgres type
  // error -> 500 for the whole batch). It's filtered out silently now —
  // deleting a nonsense id is inherently a no-op, nothing to report.
  it('a non-UUID id in deletes is filtered out silently, without erroring the batch', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [], updates: [], deletes: ['not-a-uuid'],
    }).expect(200);
    expect(res.body.deleted).toEqual([]);
    expect(res.body.skipped).toEqual([]);
  });

  // Fix round 1 / S5 — a non-UUID id in `updates` used to reach the DB
  // layer the same way (a Postgres type error -> 500 for the whole
  // batch). Unlike deletes, an update NAMES a real intended target, so
  // it's reported back as skipped rather than silently dropped.
  it('a non-UUID id in updates is skipped and reported, not a 500', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);

    const res = await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [], updates: [{ id: 'not-a-uuid', drops: 1 }], deletes: [],
    }).expect(200);
    expect(res.body.updated).toEqual([]);
    expect(res.body.skipped[0].id).toBe('not-a-uuid');
  });
});

describe('GET /api/estimating/:bidId/markups/rollup', () => {
  it('rolls up confirmed count markups into an EA line\'s markedQty, ignoring suggested ones', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.lines;
    const lineKey = lines[0].line_key as string;

    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: [{ x: 10, y: 10 }] },
        { id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: [{ x: 20, y: 20 }] },
        { id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: [{ x: 30, y: 30 }], status: 'suggested' },
      ],
      updates: [], deletes: [],
    }).expect(200);

    const rollup = await request(app).get(`/api/estimating/${bidId}/markups/rollup`).set(auth(u.token)).expect(200);
    const entry = rollup.body.rollup.find((r: { lineKey: string }) => r.lineKey === lineKey);
    expect(entry.markedQty).toBe(2); // only the 2 confirmed markers
    expect(entry.currentQty).toBe(10); // the takeoff's qty, unchanged so far
    expect(entry.qtySource).toBe('takeoff');
  });

  it('rolls up a confirmed linear run into feet, converted via the sheet\'s calibrated scale', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    await calibrateSheet(app, u, bidId, docId, 0.1); // 0.1 ft/pt
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '3/4" EMT', qty: 500, unit: 'LF' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.lines;
    const lineKey = lines[0].line_key as string;

    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], drops: 0, slack_pct: 0 }],
      updates: [], deletes: [],
    }).expect(200);

    const rollup = await request(app).get(`/api/estimating/${bidId}/markups/rollup`).set(auth(u.token)).expect(200);
    const entry = rollup.body.rollup.find((r: { lineKey: string }) => r.lineKey === lineKey);
    expect(entry.markedQty).toBeCloseTo(10, 6); // 100pt * 0.1 ft/pt
  });
});

describe('POST /api/estimating/:bidId/apply-markups', () => {
  it('applies a confirmed count rollup: est_bid_lines, bid_estimates.line_items and bids.amount all reflect the confirmed qty, and composeBidData routes it into the takeoff output', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const before = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body;
    const line = before.lines[0];
    const lineKey = line.line_key as string;
    const takeoffItemId = line.takeoff_item_id as string;
    expect(takeoffItemId).toBeTruthy();

    // Confirm 24 fixtures on the plans — more than the AI's takeoff qty of 10.
    const points = Array.from({ length: 24 }, (_, i) => [{ x: 10 + i * 5, y: 10 }]);
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: points.map((p, i) => ({ id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: p })),
      updates: [], deletes: [],
    }).expect(200);

    const applyRes = await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [lineKey] }).expect(200);
    expect(applyRes.body.applied).toEqual([lineKey]);
    expect(applyRes.body.skipped).toEqual([]);
    const grandTotal = applyRes.body.save.recap.totals.grandTotal;

    // est_bid_lines reflects the confirmed qty and its provenance.
    const { rows: lineRows } = await pool.query('SELECT qty, qty_source, qty_overridden, confidence FROM est_bid_lines WHERE line_key=$1', [lineKey]);
    expect(Number(lineRows[0].qty)).toBe(24);
    expect(lineRows[0].qty_source).toBe('markup');
    expect(lineRows[0].qty_overridden).toBe(true);
    expect(lineRows[0].confidence).toBe('FIRM');

    // bid_estimates.line_items carries qty_source through, and bids.amount
    // agrees with the recap the apply call returned (Decision 4: the two
    // can never drift, same as every other save).
    const { rows: beRows } = await pool.query('SELECT line_items, grand_total FROM bid_estimates WHERE bid_id=$1', [bidId]);
    const savedLineItems = beRows[0].line_items as SavedConfidenceItem[];
    const savedLine = savedLineItems.find(li => li.item === takeoffItemId)!;
    expect(savedLine.qty_source).toBe('markup');
    expect(savedLine.qty).toBe(24);
    expect(Number(beRows[0].grand_total)).toBeCloseTo(grandTotal, 2);
    const { rows: bidRows } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    expect(Number(bidRows[0].amount)).toBeCloseTo(grandTotal, 2);

    // composeBidData (pure) picks the confirmed qty up for the takeoff
    // outputs (takeoff xlsx / pre-bid package / the proposal's own takeoff
    // table all read data.takeoff, composed from exactly this).
    const agent4: Agent4Output = {
      plan_date: '01.01.2026', sheets: ['E1.1'],
      takeoff: [{ name: 'Branch Power', items: [{ item: takeoffItemId, description: 'Duplex receptacle', unit: 'EA', qty: 10, source: 'E1.1' }] }],
    };
    const { data } = composeBidData({ name: 'Test', gc: 'GC' }, agent4, '$1', { savedLineItems });
    const composedItem = data.takeoff.find(c => c.name === 'Branch Power')!.items[0];
    expect(composedItem.qty).toBe(24); // NOT Agent 4's echoed 10
  });

  // Fix round 1 / N6 — a linear run's markedQty is a sum of point-distance
  // * ft_per_pt segments, which routinely lands on floating-point noise
  // (e.g. 100pt * 1/3 ft/pt = 33.3333333...). Applying that raw precision
  // used to flow straight into est_bid_lines/the takeoff output; it's now
  // rounded to 2 decimals at apply time.
  it('rounds a linear run\'s applied qty to 2 decimals (no floating-point noise in the saved qty)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    await calibrateSheet(app, u, bidId, docId, 1 / 3); // 0.333333... ft/pt
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '3/4" EMT', qty: 500, unit: 'LF' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const lines = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body.lines;
    const lineKey = lines[0].line_key as string;

    // 100pt * (1/3) ft/pt = 33.333333... ft, well past 2 decimals of noise.
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [{ id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'linear', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], drops: 0, slack_pct: 0 }],
      updates: [], deletes: [],
    }).expect(200);

    const applyRes = await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [lineKey] }).expect(200);
    expect(applyRes.body.applied).toEqual([lineKey]);

    const { rows } = await pool.query('SELECT qty FROM est_bid_lines WHERE line_key=$1', [lineKey]);
    expect(Number(rows[0].qty)).toBe(33.33); // not 33.333333333333336
  });

  it('skips a line with no confirmed markups, without silently zeroing its qty (Decision 4: never overwrite silently)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await makePlanDocAndSheet(app, u, bidId);
    await seedTakeoff(bidId, [{ category: 'Grounding', item: '5/8" x 10\' copper-clad ground rod w/ exothermic connection', qty: 2, unit: 'EA' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const before = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body;
    const lineKey = before.lines[0].line_key as string;

    const applyRes = await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [lineKey] }).expect(200);
    expect(applyRes.body.applied).toEqual([]);
    expect(applyRes.body.skipped[0].lineKey).toBe(lineKey);

    const { rows } = await pool.query('SELECT qty, qty_source FROM est_bid_lines WHERE line_key=$1', [lineKey]);
    expect(Number(rows[0].qty)).toBe(2); // untouched
    expect(rows[0].qty_source).toBe('takeoff');
  });

  it('a re-sync AFTER apply keeps the markup-confirmed qty even when the AI takeoff qty changes (Task 3: sync treats qty_source=markup like an override)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { docId } = await makePlanDocAndSheet(app, u, bidId);
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' }]);
    await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const before = (await request(app).get(`/api/estimating/${bidId}`).set(auth(u.token)).expect(200)).body;
    const lineKey = before.lines[0].line_key as string;

    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({
      creates: [
        { id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: [{ x: 1, y: 1 }] },
        { id: randomUUID(), document_id: docId, page_index: 0, line_key: lineKey, kind: 'count', points: [{ x: 2, y: 2 }] },
      ],
      updates: [], deletes: [],
    }).expect(200);
    await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [lineKey] }).expect(200);

    // The AI re-runs and now says 99 — a re-sync must NOT clobber the
    // estimator's confirmed 2.
    await seedTakeoff(bidId, [{ category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 99, unit: 'EA' }]);
    const syncRes = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(u.token)).expect(200);
    const synced = syncRes.body.lines.find((l: { line_key: string }) => l.line_key === lineKey);
    expect(synced.qty).toBe(2); // NOT 99
    expect(synced.qty_source).toBe('markup');
    expect(synced.qty_overridden).toBe(true);

    const { rows } = await pool.query('SELECT qty, qty_source FROM est_bid_lines WHERE line_key=$1', [lineKey]);
    expect(Number(rows[0].qty)).toBe(2);
    expect(rows[0].qty_source).toBe('markup');
  });

  it('404s a bid that does not exist, 403s a salesperson applying to another rep\'s bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    await request(app).post('/api/estimating/00000000-0000-0000-0000-000000000000/apply-markups')
      .set(auth(u.token)).send({ line_keys: [randomUUID()] }).expect(404);

    const owner = await makeUser('salesperson');
    const bidId = await makeBid(app, owner);
    const intruder = await makeUser('salesperson');
    await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(intruder.token))
      .send({ line_keys: [randomUUID()] }).expect(403);
  });

  it('rejects an empty line_keys array with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).post(`/api/estimating/${bidId}/apply-markups`).set(auth(u.token)).send({ line_keys: [] }).expect(400);
  });
});
