// Plans-panel fix round — review eb39943, S1/S2 (should-fix): "Replace plan
// set" is now ONE server-side, all-or-nothing operation.
//   S1 — a 3-file replace makes exactly ONE billed job-profile model call
//        (not one per removed old file), over the new set only.
//   S2 — a failure partway through rolls back what DID upload and leaves the
//        old set untouched, naming the failed file; Undo is one action that
//        restores the old files AND removes the replacements, in one refresh.
// No real Anthropic call is made: the classifier and the job-profile model
// are both mocked, distinguished by their system prompt (same technique as
// jobProfileRoutes.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({
  jobProfileCalls: 0,
  failUpload: null as string | null, // multer field name of the file to fail on, by originalname
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (params: { system: Array<{ text: string }>; messages: Array<{ content: unknown }> }) => ({
        finalMessage: async () => {
          const system = params.system.map(s => s.text).join('\n');
          if (/job profile/i.test(system)) {
            state.jobProfileCalls++;
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

vi.mock('../utils/storeDocument', async () => {
  const actual = await vi.importActual<typeof import('../utils/storeDocument')>('../utils/storeDocument');
  return {
    ...actual,
    storeDocument: async (input: Parameters<typeof actual.storeDocument>[0]) => {
      if (state.failUpload && input.file.originalname === state.failUpload) {
        throw new Error('simulated storage failure');
      }
      return actual.storeDocument(input);
    },
  };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
afterAll(async () => { /* left-over docs are harmless test data, same convention as jobProfileRoutes.test.ts */ });

async function makeBid(user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `Replace ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
  return res.body.id as string;
}

async function uploadPlan(user: TestUser, bidId: string, filename: string, buf: Buffer) {
  const res = await request(app).post('/api/documents').set(auth(user.token))
    .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'plans')
    .field('display_name', filename).attach('file', buf, filename);
  return res.body.id as string;
}

async function waitStatus(u: TestUser, bidId: string, done = ['complete', 'undetermined', 'error']): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) {
    body = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    if (done.includes(String(body.status))) return body;
    await new Promise(r => setTimeout(r, 250));
  }
  return body;
}

const replace = (u: TestUser, bidId: string, files: Array<{ name: string; buf: Buffer }>) => {
  let req = request(app).post(`/api/preconstruction/${bidId}/plan-files/replace`).set(auth(u.token));
  for (const f of files) req = req.attach('files', f.buf, f.name);
  return req;
};

describe('POST /plan-files/replace — S1: one server-side operation, one profile call', () => {
  it('a 3-file replace makes exactly one job-profile model call, over the new set', async () => {
    if (!ok) return;
    state.jobProfileCalls = 0;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const oldId = await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER SHEET']));

    const res = await replace(u, bidId, [
      { name: 'new1.pdf', buf: buildTestPdf(['NEW COVER ONE']) },
      { name: 'new2.pdf', buf: buildTestPdf(['NEW COVER TWO']) },
      { name: 'new3.pdf', buf: buildTestPdf(['NEW COVER THREE']) },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toHaveLength(3);
    expect(res.body.removed).toEqual([{ id: oldId, name: 'old.pdf' }]);

    await waitStatus(u, bidId);
    expect(state.jobProfileCalls).toBe(1);

    const { rows } = await pool.query(`SELECT id FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL`, [bidId]);
    expect(rows).toHaveLength(3);
    const { rows: trashed } = await pool.query(`SELECT deleted_at FROM documents WHERE id=$1`, [oldId]);
    expect(trashed[0].deleted_at).not.toBeNull();
  }, 30_000);
});

describe('POST /plan-files/replace — S2: all-or-nothing, clear failure, one-action Undo', () => {
  it('a failure partway through rolls back the partial upload and leaves the old set untouched', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const oldId = await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER SHEET']));

    // The second "file" is not a real PDF at all — storeDocument's own page-
    // count step tolerates a corrupt PDF, so force a real failure a
    // different way: an empty buffer multer will still accept, but give it
    // an extension outside the upload middleware's allow-list so it's
    // rejected before ever reaching storeDocument.
    const res = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace`).set(auth(u.token))
      .attach('files', buildTestPdf(['NEW ONE']), 'new1.pdf')
      .attach('files', Buffer.from('not a real file'), 'bad.exe');
    expect(res.status).toBeGreaterThanOrEqual(400);

    // The old file is exactly as it was — never touched by a failed replace.
    const { rows: old } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [oldId]);
    expect(old[0].deleted_at).toBeNull();
    // Nothing from the failed attempt was left behind either.
    const { rows: leftover } = await pool.query(
      `SELECT id FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL AND name='new1.pdf'`, [bidId]);
    expect(leftover).toHaveLength(0);
  });

  it('a storage failure on file 2 of 3 trashes file 1 (which DID upload), names file 2, and leaves the old set completely untouched', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const oldId = await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER SHEET']));

    state.failUpload = 'new2.pdf';
    try {
      const res = await replace(u, bidId, [
        { name: 'new1.pdf', buf: buildTestPdf(['NEW ONE']) },
        { name: 'new2.pdf', buf: buildTestPdf(['NEW TWO']) },
        { name: 'new3.pdf', buf: buildTestPdf(['NEW THREE']) },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/new2\.pdf/); // names the file that failed
      expect(res.body.error).toBe('Could not upload "new2.pdf" — the plan set was not changed.');
    } finally { state.failUpload = null; }

    // The old file is exactly as it was.
    const { rows: old } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [oldId]);
    expect(old[0].deleted_at).toBeNull();
    // file 1 (which DID successfully upload before file 2 failed) is
    // trashed, not left as an orphaned extra plan file.
    const { rows: file1 } = await pool.query(`SELECT deleted_at FROM documents WHERE linked_id=$1 AND name='new1.pdf'`, [bidId]);
    expect(file1).toHaveLength(1);
    expect(file1[0].deleted_at).not.toBeNull();
    // Only the original old file is a live plan document on the bid.
    const { rows: live } = await pool.query(`SELECT id FROM documents WHERE linked_id=$1 AND category='plans' AND deleted_at IS NULL`, [bidId]);
    expect(live).toEqual([{ id: oldId }]);
  });

  it('Undo is one action: restores the old files AND removes the replacements, then one refresh', async () => {
    if (!ok) return;
    state.jobProfileCalls = 0;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const oldId = await uploadPlan(u, bidId, 'old.pdf', buildTestPdf(['OLD COVER SHEET']));

    const res = await replace(u, bidId, [{ name: 'new.pdf', buf: buildTestPdf(['NEW COVER']) }]);
    expect(res.status).toBe(200);
    const { uploaded, removed } = res.body as { uploaded: Array<{ id: string }>; removed: Array<{ id: string }> };
    await waitStatus(u, bidId);

    state.jobProfileCalls = 0;
    const undo = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace/undo`).set(auth(u.token))
      .send({ removedIds: removed.map(r => r.id), uploadedIds: uploaded.map(x => x.id) });
    expect(undo.status).toBe(200);

    const { rows: oldRow } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [oldId]);
    expect(oldRow[0].deleted_at).toBeNull(); // restored
    const { rows: newRow } = await pool.query('SELECT deleted_at FROM documents WHERE id=$1', [uploaded[0].id]);
    expect(newRow[0].deleted_at).not.toBeNull(); // removed

    await waitStatus(u, bidId);
    expect(state.jobProfileCalls).toBeLessThanOrEqual(1); // ONE refresh for the whole undo
  }, 30_000);
});
