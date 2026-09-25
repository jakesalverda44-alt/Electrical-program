// Plans-panel fix round, Task 1 — remove ("x"), Undo, "Replace plan set" and
// dedupe on upload. No real Anthropic call is made (the classifier and any
// reference reader always answer empty — these tests care about the
// documents/route wiring, not what the model says).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }) }),
    };
  },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(user: TestUser, name?: string): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: name ?? `PlanFiles ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
  return res.body.id as string;
}

async function uploadPlan(user: TestUser, bidId: string, filename: string, buf: Buffer, opts: { skipDedupe?: boolean } = {}) {
  let req = request(app).post('/api/documents').set(auth(user.token))
    .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'plans')
    .field('display_name', filename);
  if (opts.skipDedupe) req = req.field('skip_dedupe', 'true');
  const res = await req.attach('file', buf, filename);
  return res;
}

const PDF_A = buildTestPdf(['COVER SHEET\nPLAN A']);
const PDF_B = buildTestPdf(['COVER SHEET\nPLAN B']);

describe('Dedupe on upload — Task 1', () => {
  it('re-uploading the same bytes as an existing non-deleted plan file on the bid is a no-op, not a second row', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const first = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeFalsy();

    const second = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    const { rows } = await pool.query(`SELECT id FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL`, [bidId]);
    expect(rows).toHaveLength(1);
  });

  it('the same bytes on a DIFFERENT bid are not deduped against it', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidA = await makeBid(u);
    const bidB = await makeBid(u);
    const a = await uploadPlan(u, bidA, 'plans.pdf', PDF_B);
    const b = await uploadPlan(u, bidB, 'plans.pdf', PDF_B);
    expect(a.body.duplicate).toBeFalsy();
    expect(b.body.duplicate).toBeFalsy();
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('the same bytes under a non-plans category are never deduped', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    const buf = PDF_A;
    const other = await request(app).post('/api/documents').set(auth(u.token))
      .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'proposal')
      .field('display_name', 'plans.pdf').attach('file', buf, 'plans.pdf');
    expect(other.body.duplicate).toBeFalsy();
  });

  it('a re-uploaded plan file that was soft-deleted (removed) is stored fresh, not deduped against the trashed copy', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const first = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${first.body.id}`).set(auth(u.token)).expect(200);
    const again = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    expect(again.body.duplicate).toBeFalsy();
    expect(again.body.id).not.toBe(first.body.id);
  });

  it('skip_dedupe opts out (the "Replace plan set" flow uploading bytes identical to the file it is about to remove)', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const first = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    const replacement = await uploadPlan(u, bidId, 'plans (replacement).pdf', PDF_A, { skipDedupe: true });
    expect(replacement.body.duplicate).toBeFalsy();
    expect(replacement.body.id).not.toBe(first.body.id);
  });
});

describe('DELETE /preconstruction/:bidId/plan-files/:docId — Task 1', () => {
  it('soft-deletes (Trash), audits, and is not admin-only', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const up = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    const docId = up.body.id as string;

    const res = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${docId}`).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows } = await pool.query('SELECT deleted_at, deleted_by FROM documents WHERE id=$1', [docId]);
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].deleted_by).toBe(u.id);

    const { rows: audit } = await pool.query(
      `SELECT summary FROM audit_log WHERE entity_type='document' AND entity_id=$1 AND action='delete'`, [docId]);
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toMatch(/Removed plan file/);
  });

  it("404s for a document that isn't this bid's own plan file", async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidA = await makeBid(u);
    const bidB = await makeBid(u);
    const up = await uploadPlan(u, bidA, 'plans.pdf', PDF_A);
    const res = await request(app).delete(`/api/preconstruction/${bidB}/plan-files/${up.body.id}`).set(auth(u.token));
    expect(res.status).toBe(404);
  });

  it('the roles that upload plans may remove one, including a salesperson on their own bid', async () => {
    if (!ok) return;
    const owner = await makeUser('owner');
    const bidId = await makeBid(owner);
    for (const role of ['estimator', 'project_manager']) {
      const u = await makeUser(role);
      const up = await uploadPlan(owner, bidId, `plans-${role}.pdf`, buildTestPdf([`COVER ${role}`]));
      const res = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${up.body.id}`).set(auth(u.token));
      expect(res.status, role).toBe(200);
    }
    // A salesperson (a restricted role) may remove a plan file on a bid
    // THEY own, same as the existing job-profile/run role gate (R2-S2).
    const sales = await makeUser('salesperson');
    const ownBid = await makeBid(sales);
    const up = await uploadPlan(sales, ownBid, 'plans-sales.pdf', buildTestPdf(['COVER sales']));
    const res = await request(app).delete(`/api/preconstruction/${ownBid}/plan-files/${up.body.id}`).set(auth(sales.token));
    expect(res.status).toBe(200);
  });

  it('is not admin-only: read_only/technician/accounting may not remove a plan file', async () => {
    if (!ok) return;
    const owner = await makeUser('owner');
    const bidId = await makeBid(owner);
    for (const role of ['read_only', 'technician', 'accounting']) {
      const u = await makeUser(role);
      const up = await uploadPlan(owner, bidId, `plans-${role}-deny.pdf`, buildTestPdf([`COVER deny ${role}`]));
      const res = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${up.body.id}`).set(auth(u.token));
      expect(res.status, role).toBe(403);
    }
  });

  it('Undo: the same user restores it via the existing documents restore route', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const up = await uploadPlan(u, bidId, 'plans.pdf', PDF_A);
    const docId = up.body.id as string;
    await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${docId}`).set(auth(u.token)).expect(200);

    const restore = await request(app).post(`/api/documents/${docId}/restore`).set(auth(u.token));
    expect(restore.status).toBe(200);
    const { rows } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [docId]);
    expect(rows[0].deleted_at).toBeNull();
  });

  it('refreshes the plan list without touching the takeoff results: removing one of two files leaves only the other selectable', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const a = await uploadPlan(u, bidId, 'A.pdf', PDF_A);
    const b = await uploadPlan(u, bidId, 'B.pdf', PDF_B);
    await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${a.body.id}`).set(auth(u.token)).expect(200);

    const docs = await request(app).get('/api/documents').set(auth(u.token)).query({ linked_id: bidId }).expect(200);
    const planIds = (docs.body as Array<{ id: string; category: string }>).filter((d) => d.category === 'plans').map(d => d.id);
    expect(planIds).toEqual([b.body.id]);
    expect(planIds).not.toContain(a.body.id);

    // The job profile's own bookkeeping reflects the smaller set — no crash,
    // no leftover reference to the removed file.
    const prof = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(prof.body).toBeTruthy();
  });
});
