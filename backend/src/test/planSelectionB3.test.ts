// B3 (2026-09-28) — after "Replace plan set" a 'waiting' job profile must run exactly once.
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

describe('B3 — a waiting job profile runs once after a replace', () => {
  it('replace -> exactly one profile model call -> complete', async () => {
    if (!ok) return;
    state.jobProfileCalls = 0;
    const bidId = await makeBid();
    await uploadPlan(bidId, 'old.pdf', buildTestPdf(['OLD COVER B3']));
    const newBuf = buildTestPdf(['NEW COVER B3']);
    // The upload path already requested a profile for the NEW set: 'waiting',
    // content_key === the new set's input key, fresh updated_at.
    await pool.query(
      `INSERT INTO bid_job_profile (bid_id, status, run_token, pending_doc_ids, content_key, updated_at)
       VALUES ($1,'waiting',$2,NULL,$3,now())`, [bidId, crypto.randomUUID(), sha(newBuf)]);
    const res = await request(app).post(`/api/preconstruction/${bidId}/plan-files/replace`).set(auth(u.token))
      .attach('files', newBuf, 'new.pdf');
    expect(res.status).toBe(200);
    const body = await waitProfile(bidId);
    expect(['complete', 'undetermined']).toContain(String(body.status));
    expect(state.jobProfileCalls).toBe(1);
    await new Promise(r => setTimeout(r, 500));
    expect(state.jobProfileCalls).toBe(1);
  }, 40_000);
});

