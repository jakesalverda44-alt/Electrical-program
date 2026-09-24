// Stop analysis — POST /:bidId/stop-analysis stops a running analysis, an
// Agent 4 run or a pre-bid draft. Before this, the only way to stop a run was
// to SIGTERM the backend.
//
// No network: runPipeline gets a fake client that honours the abort signal
// the way the SDK does; the SDK class used by the Agent 4 / draft routes is
// mocked the same way. Drive is mocked, email is muted under test.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';

type Handler = (req: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<string>;
const sdk: { handler: Handler; calls: Array<{ req: Record<string, unknown>; signal?: AbortSignal }> } = {
  handler: async () => '{}',
  calls: [],
};

class FakeAbortError extends Error {
  constructor() { super('Request was aborted.'); this.name = 'APIUserAbortError'; }
}

/** A stream call the way the SDK behaves: an already-aborted signal rejects
 *  at once (no request); an abort mid-call rejects the pending call. */
function fakeStream(req: Record<string, unknown>, opts?: { signal?: AbortSignal }) {
  sdk.calls.push({ req, signal: opts?.signal });
  return {
    finalMessage: () => new Promise((resolve, reject) => {
      const signal = opts?.signal;
      if (signal?.aborted) return reject(new FakeAbortError());
      signal?.addEventListener('abort', () => reject(new FakeAbortError()), { once: true });
      sdk.handler(req, signal).then(text => resolve({
        id: 'msg_fake', type: 'message', role: 'assistant', model: String(req.model),
        content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }), reject);
    }),
  };
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      stream: (req: Record<string, unknown>, opts?: { signal?: AbortSignal }) => fakeStream(req, opts),
      create: async () => { throw new Error('not used'); },
    };
  },
}));
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return { ...actual, uploadFile: async () => null, ensureSubfolder: async () => null };
});

import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { runPipeline, runDraftComposition, loadAIConfig, beginAnalysisRun, ANALYSIS_RUNNING_STATUSES } from '../routes/preconstruction';
import { runningCount, abortableClient, registerRun, isCancellationError, RunCancelledError } from '../ai/runControl';
import { callWithRetry } from '../ai/retry';
import { writeAiCountMarkers } from '../estimating/aiMarkers';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); process.env.ANTHROPIC_API_KEY = 'test-dummy-not-a-key'; }, 30_000);

const fakeClient = { messages: { stream: fakeStream, create: async () => { throw new Error('not used'); } } } as unknown as Anthropic;
const sys = (req: Record<string, unknown>) => (Array.isArray(req.system) ? (req.system as Array<{ text?: string }>).map(b => b.text ?? '').join('\n') : String(req.system ?? ''));
const isAgent1 = (req: Record<string, unknown>) => sys(req).includes('Senior Electrical Drawing Analyzer');

/** 70 small "sheets" as images → Agent 1 runs in 3 token-budgeted batches. */
/** Next round A5 — 180 → 6 batches, run 3 at a time. */
const MANY_IMAGES = Array.from({ length: 180 }, (_, i) => ({
  originalname: `E-${i + 1}.png`, buffer: Buffer.from(`fake png ${i}`), mimetype: 'image/png', size: 12,
})) as Express.Multer.File[];
const IMAGES = Array.from({ length: 70 }, (_, i) => ({
  originalname: `E-${i + 1}.png`, buffer: Buffer.from(`fake png ${i}`), mimetype: 'image/png', size: 12,
})) as Express.Multer.File[];

async function runningBid(): Promise<{ user: TestUser; bidId: string; runId: string }> {
  const user = await makeUser('owner');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, salesperson_id, amount) VALUES ($1, 'GC', $2, 1000) RETURNING id`,
    [`Stop ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]
  );
  const { runId } = await beginAnalysisRun(rows[0].id);
  return { user, bidId: rows[0].id as string, runId };
}

