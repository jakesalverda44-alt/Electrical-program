// Job profile fix round (review 1755e62) — routes/jobProfile.ts +
// services/jobProfileRun.ts through the real app and the test DB.
//
// THE MAIN TEST runs the REAL Kissimmee set through the route: when the real
// PDF is on this machine it is stored as the bid's plan document and the
// production text path (extractPdfPageTexts -> pdftotext -layout) reads it
// live; otherwise the committed fixture — that same production output, all
// 55 pages — stands in for the extraction. The sheet check's classifier
// inventory is seeded (the classifier is a Haiku call), and the ONE model
// call is mocked with a realistic reply grounded in the text it is shown.
// No real Anthropic / Drive / email call is made.
import fs from 'fs';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; system: string; text: string; images: number; params: Record<string, unknown> }>,
  reply: '' as string,
  onCall: null as null | (() => Promise<void>),
  fixturePages: null as null | string[],
  textsByMarker: {} as Record<string, string[]>,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (params: { model: string; system: Array<{ text: string }>; messages: Array<{ content: Array<{ type: string; text?: string }> }> }) => ({
        finalMessage: async () => {
          const system = params.system.map(s => s.text).join('\n');
          if (!/job profile/i.test(system)) {
            // Any other caller (the sheet check's classifier / reference
            // readers) gets an empty answer.
            return { content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
          }
          const blocks = params.messages[0].content;
          const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
          state.calls.push({ model: params.model, system, text, images: blocks.filter(b => b.type === 'image').length, params: params as unknown as Record<string, unknown> });
          if (state.onCall) await state.onCall();
          // Token counts estimated from the real prompt size (~3.6 chars /
          // token in, ~3.2 out for JSON), so the cost is grounded in it.
          return {
            content: [{ type: 'text', text: state.reply }], stop_reason: 'end_turn',
            usage: { input_tokens: Math.ceil((system.length + text.length) / 3.6), output_tokens: Math.ceil(state.reply.length / 3.2) },
          };
        },
      }),
    };
  },
}));

