// Plans-panel fix round, Task 2 — wired end to end: when the (mocked)
// Anthropic call throws a credit-balance-shaped API error, the friendly
// text (not the raw JSON body) is what lands in bid_job_profile.error and
// what GET /job-profile returns. No real Anthropic call is made.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({ shouldThrow: false }));

class FakeAnthropicAPIError extends Error {
  status: number; type: string; error: { type: string; error: { type: string; message: string } };
  constructor(status: number, type: string, message: string) {
    super(`${status} ${JSON.stringify({ type: 'error', error: { type, message } })}`);
    this.status = status;
    this.type = type;
    this.error = { type: 'error', error: { type, message } };
  }
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: () => ({
        finalMessage: async () => {
          if (state.shouldThrow) {
            throw new FakeAnthropicAPIError(400, 'invalid_request_error', 'Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.');
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
import { sha256 } from '../services/sheetCheck';
import { CREDIT_BALANCE_MESSAGE } from '../ai/friendlyError';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

let ok = false;
const createdDocs: string[] = [];
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
afterAll(async () => {
  if (ok && createdDocs.length) await pool.query('DELETE FROM documents WHERE id = ANY($1::uuid[])', [createdDocs]).catch(() => {});
});

async function makeBid(user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `JobProfileErr ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
  return res.body.id as string;
}

async function addDoc(bidId: string, name: string, buf: Buffer): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, display_name, category, file_type, file_data, uploaded_by, generated)
     VALUES ($1, $2, $2, 'plans', 'application/pdf', $3, 'test', false) RETURNING id`,
    [bidId, name, buf.toString('base64')]);
  createdDocs.push(rows[0].id);
  return rows[0].id as string;
}

async function seedCompleteCheck(bidId: string, buf: Buffer) {
  const sha = sha256(buf);
  const coverText = 'COVER SHEET\nOWNER / DEVELOPER: TEST OWNER LLC\nSITE ADDRESS: 123 MAIN ST, TAMPA, FL 33601\n'.repeat(3);
  const pages = [{
    key: `${sha}#1`, file: 'plans.pdf', sha, page: 1, sheetNo: 'T-1', title: 'COVER SHEET', discipline: 'cover',
    cls: 'plan', textChars: coverText.length, hasTextLayer: true, classified: true, refs: [], role: 'analysis', reason: 'cover',
  }];
  const result = { version: 1, pages, refs: [], unclassifiedFiles: [], otherFiles: [], checkedAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO bid_sheet_check (bid_id, status, run_token, input_key, result, finished_at, updated_at)
     VALUES ($1, 'complete', 'seeded', $2, $3, now(), now())`,
    [bidId, sha, JSON.stringify(result)]);
  return coverText;
}

vi.mock('../ai/pdfText', async () => {
  const actual = await vi.importActual<typeof import('../ai/pdfText')>('../ai/pdfText');
  return { ...actual, extractPdfPageTexts: async () => ['COVER SHEET\nOWNER / DEVELOPER: TEST OWNER LLC\nSITE ADDRESS: 123 MAIN ST, TAMPA, FL 33601\n'.repeat(3)] };
});

describe('Job profile run — a credit-balance error is friendly, never raw JSON', () => {
  it('stores and returns the exact friendly message; the raw JSON never reaches the response', async () => {
    if (!ok) return;
    state.shouldThrow = true;
    try {
      const u = await makeUser('estimator');
      const bidId = await makeBid(u);
      const buf = Buffer.from('%PDF-1.4 FAKE PLANS\n%%EOF');
      await addDoc(bidId, 'plans.pdf', buf);
      await seedCompleteCheck(bidId, buf);

      const res = await request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(u.token)).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.error).toBe(CREDIT_BALANCE_MESSAGE);
      expect(res.body.error).not.toMatch(/\{|"type"|invalid_request_error/);

      const got = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
      expect(got.body.error).toBe(CREDIT_BALANCE_MESSAGE);

      const { rows } = await pool.query('SELECT error FROM bid_job_profile WHERE bid_id=$1', [bidId]);
      expect(rows[0].error).toBe(CREDIT_BALANCE_MESSAGE);
      expect(rows[0].error).not.toMatch(/\{|"type"/);
    } finally {
      state.shouldThrow = false;
    }
  }, 30_000);
});