async function until(cond: () => boolean, ms = 10_000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('stop-analysis — the analysis pipeline', () => {
  it('cancel between Agent 1 batches: no further batch starts and nothing is written', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await runningBid();
    sdk.calls = [];
    // Next round A5 — batches run 3 at a time. The stop lands while the
    // first wave runs (via the database only, as from another server
    // process): no batch of the second wave (4-6) ever starts.
    sdk.handler = async (req) => {
      if (isAgent1(req)) {
        await pool.query(`UPDATE takeoff_results SET status='cancelled', raw_response='Stopped by test' WHERE bid_id=$1`, [bidId]);
        return JSON.stringify({ project: { name: 'x' }, quantities: [{ item: 'A', qty: 1 }] });
      }
      throw new Error('no other agent may be called');
    };
    await runPipeline(bidId, MANY_IMAGES, fakeClient, await loadAIConfig());
    const agent1Calls = sdk.calls.filter(c => isAgent1(c.req));
    const batchNo = (c: { req: Record<string, unknown> }) => Number(/batch (\d+) of 6/.exec(String((c.req.messages as Array<{ content: Array<{ text?: string }> }>)[0].content.at(-1)!.text))![1]);
    expect(agent1Calls.length).toBeGreaterThanOrEqual(1);
    expect(agent1Calls.length).toBeLessThanOrEqual(3);
    for (const c of agent1Calls) expect(batchNo(c)).toBeLessThanOrEqual(3);
    expect(sdk.calls).toHaveLength(agent1Calls.length);
    const { rows: [tr] } = await pool.query('SELECT status, agent1_output, raw_response, usage_agent1 FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ status: 'cancelled', agent1_output: null, raw_response: 'Stopped by test', usage_agent1: null });
    expect(runningCount(bidId, 'analysis')).toBe(0);
  });

  it('cancel during a stream: the in-flight call is aborted at once (billing stops) and the run exits cleanly', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await runningBid();
    sdk.calls = [];
    sdk.handler = () => new Promise(() => { /* never answers: only the abort ends it */ });
    const run = runPipeline(bidId, IMAGES, fakeClient, await loadAIConfig());
    // Next round A5 — the 3 batches start together.
    await until(() => sdk.calls.length === 3);
    expect(sdk.calls[0].signal).toBeDefined();
    expect(sdk.calls[0].signal!.aborted).toBe(false);

    const res = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.stopped.analysis).toBe(true);
    expect(res.body.aborted).toBe(1);
    expect(res.body.message).toBe(`Stopped by ${user.name}`);
    for (const c of sdk.calls) expect(c.signal!.aborted).toBe(true); // every in-flight batch
    await run; // exits, no hang

    expect(sdk.calls).toHaveLength(3);
    const { rows: [tr] } = await pool.query('SELECT status, raw_response, cancelled_by, cancelled_at, agent1_output, progress FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ status: 'cancelled', raw_response: `Stopped by ${user.name}`, cancelled_by: user.name, agent1_output: null, progress: null });
    expect(tr.cancelled_at).not.toBeNull();
  });

  it('a cancelled run can never write results, even when its call ignores the abort (another process)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, runId } = await runningBid();
    sdk.calls = [];
    // Agent 1 answers only after the run was cancelled in the database, on a
    // client that ignores the abort signal entirely.
    const deaf = { messages: { stream: (req: Record<string, unknown>) => fakeStream(req, {}) } } as unknown as Anthropic;
    sdk.handler = async () => {
      await pool.query(`UPDATE takeoff_results SET status='cancelled' WHERE bid_id=$1`, [bidId]);
      return JSON.stringify({ project: { name: 'late' }, quantities: [{ item: 'A', qty: 5 }] });
    };
    await runPipeline(bidId, IMAGES.slice(0, 2), deaf, await loadAIConfig());
    const { rows: [tr] } = await pool.query('SELECT status, agent1_output, agent2_output, count_result, review_items FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ status: 'cancelled', agent1_output: null, agent2_output: null, count_result: null, review_items: null });
    expect(sdk.calls).toHaveLength(1);

    // The marker writer refuses for a cancelled run too.
    const summary = await writeAiCountMarkers(bidId, { targets: [], sheets: [], marks: [] } as never, [], runId);
    expect(summary.written).toBe(0);
    expect(summary.sheetsWithoutMarkers[0].reason).toMatch(/newer analysis run/);
  });

  it('409 when nothing is running; a new run after a stop starts clean', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await runningBid();
    await pool.query(`UPDATE takeoff_results SET status='complete' WHERE bid_id=$1`, [bidId]);
    const none = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({});
    expect(none.status).toBe(409);

    await pool.query(`UPDATE takeoff_results SET status='cancelled', cancelled_by='x', cancelled_at=now(), progress='{"label":"Agent 1: batch 1 of 3"}' WHERE bid_id=$1`, [bidId]);
    await beginAnalysisRun(bidId);
    const { rows: [tr] } = await pool.query('SELECT status, cancelled_by, cancelled_at, progress FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toEqual({ status: 'running', cancelled_by: null, cancelled_at: null, progress: null });
  });

  it('needs the run_analysis permission', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await runningBid();
    await pool.query(`UPDATE bids SET salesperson_id=NULL WHERE id=$1`, [bidId]);
    const sales = await makeUser('sales_manager');
    const res = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(sales.token)).send({});
    expect(res.status).toBe(403);
    const { rows: [tr] } = await pool.query('SELECT status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr.status).toBe('running');
  });

  it('reports live progress: "Agent 1: N of M batches done"', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await runningBid();
    sdk.calls = [];
    const seen: string[] = [];
    sdk.handler = async (req) => {
      const { rows } = await pool.query('SELECT progress FROM takeoff_results WHERE bid_id=$1', [bidId]);
      seen.push(rows[0].progress?.label);
      if (seen.length === 3) await pool.query(`UPDATE takeoff_results SET status='cancelled' WHERE bid_id=$1`, [bidId]);
      return isAgent1(req) ? JSON.stringify({ project: { name: 'x' } }) : '{}';
    };
    await runPipeline(bidId, IMAGES, fakeClient, await loadAIConfig());
    // Next round A5 — all three start at once; a batch that finishes first
    // may already have written "1 of 3 batches done" (fix round N12: the
    // order of the three starts is not fixed under load).
    expect(seen[0]).toBe('Agent 1: 3 batches, 3 at a time');
    for (const l of seen) expect(l).toMatch(/^Agent 1: (3 batches, 3 at a time|[12] of 3 batches done( \(\d running\))?)$/);
    const { rows } = await pool.query('SELECT progress FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].progress?.label ?? '').not.toMatch(/batch \d+ of/);
  });
});