vi.mock('../ai/pdfText', async () => {
  const actual = await vi.importActual<typeof import('../ai/pdfText')>('../ai/pdfText');
  return {
    ...actual,
    extractPdfPageTexts: async (buf: Buffer) => {
      const head = buf.subarray(0, 80).toString('latin1');
      const m = /FIXTURE:([A-Za-z0-9_-]+)/.exec(head);
      if (m && state.textsByMarker[m[1]]) return state.textsByMarker[m[1]];
      return actual.extractPdfPageTexts(buf);
    },
  };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { sha256, applySelection } from '../services/sheetCheck';
import { resumeAfterSheetCheck, runJobProfileNow, resetStuckJobProfilesOnBoot } from '../services/jobProfileRun';
import {
  loadKissimmeePages, kissimmeeInventory, KISSIMMEE_MODEL_REPLY, KISSIMMEE_PDF_PATH, KISSIMMEE_FILE,
} from './fixtures/kissimmeeJobProfile';
import type { InventoryPage, ModelReply } from '../ai/jobProfile';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-not-real';
// Forced re-reads back to back in these tests; the rate limit has its own test.
process.env.JOB_PROFILE_MIN_INTERVAL_MS = '0';
process.env.JOB_PROFILE_FORCE_INTERVAL_MS = '0';

let ok = false;
const createdDocs: string[] = [];
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
afterAll(async () => {
  // The real PDF is ~34 MB — never leave it in the test DB.
  if (ok && createdDocs.length) await pool.query('DELETE FROM documents WHERE id = ANY($1::uuid[])', [createdDocs]).catch(() => {});
});

const fx = loadKissimmeePages();
state.textsByMarker.KISSIMMEE = fx.pages;
let realPdf: Buffer | null = null;
try {
  const b = fs.readFileSync(KISSIMMEE_PDF_PATH);
  if (b.length > 1_000_000) realPdf = b;
} catch { /* not on this machine */ }

function marker(name: string): Buffer {
  return Buffer.from(`%PDF-1.4 FIXTURE:${name} ${crypto.randomUUID()}\n%%EOF`, 'latin1');
}


async function makeBid(user: TestUser, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `JobProfile ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'Summit GC', ...extra }).expect(200);
  return res.body.id as string;
}

async function addDoc(bidId: string, name: string, buf: Buffer, extra: { category?: string; generated?: boolean; createdAt?: string } = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, display_name, category, file_type, file_data, uploaded_by, generated, created_at)
     VALUES ($1, $2, $2, $3, 'application/pdf', $4, 'test', $5, COALESCE($6::timestamptz, now())) RETURNING id`,
    [bidId, name, extra.category ?? 'plans', buf.toString('base64'), extra.generated ?? false, extra.createdAt ?? null]);
  createdDocs.push(rows[0].id);
  return rows[0].id as string;
}

/** The sheet check's result for one file, from a classifier inventory. */
async function seedSheetCheck(bidId: string, buf: Buffer, inv: InventoryPage[], status: 'complete' | 'running' = 'complete', inputKey?: string) {
  const sha = sha256(buf);
  const pages = inv.map(p => ({
    key: `${sha}#${p.page}`, file: p.file, documentId: p.documentId, sha, page: p.page, sheetNo: p.sheetNo, title: p.title,
    discipline: p.discipline, cls: 'plan', textChars: p.textChars ?? 0, hasTextLayer: (p.textChars ?? 0) >= 50, classified: true,
    refs: [], role: p.discipline === 'electrical' || p.discipline === 'cover' ? 'analysis' : 'excluded', reason: '',
  }));
  const result = status === 'complete' ? { version: 1, pages, refs: [], unclassifiedFiles: [], otherFiles: [], checkedAt: new Date().toISOString() } : null;
  await pool.query(
    `INSERT INTO bid_sheet_check (bid_id, status, run_token, input_key, result, finished_at, updated_at)
     VALUES ($1, $2, 'seeded', $3, $4, now(), now())
     ON CONFLICT (bid_id) DO UPDATE SET status=$2, run_token='seeded', input_key=$3, result=$4, finished_at=now(), updated_at=now()`,
    [bidId, status, inputKey ?? sha, result ? JSON.stringify(result) : null]);
}

/** A bid with the Kissimmee set as its plans and a complete sheet check. */
async function kissimmeeBid(user: TestUser, extra: Record<string, unknown> = {}, opts: { real?: boolean } = {}) {
  const bidId = await makeBid(user, extra);
  const buf = opts.real && realPdf ? realPdf : marker('KISSIMMEE');
  const docId = await addDoc(bidId, KISSIMMEE_FILE, buf);
  await seedSheetCheck(bidId, buf, kissimmeeInventory({ sha: sha256(buf), documentId: docId, texts: fx.pages }));
  return { bidId, docId, buf };
}

const run = (user: TestUser, bidId: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/preconstruction/${bidId}/job-profile/run`).set(auth(user.token)).send(body);

function setReply(r: ModelReply) { state.reply = JSON.stringify(r); }

// ── The real Kissimmee set, through the route ──────────────────────────────

describe('POST /job-profile/run — the REAL Kissimmee set', () => {
  it('fills only the validated high-confidence fields, suggests the rest, never touches gc', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    state.calls.length = 0;
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u, {}, { real: true });

    const res = await run(u, bidId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    const bid = res.body.bid;

    // ONE model call, the default Sonnet 5, over the selected pages only.
    expect(state.calls).toHaveLength(1);
    const call = state.calls[0];
    expect(call.model).toBe('claude-sonnet-5');
    const sheets = [...call.text.matchAll(/=== SHEET (\S+) \(/g)].map(m => m[1]);
    expect(sheets).toEqual(['C0.1', 'A-0', 'A-1.1', 'C2.1', 'E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'PH0.1']);
    expect(call.text).not.toMatch(/BACKFILLING IN THE PIPE/); // C0.2's notes are never read
    expect(call.images).toBe(0);

    expect(bid.gc).toBe('Summit GC');
    expect(bid.brand).toBe('AutoZone');
    expect(bid.project_type).toBe('retail');
    expect(bid.store_number).toBe('10077');
    expect(bid.loc).toBe('2860 N Old Lake Wilson Rd, Kissimmee, FL 34747');
    expect(Number(bid.sq_ft)).toBe(7381);
    expect(bid.plan_date).toBe('2025-09-22'); // ISO, no time (review B3)
    expect(bid.owner_name).toBe('AUTOZONE STORES LLC');
    expect(bid.engineer).toBe('DANNY E. DOSS P.E.');
    // Medium confidence -> suggestions even though the card is empty.
    expect(bid.prototype).toBeNull();
    expect(bid.architect).toBeNull();
    expect(bid.build_type).toBeNull(); // no evidence -> never a default
    expect(bid.name).toMatch(/^JobProfile /);

    const sug = res.body.suggestions;
    expect(Object.keys(sug).sort()).toEqual(['architect', 'name', 'prototype']);
    expect(sug.name).toMatchObject({ value: 'AutoZone #10077 – Kissimmee, FL', status: 'pending' });
    expect(sug.prototype).toMatchObject({ value: '7N2-L', status: 'pending', confidence: 'medium' });
    expect(sug.architect).toMatchObject({ value: 'AUTOZONE, INC.', status: 'pending' });
    expect(res.body.systems.site_lighting).toMatchObject({ value: true, sheet: 'E-7' });
    expect(res.body.systems.fuel.value).toBeNull();
    expect(Number(res.body.cost_cents)).toBeGreaterThan(0);
    expect(res.body.fills.engineer).toMatchObject({ status: 'filled', sheet: 'E-1' });

    const { rows: audit } = await pool.query(
      `SELECT summary, before FROM audit_log WHERE entity_type='bid' AND entity_id=$1 AND summary LIKE '%auto-filled from plans%'`, [bidId]);
    expect(audit.map(a => a.summary.split(' ')[0]).sort()).toEqual(['brand', 'engineer', 'loc', 'owner_name', 'plan_date', 'project_type', 'sq_ft', 'store_number']);
    const locAudit = audit.find(a => a.summary.startsWith('loc'))!;
    expect(locAudit.before).toBe('—'); // N2 — the card's previous value

    // The report's table (produced by this production path).
    if (process.env.JOB_PROFILE_REPORT_OUT) {
      fs.writeFileSync(process.env.JOB_PROFILE_REPORT_OUT, JSON.stringify({
        textPath: realPdf ? 'real PDF via extractPdfPageTexts (live)' : 'fixture (production extractPdfPageTexts output)',
        sheetsRead: sheets, profile: res.body.profile, suggestions: sug, systems: res.body.systems, fills: res.body.fills,
        bid: { brand: bid.brand, project_type: bid.project_type, store_number: bid.store_number, prototype: bid.prototype, loc: bid.loc, sq_ft: bid.sq_ft, plan_date: bid.plan_date, owner_name: bid.owner_name, architect: bid.architect, engineer: bid.engineer, build_type: bid.build_type, gc: bid.gc },
        usage: res.body.usage, cost_cents: res.body.cost_cents, model: res.body.model, promptChars: call.text.length, rejected: res.body.rejected,
      }, null, 2));
    }
  }, 180_000);

  it('a re-run after the fills raises no false conflict (review B3) and keeps the pending suggestions', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    const again = await run(u, bidId).expect(200);
    expect(Object.keys(again.body.suggestions).sort()).toEqual(['architect', 'name', 'prototype']);
    expect(again.body.suggestions.plan_date).toBeUndefined();
    expect(again.body.bid.plan_date).toBe('2025-09-22');
  });

  it('a filled card field that differs becomes a suggestion, not an overwrite', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u, { sq_ft: 7000 });
    const res = await run(u, bidId).expect(200);
    expect(Number(res.body.bid.sq_ft)).toBe(7000);
    expect(res.body.suggestions.sq_ft).toMatchObject({ value: 7381, status: 'pending', message: 'Plans say 7,381 SF — card says 7,000. Update?' });
  });
});

describe('S2 / N5 — clearing, accepting, retyping', () => {
  it('a fill the person clears is never auto-filled again for that value', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token)).send({ engineer: '' }).expect(200);
    const again = await run(u, bidId).expect(200);
    expect(again.body.bid.engineer).toBeNull();
    expect(again.body.suggestions.engineer).toBeUndefined();
    expect(again.body.fills.engineer).toMatchObject({ status: 'rejected', rejectedValues: ['DANNY E. DOSS P.E.'] });
  });

  it('accept writes the stored value and logs the previous one; a retype after accepting is not re-suggested', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    const acc = await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/architect`).set(auth(u.token))
      .send({ action: 'accept', value: 'TAMPERED' }).expect(200);
    expect(acc.body.bid.architect).toBe('AUTOZONE, INC.');
    const { rows } = await pool.query(`SELECT before, after FROM audit_log WHERE entity_id=$1 AND summary LIKE 'architect accepted%'`, [bidId]);
    expect(rows[0]).toMatchObject({ before: null, after: 'AUTOZONE, INC.' });

    await request(app).patch(`/api/bids/${bidId}`).set(auth(u.token)).send({ architect: 'RLBA Architects' }).expect(200);
    const again = await run(u, bidId).expect(200);
    expect(again.body.bid.architect).toBe('RLBA Architects');
    expect(again.body.suggestions.architect.status).toBe('overridden');
  });

  it('an ignored suggestion stays ignored on a re-run', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/name`).set(auth(u.token)).send({ action: 'ignore' }).expect(200);
    const again = await run(u, bidId).expect(200);
    expect(again.body.suggestions.name.status).toBe('ignored');
  });
});

describe('S1 — a person editing during the run wins', () => {
  it('a value typed while the model is reading is never overwritten, and an Ignore made meanwhile survives', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200); // suggestions exist (name pending)
    await pool.query(`UPDATE bids SET engineer=NULL, sq_ft=NULL WHERE id=$1`, [bidId]);
    await pool.query(`UPDATE bid_job_profile SET fills='{}'::jsonb WHERE bid_id=$1`, [bidId]);
    state.onCall = async () => {
      await pool.query(`UPDATE bids SET sq_ft=7000 WHERE id=$1`, [bidId]);
      await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/name`).set(auth(u.token)).send({ action: 'ignore' }).expect(200);
    };
    try {
      // A forced re-read (a fresh sheet check, then the model call).
      expect([200, 202]).toContain((await run(u, bidId, { force: true })).status);
      const body = await waitStatus(u, bidId) as { bid: Record<string, unknown>; suggestions: Record<string, { status: string }> };
      expect(Number(body.bid.sq_ft)).toBe(7000);
      expect(body.suggestions.sq_ft.status).toBe('pending');
      expect(body.bid.engineer).toBe('DANNY E. DOSS P.E.');
      expect(body.suggestions.name.status).toBe('ignored');
    } finally { state.onCall = null; }
  });
});

