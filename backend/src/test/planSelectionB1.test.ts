// B1 (live test, bid 041c6d48, 2026-09-28) — an empty sheet-check run must not wipe a good check.
// No real Anthropic/Drive/email call: the SDK is mocked (job profile calls counted).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';

const state = vi.hoisted(() => ({ jobProfileCalls: 0 }));

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

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';

let ok = false;
let u: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) u = await makeUser('estimator'); }, 30_000);

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
async function makeBid(): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(u.token))
    .send({ name: `PlanSel ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC' }).expect(200);
  return res.body.id as string;
}
async function uploadPlan(bidId: string, filename: string, buf: Buffer) {
  const res = await request(app).post('/api/documents').set(auth(u.token))
    .field('linked_id', bidId).field('linked_name', 'test bid').field('div', 'elec').field('category', 'plans')
    .field('display_name', filename).attach('file', buf, filename);
  return res.body as { id: string; duplicate?: boolean };
}
async function waitProfile(bidId: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) {
    body = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    if (['complete', 'undetermined', 'error'].includes(String(body.status))) return body;
    await new Promise(r => setTimeout(r, 250));
  }
  return body;
}

describe('B1 — an empty sheet-check run never overwrites a good check', () => {
  it('stale (trashed) ids: 400 naming the problem, existing check untouched', async () => {
    if (!ok) return;
    const bidId = await makeBid();
    const doc = await uploadPlan(bidId, 'good.pdf', buildTestPdf(['COVER SHEET GOOD']));
    // A good, finished check exists for the current file.
    const goodResult = { pages: [{ key: 'k1', sheetNo: 'E-1' }], refs: [], checkedAt: '2026-09-28T17:46:00.000Z', unclassifiedFiles: [], otherFiles: [] };
    await pool.query(
      `INSERT INTO bid_sheet_check (bid_id, status, result, input_key, finished_at, updated_at) VALUES ($1,'complete',$2,'GOODKEY',now(),now())`,
      [bidId, JSON.stringify(goodResult)]);
    // The doc the stale Estimating page still has ticked: trashed.
    const trashed = await uploadPlan(bidId, 'old.pdf', buildTestPdf(['COVER SHEET OLD']));
    await pool.query('UPDATE documents SET deleted_at=now() WHERE id=$1', [trashed.id]);

    const res = await request(app).post(`/api/preconstruction/${bidId}/sheet-check/run`).set(auth(u.token))
      .field('document_ids', trashed.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/none of the selected files are current/i);
    const { rows } = await pool.query('SELECT status, result, input_key FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
    expect(rows[0].status).toBe('complete');
    expect(rows[0].input_key).toBe('GOODKEY');
    expect(rows[0].result.pages).toHaveLength(1);
    void doc;
  }, 30_000);

  it('/analyze with only trashed ids says so specifically', async () => {
    if (!ok) return;
    const bidId = await makeBid();
    const trashed = await uploadPlan(bidId, 'old.pdf', buildTestPdf(['COVER SHEET OLD2']));
    await pool.query('UPDATE documents SET deleted_at=now() WHERE id=$1', [trashed.id]);
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(u.token))
      .field('bidId', bidId).field('document_ids', trashed.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/removed or replaced/i);
  }, 30_000);
});