describe('stop-analysis — Agent 4 and the pre-bid draft', () => {
  async function analyzedBid() {
    const f = await runningBid();
    await pool.query(
      `UPDATE takeoff_results SET status='complete', agent1_output='{}', agent2_output='{}', review_items='[]', review_status='clear' WHERE bid_id=$1`,
      [f.bidId]
    );
    return f;
  }

  it('stops a running Agent 4: the stream is aborted, nothing is written, bids.amount is untouched', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    sdk.calls = [];
    sdk.handler = () => new Promise(() => { /* hangs until aborted */ });
    const started = await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '425000' });
    expect(started.status).toBe(200);
    await until(() => sdk.calls.length === 1);
    const stop = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({ what: 'agent4' });
    expect(stop.status).toBe(200);
    expect(stop.body.stopped).toEqual({ analysis: false, agent4: true, draft: false });
    expect(sdk.calls[0].signal!.aborted).toBe(true);
    await until(() => runningCount(bidId, 'agent4') === 0);
    const { rows: [tr] } = await pool.query('SELECT agent4_status, agent4_error, agent4_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ agent4_status: 'cancelled', agent4_error: `Stopped by ${user.name}`, agent4_output: null });
    const { rows: [bid] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    expect(Number(bid.amount)).toBe(1000);
  });

  it('an Agent 4 reply that lands after a stop is discarded', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    sdk.calls = [];
    const AGENT4 = { sections: [{ title: 'A', bullets: ['x'] }], exclusions: [], takeoff: [] };
    sdk.handler = async () => {
      await pool.query(`UPDATE takeoff_results SET agent4_status='cancelled' WHERE bid_id=$1`, [bidId]);
      return JSON.stringify(AGENT4);
    };
    await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '425000' }).expect(200);
    await until(() => sdk.calls.length === 1);
    await until(() => runningCount(bidId, 'agent4') === 0);
    const { rows: [tr] } = await pool.query('SELECT agent4_status, agent4_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ agent4_status: 'cancelled', agent4_output: null });
    const { rows: [bid] } = await pool.query('SELECT amount FROM bids WHERE id=$1', [bidId]);
    expect(Number(bid.amount)).toBe(1000);
  });

  it('stops a pre-bid draft: aborted, draft_status cancelled, no draft written', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await analyzedBid();
    sdk.calls = [];
    sdk.handler = () => new Promise(() => { /* hangs until aborted */ });
    const done = runDraftComposition(bidId, fakeClient, await loadAIConfig());
    await until(() => sdk.calls.length === 1);
    const stop = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({ what: 'draft' });
    expect(stop.body.stopped.draft).toBe(true);
    await done;
    expect(sdk.calls[0].signal!.aborted).toBe(true);
    const { rows: [tr] } = await pool.query('SELECT draft_status, draft_error, draft_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ draft_status: 'cancelled', draft_error: `Stopped by ${user.name}`, draft_output: null });
  });
});

