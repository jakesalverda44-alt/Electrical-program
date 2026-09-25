// Plans-panel review addendum (eb39943..fc08a97) — PB1 (blocker) and PS1
// (should-fix), plus the within-request dedupe nit.
//   PB1 — POST .../plan-files/replace/undo had no role gate, and accepted
//         free-form removedIds/uploadedIds naming ANY plan document on the
//         bid: a read_only user could trash live plan files through it.
//         Undo now takes an opId the replace itself created and returns,
//         gated the same way as every other plan-files route, and scoped to
//         the user who made the replace (or an admin/manager).
//   PS1 — Undo is all-or-nothing in one transaction: if any of the
//         replace's own removed files can't actually be restored (purged,
//         or outside the usual restore window), nothing changes and the
//         response is 409.
//   Nit — the same bytes picked twice in one replace upload are stored once.
// No real Anthropic call is made.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (params: { system: Array<{ text: string }>; messages: Array<{ content: unknown }> }) => ({
        finalMessage: async () => {
          const system = params.system.map(s => s.text).join('\n');
          if (/job profile/i.test(system)) {
            return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
          }
          if (/construction document sheet classifier/i.test(system)) {
            const content = params.messages[0].content as Array<{ type: string; text?: string }>;
            const text = content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
            const pages = [...text.matchAll(/Page (\d+) \(absolute/g)].map(m => Number(m[1]));
            const arr = pages.map(p => ({ page: p, sheetNo: 'T-1', title: 'COVER SHEET', discipline: 'cover', cls: 'plan' }));
            return { content: [{ type: 'text', text: JSON.stringify(arr) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
          }
          return { content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
        },
      }),
    };
  },
}));

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `ReplaceUndoSec ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
  return res.body.id as string;
}

async function uploadPlan(user: TestUser, bidId: string, filename: string, buf: Buffer) {
  const res = await request(app).post('/api/documents').set(auth(user.token))
    .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'plans')
    .field('display_name', filename).attach('file', buf, filename);
  return res.body.id as string;
}

const replace = (u: TestUser, bidId: string, files: Array<{ name: string; buf: Buffer }>) => {
  let req = request(app).post(`/api/preconstruction/${bidId}/plan-files/replace`).set(auth(u.token));
  for (const f of files) req = req.attach('files', f.buf, f.name);
  return req;
};

async function waitStatus(u: TestUser, bidId: string, done = ['complete', 'undetermined', 'error']): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) {
    body = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    if (done.includes(String(body.status))) return body;
    await new Promise(r => setTimeout(r, 250));
  }
  return body;
}

describe('PB1 (blocker) — undo is role-gated and op-scoped, never a free-form document trash', () => {
  it('read_only gets 403, even with a well-formed opId', async () => {
    if (!ok) return;
    const owner = await makeUser('owner');
    const bidId = await makeBid(owner);
    await uploadPlan(owner, bidId, 'old.pdf', buildTestPdf(['OLD COVER']));
    const res = await replace(owner, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW COVER']) }]);
    const { replaceOpId } = res.body as { replaceOpId: string };
    await waitStatus(owner, bidId);

    const ro = await makeUser('read_only');
    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(ro.token)).send({ opId: replaceOpId });
    expect(undo.status).toBe(403);

    // Nothing changed.
    const { rows } = await pool.query(`SELECT id FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL`, [bidId]);
    expect(rows).toHaveLength(1);
  });

  it("arbitrary plan doc ids can't be trashed through undo: the old free-form body shape does nothing", async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const liveDocId = await uploadPlan(u, bidId, 'unrelated.pdf', buildTestPdf(['UNRELATED PLAN']));

    // The pre-addendum request shape: no opId, just ids naming a real plan
    // document on the bid. Must never trash it.
    const res = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token))
      .send({ removedIds: [], uploadedIds: [liveDocId] });
    expect(res.status).toBe(404); // no valid opId at all

    const { rows } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [liveDocId]);
    expect(rows[0].deleted_at).toBeNull();
  });

  it("a different (non-privileged, non-owner) user's undo of someone else's replace is 403, and an unknown opId is 404", async () => {
    if (!ok) return;
    const maker = await makeUser('estimator');
    const bidId = await makeBid(maker);
    await uploadPlan(maker, bidId, 'old.pdf', buildTestPdf(['OLD COVER']));
    const res = await replace(maker, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW COVER']) }]);
    const { replaceOpId, uploaded } = res.body as { replaceOpId: string; uploaded: Array<{ id: string }> };
    await waitStatus(maker, bidId);

    const other = await makeUser('estimator');
    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(other.token)).send({ opId: replaceOpId });
    expect(undo.status).toBe(403);

    const unknown = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(maker.token)).send({ opId: '00000000-0000-0000-0000-000000000000' });
    expect(unknown.status).toBe(404);

    const malformed = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(maker.token)).send({ opId: 'not-a-uuid' });
    expect(malformed.status).toBe(404);

    // Still live and untouched by any of the above.
    const { rows } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [uploaded[0].id]);
    expect(rows[0].deleted_at).toBeNull();
  });

  it('an admin (privileged) MAY undo a replace made by someone else', async () => {
    if (!ok) return;
    const maker = await makeUser('estimator');
    const bidId = await makeBid(maker);
    const oldId = await uploadPlan(maker, bidId, 'old.pdf', buildTestPdf(['OLD COVER']));
    const res = await replace(maker, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW COVER']) }]);
    const { replaceOpId } = res.body as { replaceOpId: string };
    await waitStatus(maker, bidId);

    const admin = await makeUser('owner');
    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(admin.token)).send({ opId: replaceOpId });
    expect(undo.status).toBe(200);
    const { rows } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [oldId]);
    expect(rows[0].deleted_at).toBeNull();
  });

  it('the same opId can only be undone once (already-undone -> 404, not a repeat trash/restore)', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER']));
    const res = await replace(u, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW COVER']) }]);
    const { replaceOpId } = res.body as { replaceOpId: string };
    await waitStatus(u, bidId);

    const first = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token)).send({ opId: replaceOpId });
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token)).send({ opId: replaceOpId });
    expect(second.status).toBe(404);
  });
});

describe('PS1 (should-fix) — undo is all-or-nothing in one transaction', () => {
  it("the addendum's exact repro: a replaced-over old file that can no longer be restored refuses the WHOLE undo with 409, changing nothing", async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const old1 = await uploadPlan(u, bidId, 'old1.pdf', buildTestPdf(['OLD 1']));
    const old2 = await uploadPlan(u, bidId, 'old2.pdf', buildTestPdf(['OLD 2']));
    const res = await replace(u, bidId, [
      { name: 'new1.pdf', buf: buildTestPdf(['NEW 1']) },
      { name: 'new2.pdf', buf: buildTestPdf(['NEW 2']) },
    ]);
    const { uploaded, replaceOpId } = res.body as { uploaded: Array<{ id: string; name: string }>; replaceOpId: string };
    await waitStatus(u, bidId);

    // "The old files' restore window lapses" (addendum step 3) — simulated
    // directly: old1's Trash row ages past the 10-minute restore window.
    await pool.query(`UPDATE documents SET deleted_at = now() - interval '20 minutes' WHERE id=$1`, [old1]);

    // "The user removes new2 and uploads extra.pdf" (addendum step 2) — a
    // change since the replace that must NOT block or corrupt the undo
    // attempt's atomicity check, and must be left alone either way.
    const new2 = uploaded.find(x => x.name === 'new2.pdf')!;
    await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${new2.id}`).set(auth(u.token)).expect(200);
    await uploadPlan(u, bidId, 'extra.pdf', buildTestPdf(['EXTRA']));

    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token)).send({ opId: replaceOpId });
    expect(undo.status).toBe(409);
    expect(undo.body.error).toMatch(/restore the old files from Trash/);

    // Nothing changed: old1 and old2 both still in Trash (old1 unrestorable,
    // old2 untouched because the whole transaction rolled back), new1 is
    // still live (not trashed despite the failed undo), extra.pdf untouched.
    const { rows: old1Row } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [old1]);
    expect(old1Row[0].deleted_at).not.toBeNull();
    const { rows: old2Row } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [old2]);
    expect(old2Row[0].deleted_at).not.toBeNull();
    const new1 = uploaded.find(x => x.name === 'new1.pdf')!;
    const { rows: new1Row } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [new1.id]);
    expect(new1Row[0].deleted_at).toBeNull();
    const { rows: extraRow } = await pool.query(`SELECT id FROM documents WHERE linked_id=$1 AND name='extra.pdf' AND deleted_at IS NULL`, [bidId]);
    expect(extraRow).toHaveLength(1);
  });

  it('a purged (hard-deleted) old file also refuses the whole undo with 409', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const old1 = await uploadPlan(u, bidId, 'old1.pdf', buildTestPdf(['OLD 1']));
    const old2 = await uploadPlan(u, bidId, 'old2.pdf', buildTestPdf(['OLD 2']));
    const res = await replace(u, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW']) }]);
    const { replaceOpId } = res.body as { replaceOpId: string };
    await waitStatus(u, bidId);

    await pool.query('DELETE FROM documents WHERE id=$1', [old1]); // an admin emptied Trash

    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token)).send({ opId: replaceOpId });
    expect(undo.status).toBe(409);
    const { rows: old2Row } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [old2]);
    expect(old2Row[0].deleted_at).not.toBeNull(); // still in Trash — untouched
  });
});

describe('Nit — dedupe within one replace request by content hash', () => {
  it('the same bytes picked twice in one upload are stored once', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER']));
    const sameBytes = buildTestPdf(['DUPLICATE WITHIN REQUEST']);

    const res = await replace(u, bidId, [
      { name: 'a.pdf', buf: sameBytes },
      { name: 'b.pdf', buf: sameBytes },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toHaveLength(1);
    expect(res.body.skippedDuplicates).toEqual(['b.pdf']);

    const { rows } = await pool.query(`SELECT name FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL`, [bidId]);
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['a.pdf']);
  });
});