describe('S3 — document ids are this bid\'s own', () => {
  it("another bid's document is a 404 and nothing is read or filled", async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    state.calls.length = 0;
    const u = await makeUser('estimator');
    const a = await kissimmeeBid(u);
    const bidB = await makeBid(u);
    const res = await run(u, bidB, { document_ids: [a.docId] });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(0);
    const { rows } = await pool.query('SELECT brand, loc FROM bids WHERE id=$1', [bidB]);
    expect(rows[0].brand).toBeNull();
  });
});

describe('S4 — the profile waits for the sheet check', () => {
  it('202 waiting while the check for these files runs; the profile runs when it completes', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    state.calls.length = 0;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('KISSIMMEE');
    const docId = await addDoc(bidId, KISSIMMEE_FILE, buf);
    await seedSheetCheck(bidId, buf, [], 'running');
    const res = await run(u, bidId);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('waiting');
    expect(state.calls).toHaveLength(0);

    await seedSheetCheck(bidId, buf, kissimmeeInventory({ sha: sha256(buf), documentId: docId, texts: fx.pages }));
    await resumeAfterSheetCheck(bidId);
    const got = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(got.body.status).toBe('complete');
    expect(got.body.bid.brand).toBe('AutoZone');
    expect(got.body.sheet_summary).toMatchObject({ status: 'complete', total: 55 });
    expect(state.calls).toHaveLength(1);
  });

  it('with no sheet check for these files, one is started and the profile follows it', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('KISSIMMEE');
    await addDoc(bidId, KISSIMMEE_FILE, buf);
    const res = await run(u, bidId);
    expect(res.status).toBe(202);
    const { rows } = await pool.query('SELECT input_key FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
    expect(rows[0].input_key).toBe(sha256(buf));
    let status = 'waiting';
    for (let i = 0; i < 60 && (status === 'waiting' || status === 'running'); i++) {
      await new Promise(r => setTimeout(r, 250));
      status = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body.status;
    }
    expect(status).toBe('complete');
  }, 60_000);
});

