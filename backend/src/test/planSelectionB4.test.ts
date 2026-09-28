// B4 (2026-09-28) — dedupe must also catch docs filed before migration 146 (NULL hash).
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
import { backfillContentHashes } from '../utils/backfillContentHashes';

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

describe('B4 — dedupe catches documents filed before content_sha256 existed', () => {
  it('backfills a NULL-hash legacy row, then the same bytes are deduped', async () => {
    if (!ok) return;
    const bidId = await makeBid();
    const buf = buildTestPdf(['LEGACY PLAN B4']);
    const first = await uploadPlan(bidId, 'legacy.pdf', buf);
    await pool.query('UPDATE documents SET content_sha256=NULL WHERE id=$1', [first.id]);
    // Also a legacy row with no bytes at all: skipped, never crashes.
    await pool.query(
      `INSERT INTO documents (linked_id, name, display_name, category, file_type, uploaded_by, storage_url)
       VALUES ($1,'gone.pdf','gone.pdf','plans','application/pdf','t','http://127.0.0.1:1/nothing.pdf')`, [bidId]);

    const again = await uploadPlan(bidId, 'legacy-copy.pdf', buf);
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(first.id);
    const { rows } = await pool.query('SELECT content_sha256 FROM documents WHERE id=$1', [first.id]);
    expect(rows[0].content_sha256).toBe(sha(buf));

    // The boot backfill fills NULLs too (cap honoured) and reports counts.
    await pool.query('UPDATE documents SET content_sha256=NULL WHERE id=$1', [first.id]);
    const r = await backfillContentHashes({ limit: 500, bidId });
    expect(r.hashed).toBe(1);
    expect(r.unreadable).toBe(1);
    const { rows: after } = await pool.query('SELECT content_sha256 FROM documents WHERE id=$1', [first.id]);
    expect(after[0].content_sha256).toBe(sha(buf));
  }, 30_000);
});
