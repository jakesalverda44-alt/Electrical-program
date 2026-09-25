// Plans-panel fix round — review eb39943: S3, S4, and the nits (N1-N3).
// No real Anthropic call: the classifier always answers "cover", and the
// job-profile model always answers "{}" (same technique as
// planFilesReplaceAtomic.test.ts).
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
import { sha256 } from '../services/sheetCheck';
import { storeDocument } from '../utils/storeDocument';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `ReviewFix ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
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

function onePageResult(inputKey: string, buf: Buffer, file = 'estimating-set.pdf') {
  const sha = sha256(buf);
  return {
    version: 1,
    pages: [{
      key: `${sha}#1`, file, sha, page: 1, sheetNo: 'T-1', title: 'COVER SHEET', discipline: 'cover', cls: 'plan',
      textChars: 100, hasTextLayer: true, classified: true, refs: [], role: 'analysis', reason: '',
    }],
    refs: [], unclassifiedFiles: [], otherFiles: [], checkedAt: new Date().toISOString(),
  };
}

async function seedEstimatingCheck(bidId: string, inputKey: string, buf: Buffer) {
  await pool.query(
    `INSERT INTO bid_sheet_check (bid_id, status, run_token, input_key, result, finished_at, updated_at)
     VALUES ($1, 'complete', 'estimating-seeded', $2, $3, now(), now())
     ON CONFLICT (bid_id) DO UPDATE SET status='complete', run_token='estimating-seeded', input_key=$2, result=$3, finished_at=now(), updated_at=now()`,
    [bidId, inputKey, JSON.stringify(onePageResult(inputKey, buf))]);
}

describe('S3 — remove/restore never overwrites a sheet check Estimating already made for its own selection', () => {
  it("removing a plan file that isn't part of Estimating's ticked selection leaves that check row untouched", async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const bufA = buildTestPdf(['COVER A']);
    await uploadPlan(u, bidId, 'A.pdf', bufA);
    const bufB = buildTestPdf(['COVER B']);
    await uploadPlan(u, bidId, 'B.pdf', bufB);
    const docC = await uploadPlan(u, bidId, 'C.pdf', buildTestPdf(['COVER C']));

    // Estimating's own check: only A is ticked (never involving B or C), and
    // no job-profile run has ever happened on this bid.
    await seedEstimatingCheck(bidId, sha256(bufA), bufA);
    const before = (await pool.query('SELECT run_token, input_key FROM bid_sheet_check WHERE bid_id=$1', [bidId])).rows[0];

    const res = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${docC}`).set(auth(u.token));
    expect(res.status).toBe(200);

    const after = (await pool.query('SELECT run_token, input_key FROM bid_sheet_check WHERE bid_id=$1', [bidId])).rows[0];
    expect(after.run_token).toBe(before.run_token);
    expect(after.input_key).toBe(before.input_key);
  });
});

describe('S4 — restore refreshes the sheet check so the summary is current, when it is safe to', () => {
  it('remove then restore ends with the summary describing the full, current set again', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const docA = await uploadPlan(u, bidId, 'A.pdf', buildTestPdf(['COVER A']));
    await uploadPlan(u, bidId, 'B.pdf', buildTestPdf(['COVER B']));

    // A normal first read over the full {A, B} set — this bid's own
    // job-profile flow now "owns" the shared sheet check row.
    const firstRun = await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token));
    expect([200, 202]).toContain(firstRun.status);
    await waitStatus(u, bidId);
    const afterFirstRun = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    expect(afterFirstRun.sheet_summary).toMatchObject({ total: 2 });

    const del = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/${docA}`).set(auth(u.token));
    expect(del.status).toBe(200);
    await waitStatus(u, bidId);
    const afterRemove = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    expect(afterRemove.sheet_summary).toMatchObject({ total: 1 }); // reclaimed for the smaller set — no Estimating divergence here

    const restore = await request(app).post(`/api/preconstruction/${bidId}/plan-files/${docA}/restore`).set(auth(u.token));
    expect(restore.status).toBe(200);
    await waitStatus(u, bidId);
    const afterRestore = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    expect(afterRestore.sheet_summary).toMatchObject({ total: 2 }); // current again — never stuck at the smaller set
  }, 30_000);
});

describe('N1 — a malformed id is a 404, never a raw 500', () => {
  it('DELETE .../plan-files/not-a-uuid', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const res = await request(app).delete(`/api/preconstruction/${bidId}/plan-files/not-a-uuid`).set(auth(u.token));
    expect(res.status).toBe(404);
  });

  it('POST .../plan-files/not-a-uuid/restore', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const res = await request(app).post(`/api/preconstruction/${bidId}/plan-files/not-a-uuid/restore`).set(auth(u.token));
    expect(res.status).toBe(404);
  });
});

describe('N2 — a stored raw JSON error is mapped to friendly text on read', () => {
  it('GET /job-profile sanitizes an old raw error row', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Claude API."}}';
    await pool.query(
      `INSERT INTO bid_job_profile (bid_id, status, error, updated_at) VALUES ($1, 'error', $2, now())
       ON CONFLICT (bid_id) DO UPDATE SET status='error', error=$2, updated_at=now()`,
      [bidId, raw]);
    const res = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(res.body.error).not.toMatch(/\{|"type"/);
    expect(res.body.error).toMatch(/out of credits/);
  });

  it('GET /sheet-check sanitizes an old raw error row', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const raw = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    await pool.query(
      `INSERT INTO bid_sheet_check (bid_id, status, error, updated_at) VALUES ($1, 'error', $2, now())
       ON CONFLICT (bid_id) DO UPDATE SET status='error', error=$2, updated_at=now()`,
      [bidId, raw]);
    const res = await request(app).get(`/api/preconstruction/${bidId}/sheet-check`).set(auth(u.token)).expect(200);
    expect(res.body.error).not.toMatch(/\{|"type"/);
    expect(res.body.error).toMatch(/overloaded/i);
  });
});

describe('N3 — dedupe excludes generated documents', () => {
  it('a generated plan document with the same bytes never blocks a real re-upload as a duplicate', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = buildTestPdf(['GENERATED PLAN COPY']);
    const file = {
      fieldname: 'file', originalname: 'generated.pdf', encoding: '7bit', mimetype: 'application/pdf',
      buffer: buf, size: buf.length, stream: undefined, destination: '', filename: 'generated.pdf', path: '',
    } as unknown as Express.Multer.File;
    await storeDocument({ file, linkedId: bidId, linkedName: 'test bid', div: 'elec', category: 'plans', uploadedBy: 'Test User', generated: true });

    const res = await request(app).post('/api/documents').set(auth(u.token))
      .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'plans')
      .field('display_name', 'real.pdf').attach('file', buf, 'real.pdf');
    expect(res.body.duplicate).toBeFalsy();
  });
});