describe('abortableClient', () => {
  it('combines a caller\'s own signal with the run signal', async () => {
    const run = new AbortController();
    const own = new AbortController();
    let seen: AbortSignal | undefined;
    const base = { messages: { stream: (_r: unknown, o?: { signal?: AbortSignal }) => { seen = o?.signal; return {}; } } } as unknown as Anthropic;
    abortableClient(base, run.signal).messages.stream({} as never, { signal: own.signal });
    expect(seen!.aborted).toBe(false);
    own.abort();
    expect(seen!.aborted).toBe(true);
    abortableClient(base, run.signal).messages.stream({} as never);
    run.abort();
    expect(seen!.aborted).toBe(true);
  });
});


// ── Fix round (review 2026-09-24) ───────────────────────────────────────────

describe('fix round S2 — a re-run cancels the previous run\'s in-flight work first', () => {
  it('POST /analyze aborts the old run\'s stream (billing stops) and its Agent 4 / draft jobs; the old run writes nothing', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await runningBid();
    sdk.calls = [];
    sdk.handler = () => new Promise(() => { /* the old run hangs until aborted */ });
    const oldRun = runPipeline(bidId, IMAGES, fakeClient, await loadAIConfig());
    await until(() => sdk.calls.length === 3); // A5 — 3 batches at once
    const firstWave = sdk.calls.slice(0, 3);
    const oldSignal = sdk.calls[0].signal!;
    const agent4 = registerRun(bidId, 'agent4', 'some-old-run');
    const draft = registerRun(bidId, 'draft', 'some-old-run');
    // The new run: a plan PDF filed on the bid.
    const pdf = Buffer.from('%PDF-1.4\n% plans\n');
    const { rows } = await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
       VALUES ($1,'x','elec','E-1.pdf','E-1.pdf','plans',$2,'application/pdf','test',$3) RETURNING id`,
      [bidId, pdf.length, pdf.toString('base64')]
    );
    sdk.handler = async () => { throw new Error('new run: no model in this test'); };
    const res = await request(app).post('/api/preconstruction/analyze').set(auth(user.token)).field('bidId', bidId).field('document_ids', rows[0].id);
    expect(res.status).toBe(200);
    expect(oldSignal.aborted).toBe(true);
    expect(agent4.signal.aborted).toBe(true);
    expect(draft.signal.aborted).toBe(true);
    agent4.release(); draft.release();
    await oldRun; // exits cleanly
    // Fix round N8 — each batch carries its own signal (run + siblings);
    // every one of the old run's first wave was aborted, and it started no more.
    for (const c of firstWave) expect(c.signal!.aborted).toBe(true);
    const oldBatches = sdk.calls.filter(c => /batch \d+ of 3\b/.test(String((c.req.messages as Array<{ content: Array<{ text?: string }> }>)[0]?.content?.at?.(-1)?.text ?? '')));
    expect(oldBatches).toHaveLength(3);
    // Fix round N12 — wait for the NEW run this test started to finish, so
    // it can't call the shared fake SDK during the next test.
    const t0 = Date.now();
    for (;;) {
      const { rows: [tr] } = await pool.query('SELECT status FROM takeoff_results WHERE bid_id=$1', [bidId]);
      if ((!ANALYSIS_RUNNING_STATUSES.includes(tr.status) && runningCount(bidId, 'analysis') === 0) || Date.now() - t0 > 15_000) break;
      await new Promise(r => setTimeout(r, 25));
    }
    expect(runningCount(bidId, 'analysis')).toBe(0);
  });
});

describe('fix round S3 — Stop is phase- and run-specific', () => {
  it('a stop after the analysis finished is a no-op ("already finished") and never kills the draft that follows', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId, runId } = await runningBid();
    await pool.query(`UPDATE takeoff_results SET status='complete', draft_status='running' WHERE bid_id=$1`, [bidId]);
    const draft = registerRun(bidId, 'draft', runId);
    const res = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({ what: 'analysis' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ alreadyFinished: true, aborted: 0 });
    expect(res.body.error).toMatch(/already finished/);
    expect(draft.signal.aborted).toBe(false);
    const { rows: [tr] } = await pool.query('SELECT status, draft_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toEqual({ status: 'complete', draft_status: 'running' });
    draft.release();
  });

  it('the end-of-run draft is its own job: stopping the analysis handle does not abort it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await runningBid();
    await pool.query(`UPDATE takeoff_results SET status='complete', agent1_output='{}', agent2_output='{}', review_items='[]', review_status='clear' WHERE bid_id=$1`, [bidId]);
    // A draft composed on a raw client while an (old) analysis handle is aborted.
    const analysis = registerRun(bidId, 'analysis', 'another-run');
    sdk.calls = [];
    sdk.handler = async () => JSON.stringify({ sections: [{ title: 'A', bullets: ['x'] }], exclusions: [], takeoff: [] });
    const composing = runDraftComposition(bidId, fakeClient, await loadAIConfig());
    analysis.release();
    await composing;
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.calls[0].signal!.aborted).toBe(false);
  });

  it('a stop aborts only the run it cancelled, never a job of another run', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId, runId } = await runningBid();
    const current = registerRun(bidId, 'analysis', runId);
    const other = registerRun(bidId, 'analysis', 'a-later-run');
    const res = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({ what: 'analysis' });
    expect(res.status).toBe(200);
    expect(current.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    current.release(); other.release();
  });
});

describe('fix round N4 — Agent 4 is registered before it is visible as running', () => {
  it('a stop right after the response reaches the job: the call never starts or is aborted, nothing written', async (ctx) => {
    if (!ok) return ctx.skip();
    const { user, bidId } = await runningBid();
    await pool.query(`UPDATE takeoff_results SET status='complete', agent1_output='{}', agent2_output='{}', review_items='[]', review_status='clear' WHERE bid_id=$1`, [bidId]);
    sdk.calls = [];
    sdk.handler = () => new Promise(() => { /* hangs */ });
    await request(app).post(`/api/preconstruction/${bidId}/run-agent4`).set(auth(user.token)).send({ price: '1000' }).expect(200);
    expect(runningCount(bidId, 'agent4')).toBe(1);
    const stop = await request(app).post(`/api/preconstruction/${bidId}/stop-analysis`).set(auth(user.token)).send({ what: 'agent4' });
    expect(stop.status).toBe(200);
    await until(() => runningCount(bidId, 'agent4') === 0);
    expect(sdk.calls.every(c => c.signal?.aborted)).toBe(true);
    const { rows: [tr] } = await pool.query('SELECT agent4_status, agent4_output FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(tr).toMatchObject({ agent4_status: 'cancelled', agent4_output: null });
  });
});

describe('fix round N5 / N6', () => {
  it('N5 — cancellation is decided by type, never by message text', () => {
    expect(isCancellationError(new Error('upstream connection aborted by peer'))).toBe(false);
    expect(isCancellationError(Object.assign(new Error('x'), { name: 'APIUserAbortError' }))).toBe(true);
    expect(isCancellationError(new RunCancelledError())).toBe(true);
  });

  it('N6 — a stop wakes the retry backoff at once and ends the retries', async () => {
    const ctl = new AbortController();
    let attempts = 0;
    const started = Date.now();
    const p = callWithRetry(async () => { attempts++; throw Object.assign(new Error('overloaded'), { status: 529 }); },
      { baseDelayMs: 20_000, maxDelayMs: 20_000, signal: ctl.signal });
    setTimeout(() => ctl.abort(new RunCancelledError()), 50);
    await expect(p).rejects.toBeInstanceOf(RunCancelledError);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(attempts).toBe(1);
  });
});