describe('S7 — only the current plan set', () => {
  it('generated and superseded documents are never read', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const gen = await addDoc(bidId, 'Proposal.pdf', marker('KISSIMMEE'), { category: 'proposal', generated: true });
    const res = await run(u, bidId, { document_ids: [gen] });
    expect(res.status).toBe(400);
  });
});

describe('a scanned set', () => {
  it('no text layer and no readable image -> undetermined, nothing filled, no model call', async () => {
    if (!ok) return;
    state.calls.length = 0;
    state.textsByMarker.SCANNED = ['', '', ''];
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('SCANNED');
    const docId = await addDoc(bidId, 'scan.pdf', buf);
    await seedSheetCheck(bidId, buf, [
      { documentId: docId, file: 'scan.pdf', sha: sha256(buf), page: 1, sheetNo: 'T-1', title: 'COVER SHEET', discipline: 'cover' },
      { documentId: docId, file: 'scan.pdf', sha: sha256(buf), page: 2, sheetNo: 'A-1', title: 'FLOOR PLAN', discipline: 'architectural' },
      { documentId: docId, file: 'scan.pdf', sha: sha256(buf), page: 3, sheetNo: 'E-1', title: 'POWER PLAN', discipline: 'electrical' },
    ]);
    const res = await run(u, bidId).expect(200);
    expect(res.body.status).toBe('undetermined');
    expect(res.body.undetermined_reason).toMatch(/no text layer/);
    expect(state.calls).toHaveLength(0);
    expect(res.body.bid.build_type).toBeNull();
    expect(res.body.bid.brand).toBeNull();
    expect(res.body.suggestions).toEqual({});
  });
});

