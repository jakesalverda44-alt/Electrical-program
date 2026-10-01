// Level 2 learning, Task 14 — the release gate. The model-effect rule on
// synthetic recorded pairs (no model): a regression fails, noise within A's
// spread passes, a disputed item is only reported. And "Check and release"
// with injected fakes (never a live client): an empty leave-one-job-out bank
// makes no call and reports "no change"; a regression in arm B fails the
// release and does not activate it.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { gateDecision, type ArmRepeat } from './learningGate';
import type { EvalDiff } from './takeoffEval';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from '../test/harness';
import { createRelease, getRelease, activeRelease, insertExample } from '../ai/learning/learningDb';
import { checkAndRelease, EVAL_JOBS, type JobInputs } from '../services/learningCheck';
import { meaningOf } from '../ai/learning/meaning';
import type { CountResult } from '../ai/countingStage';
import type Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const diff = (rows: Array<[string, number, number | null, boolean?]>): EvalDiff => ({
  rows: rows.map(([id, expected, actual, disputed]) => ({ id, label: id, expected, actual, delta: actual == null ? null : actual - expected, verdict: disputed ? 'reported' : actual === expected ? 'pass' : 'fail', matchedTypes: [] })) as EvalDiff['rows'],
  passed: 0, failed: 0, reported: 0, uncoveredTypes: [],
});
const rep = (rows: Array<[string, number, number | null, boolean?]>, asked = 8): ArmRepeat => ({ diff: diff(rows), asked });

describe('the gate rule (worse-of-2)', () => {
  it('a regression fails', () => {
    const r = gateDecision([rep([['gfci', 7, 7]]), rep([['gfci', 7, 7]])], [rep([['gfci', 7, 7]]), rep([['gfci', 7, 9]])], new Set());
    expect(r.passed).toBe(false);
    expect(r.regressions[0]).toMatch(/^gfci: /);
  });
  it('noise within A\'s own spread passes', () => {
    const r = gateDecision([rep([['dup', 40, 38]]), rep([['dup', 40, 43]])], [rep([['dup', 40, 41]]), rep([['dup', 40, 37]])], new Set());
    expect(r.passed).toBe(true);
  });
  it('a disputed item is reported, never gated; asked rising fails', () => {
    const r = gateDecision([rep([['exit', 5, 5, true]]), rep([['exit', 5, 5, true]])], [rep([['exit', 5, 9, true]]), rep([['exit', 5, 9, true]])], new Set(['exit']));
    expect(r.passed).toBe(true);
    expect(r.reported).toEqual(['exit']);
    expect(gateDecision([rep([], 8), rep([], 8)], [rep([], 8), rep([], 9)], new Set()).passed).toBe(false);
  });
});

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
const fakeClient = {} as Anthropic;
const inputs: JobInputs = { agent1: {}, inventory: [], pdfs: new Map([['p.pdf', Buffer.from('x')]]), docShas: new Set(['sha-eval-job']), remodel: { buildType: null, answer: null } };
/** A count result that hits every expected item with a `types` list: exactly
 *  the expected value (+ `bump` on each). */
function crFor(expectedFile: string, bump: number): CountResult {
  const e = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', expectedFile), 'utf8')) as { items: Array<{ types?: string[]; expected: number; measure?: string; category?: string }> };
  const types = e.items.filter(i => i.types?.length && !i.measure).map(i => ({ key: i.types![0], type: i.types![0], description: i.types![0], category: i.category ?? 'device', count: i.expected + bump, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: null }));
  return { version: 1, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], removedRows: [], flags: [], marks: [], types } as unknown as CountResult;
}

describe('Check and release (fakes injected — no live call)', () => {
  it('an empty leave-one-job-out bank: no model call, "no change", passed and activated', async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(`UPDATE learning_releases SET status = 'rolled_back' WHERE status = 'passed'`);
    const rel = await createRelease('test');
    // today's honest state: no cross-job labels → the release holds nothing usable
    await pool.query(`UPDATE learning_releases SET example_ids = '{}', lesson_ids = '{}' WHERE id = $1`, [rel.id]);
    const runArm = vi.fn();
    await checkAndRelease(rel.id, { client: fakeClient, model: 'm', maxTokens: 1, evidence: { model: 'm', maxTokens: 1 }, runArm, loadInputs: async () => ({ ...inputs, docShas: new Set() }) });
    const after = await getRelease(rel.id);
    expect(runArm).not.toHaveBeenCalled();
    expect((after!.eval as { passed: boolean; jobs: Array<{ ran: boolean; note: string }> }).jobs.map(j => [j.ran, j.note])).toEqual(EVAL_JOBS.map(() => [false, 'no change — the leave-one-job-out bank is empty for this job (no model calls)']));
    expect((after!.eval as { passed: boolean }).passed).toBe(true);
    expect((await activeRelease())!.id).toBe(rel.id);
  });
  it('a regression in arm B fails the release; it is not activated', async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(`UPDATE learning_releases SET status = 'rolled_back' WHERE status = 'passed'`);
    const u = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Here',$2) RETURNING id`, [`Gate src ${Date.now()}`, u.id]);
    const sharp = (await import('sharp')).default;
    const crop = await sharp({ create: { width: 360, height: 360, channels: 3, background: { r: 255, g: 255, b: 255 } } }).grayscale().png().toBuffer();
    await insertExample({ crop, dhash: 5n, halfIn: 0.6, polarity: 'positive', meaning: meaningOf({ description: 'GFCI receptacle', category: 'device' }), sourceKind: 'marker_confirm', sourceRef: { markupId: `m-${Date.now()}` },
      sourceBidId: rows[0].id, sourceDocSha: 'sha-other', pageIndex: 0, sheetLabel: 'E-1', xPt: 1, yPt: 1, legendQuote: null, accountRuleId: null, projectType: null, quality: 2, verifiedBy: 'Jake' });
    const rel = await createRelease('test');
    const { rows: ex } = await pool.query(`SELECT id FROM symbol_examples WHERE source_bid_id = $1`, [rows[0].id]);
    await pool.query(`UPDATE learning_releases SET example_ids = $2, lesson_ids = '{}' WHERE id = $1`, [rel.id, ex.map(r => r.id)]);
    let call = 0;
    const runArm = vi.fn(async (j: { expected: string }, _i: unknown, l: unknown) => { call++; return crFor(j.expected, l ? 3 : 0); });
    await checkAndRelease(rel.id, { client: fakeClient, model: 'm', maxTokens: 1, evidence: { model: 'm', maxTokens: 1 }, runArm: runArm as never, loadInputs: async () => inputs });
    const after = await getRelease(rel.id);
    expect(runArm).toHaveBeenCalledTimes(EVAL_JOBS.length * 4);
    expect(after!.status).toBe('failed');
    expect((after!.eval as { passed: boolean }).passed).toBe(false);
    expect(await activeRelease()).toBeNull();
  });
});