describe('PUT suggestions — guards', () => {
  it('gc is never a suggestible field', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    await request(app).put(`/api/preconstruction/${bidId}/job-profile/suggestions/gc`).set(auth(u.token)).send({ action: 'accept' }).expect(400);
  });
});

// ── Round 2 ───────────────────────────────────────────────────────────────

async function waitStatus(u: TestUser, bidId: string, done = ['complete', 'undetermined', 'error']): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) {
    body = (await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token))).body;
    if (done.includes(String(body.status))) return body;
    await new Promise(r => setTimeout(r, 250));
  }
  return body;
}

describe('R2-S1 — exactly one model call per run', () => {
  it('two concurrent runs of one waiting token, and two concurrent resumes, call the model once', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    for (const mode of ['run', 'resume'] as const) {
      state.calls.length = 0;
      const bidId = await makeBid(u);
      const buf = marker('KISSIMMEE');
      const docId = await addDoc(bidId, KISSIMMEE_FILE, buf);
      await seedSheetCheck(bidId, buf, [], 'running');
      expect((await run(u, bidId)).status).toBe(202);
      await seedSheetCheck(bidId, buf, kissimmeeInventory({ sha: sha256(buf), documentId: docId, texts: fx.pages }));
      const { rows } = await pool.query('SELECT run_token FROM bid_job_profile WHERE bid_id=$1', [bidId]);
      if (mode === 'run') await Promise.all([runJobProfileNow(bidId, rows[0].run_token), runJobProfileNow(bidId, rows[0].run_token)]);
      else await Promise.all([resumeAfterSheetCheck(bidId), resumeAfterSheetCheck(bidId)]);
      expect(state.calls, mode).toHaveLength(1);
    }
  });
});

describe('R2-S2 — who may read the plans, and no repeat calls', () => {
  it('read_only, technician and accounting are refused; a salesperson may', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const owner = await makeUser('owner');
    const { bidId } = await kissimmeeBid(owner);
    for (const role of ['read_only', 'technician', 'accounting']) {
      const u = await makeUser(role);
      const res = await run(u, bidId);
      expect([403, 404], role).toContain(res.status);
    }
    const sales = await makeUser('salesperson');
    const { bidId: own } = await kissimmeeBid(sales);
    expect((await run(sales, own)).status).toBe(200);
  });

  it('the same plan set and model never call the model twice; a forced re-read does; two forced clicks are rate-limited', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    state.calls.length = 0;
    const u = await makeUser('estimator');
    const { bidId } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    await run(u, bidId).expect(200);
    await run(u, bidId).expect(200);
    expect(state.calls).toHaveLength(1);
    const forced = await run(u, bidId, { force: true });
    expect([200, 202]).toContain(forced.status);
    expect((await waitStatus(u, bidId)).status).toBe('complete');
    expect(state.calls).toHaveLength(2);
    process.env.JOB_PROFILE_MIN_INTERVAL_MS = '60000';
    try {
      const again = await run(u, bidId, { force: true });
      expect(again.status).toBe(429);
      expect(state.calls).toHaveLength(2);
    } finally { process.env.JOB_PROFILE_MIN_INTERVAL_MS = '0'; }
  });
});

describe('R2-B2 — never stuck', () => {
  it('a sheet check left "running" by a dead process (stale) is re-run and the profile completes', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('KISSIMMEE');
    await addDoc(bidId, KISSIMMEE_FILE, buf);
    await seedSheetCheck(bidId, buf, [], 'running');
    await pool.query(`UPDATE bid_sheet_check SET updated_at = now() - interval '20 minutes' WHERE bid_id=$1`, [bidId]);
    const res = await run(u, bidId);
    expect(res.status).toBe(202);
    const { rows } = await pool.query('SELECT run_token FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
    expect(rows[0].run_token).not.toBe('seeded'); // a new check claimed the row
    expect((await waitStatus(u, bidId)).status).toBe('complete');
  }, 60_000);

  it('the same stuck upload re-read with force starts over; a profile waiting past the limit becomes an error; boot resets both', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('KISSIMMEE');
    await addDoc(bidId, KISSIMMEE_FILE, buf);
    await seedSheetCheck(bidId, buf, [], 'running'); // fresh, but never finishing
    expect((await run(u, bidId)).status).toBe(202);
    expect((await run(u, bidId)).status).toBe(202); // same key: still waiting…
    await pool.query(`UPDATE bid_job_profile SET updated_at = now() - interval '20 minutes' WHERE bid_id=$1`, [bidId]);
    const got = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(got.body.status).toBe('error'); // …until it expires, and the panel can retry
    const forced = await run(u, bidId, { force: true });
    expect(forced.status).toBe(202);
    expect((await waitStatus(u, bidId)).status).toBe('complete');

    await pool.query(`UPDATE bid_job_profile SET status='waiting' WHERE bid_id=$1`, [bidId]);
    await pool.query(`UPDATE bid_sheet_check SET status='running' WHERE bid_id=$1`, [bidId]);
    await resetStuckJobProfilesOnBoot({ bidId }); // scoped: other test files' checks run in parallel
    const { rows: p } = await pool.query('SELECT status FROM bid_job_profile WHERE bid_id=$1', [bidId]);
    const { rows: c } = await pool.query('SELECT status FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
    expect(p[0].status).toBe('error');
    expect(c[0].status).toBe('error');
  }, 60_000);
});

describe("R2-S6 — the profile never overwrites the Documents step's own check", () => {
  it('a check made for a different selection is left untouched; the profile reads the full plan set from the classification cache', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const buf = marker('KISSIMMEE');
    await addDoc(bidId, KISSIMMEE_FILE, buf);
    await addDoc(bidId, 'Addendum.pdf', marker('KISSIMMEE'));
    // The estimator's check covers only one of the two plan files.
    await seedSheetCheck(bidId, buf, kissimmeeInventory({ sha: sha256(buf), texts: fx.pages }));
    const before = (await pool.query('SELECT run_token, input_key, result FROM bid_sheet_check WHERE bid_id=$1', [bidId])).rows[0];
    const res = await run(u, bidId);
    expect([200, 202]).toContain(res.status);
    expect(['complete', 'undetermined']).toContain(String((await waitStatus(u, bidId)).status));
    const after = (await pool.query('SELECT run_token, input_key, result FROM bid_sheet_check WHERE bid_id=$1', [bidId])).rows[0];
    expect(after.run_token).toBe(before.run_token);
    expect(after.input_key).toBe(before.input_key);
  }, 60_000);
});

// ── Round 3 ───────────────────────────────────────────────────────────────

describe('R3-B1 — plan revisions are proposed, answered, logged, and block the analysis until then', () => {
  it('Run AI returns 409 while "Rev 2 appears to replace Rev 1" is unanswered; Replace is stored per pair and audited', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidId = await makeBid(u);
    const r1 = marker('KISSIMMEE'); const r2 = marker('KISSIMMEE');
    const d1 = await addDoc(bidId, 'AZ Elec Rev 1.pdf', r1);
    const d2 = await addDoc(bidId, 'AZ Elec Rev 2.pdf', r2);
    const mk = (buf: Buffer, file: string, docId: string) => ['E-1', 'E-2', 'E-3'].map((no, i) => ({
      key: `${sha256(buf)}#${i + 1}`, file, documentId: docId, sha: sha256(buf), page: i + 1, sheetNo: no, title: ['POWER PLAN', 'LIGHTING PLAN', 'PANEL SCHEDULES'][i],
      discipline: 'electrical', cls: 'plan' as const, textChars: 500, hasTextLayer: true, classified: true, refs: [], role: 'excluded' as const, reason: '',
      uploadedAt: '2026-01-01T10:00:00.000Z',
    }));
    const sel = applySelection([...mk(r1, 'AZ Elec Rev 1.pdf', d1), ...mk(r2, 'AZ Elec Rev 2.pdf', d2)], {});
    expect(sel.revisionProposals).toHaveLength(1);
    const inputKey = [sha256(r1), sha256(r2)].sort().join(',');
    await pool.query(
      `INSERT INTO bid_sheet_check (bid_id, status, run_token, input_key, result, finished_at, updated_at)
       VALUES ($1, 'complete', 'seeded', $2, $3, now(), now())`,
      [bidId, inputKey, JSON.stringify({ version: 1, pages: sel.pages, refs: sel.refs, unclassifiedFiles: [], otherFiles: [], checkedAt: 'now', revisionProposals: sel.revisionProposals, duplicateSheets: [] })]);

    const blocked = await request(app).post('/api/preconstruction/analyze').set(auth(u.token)).send({ bidId, document_ids: [d1, d2] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Resolve plan revisions first/);

    const prof = await request(app).get(`/api/preconstruction/${bidId}/job-profile`).set(auth(u.token)).expect(200);
    expect(prof.body.revision_proposals[0]).toMatchObject({ olderFile: 'AZ Elec Rev 1.pdf', newerFile: 'AZ Elec Rev 2.pdf' });

    const id = sel.revisionProposals[0].id;
    await request(app).put(`/api/preconstruction/${bidId}/plan-revisions`).set(auth(u.token)).send({ id, decision: 'maybe' }).expect(400);
    const ans = await request(app).put(`/api/preconstruction/${bidId}/plan-revisions`).set(auth(u.token)).send({ id, decision: 'replace' }).expect(200);
    expect(ans.body.revisionProposals[0].decision).toMatchObject({ decision: 'replace' });
    const { rows } = await pool.query('SELECT revision_decisions, result FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
    expect(rows[0].revision_decisions[id].decision).toBe('replace');
    expect((rows[0].result.pages as Array<{ sha: string; role: string }>).filter(p => p.sha === sha256(r1)).every(p => p.role === 'excluded')).toBe(true);
    const { rows: audit } = await pool.query(`SELECT summary FROM audit_log WHERE entity_id=$1 AND summary LIKE 'Plan revision:%'`, [bidId]);
    expect(audit[0].summary).toMatch(/AZ Elec Rev 2.pdf replaces AZ Elec Rev 1.pdf/);

    const ro = await makeUser('read_only');
    expect([403, 404]).toContain((await request(app).put(`/api/preconstruction/${bidId}/plan-revisions`).set(auth(ro.token)).send({ id, decision: 'keep_both' })).status);
  });
});

describe('R3-S3 — forced re-reads keep the classification cache, 1 per 2 minutes, logged', () => {
  it('a second forced re-read within 2 minutes is 429; each forced re-read is in the audit log; the cache is not cleared', async () => {
    if (!ok) return;
    setReply(KISSIMMEE_MODEL_REPLY);
    const u = await makeUser('estimator');
    const { bidId, buf } = await kissimmeeBid(u);
    await run(u, bidId).expect(200);
    await pool.query(
      `INSERT INTO sheet_page_cache (content_sha256, page, cache_key, sheet_no, title, discipline, cls, text_chars, has_text_layer, model)
       VALUES ($1, 1, 'r3s3-marker', 'C0.1', 'COVER SHEET', 'cover', 'plan', 100, true, 'test') ON CONFLICT DO NOTHING`, [sha256(buf)]);
    process.env.JOB_PROFILE_FORCE_INTERVAL_MS = '120000';
    try {
      expect([200, 202]).toContain((await run(u, bidId, { force: true })).status);
      expect((await run(u, bidId, { force: true })).status).toBe(429);
    } finally { process.env.JOB_PROFILE_FORCE_INTERVAL_MS = '0'; }
    await waitStatus(u, bidId);
    const { rows: cache } = await pool.query(`SELECT 1 FROM sheet_page_cache WHERE content_sha256=$1 AND cache_key='r3s3-marker'`, [sha256(buf)]);
    expect(cache).toHaveLength(1);
    const { rows: audit } = await pool.query(`SELECT summary FROM audit_log WHERE entity_id=$1 AND summary LIKE 'Plans re-read%'`, [bidId]);
    expect(audit).toHaveLength(1);
  }, 60_000);
});
