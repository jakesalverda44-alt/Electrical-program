// Fix round 1 (B1, S4, S5, S7) — the release check fails closed, skips jobs the
// bank cannot touch, the examples index dedupes review examples, and the
// release claim is atomic with stale recovery. Test DB only; no model calls.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { insertExample, claimReleaseForCheck, recoverInterruptedChecks, getRelease, activeRelease, type NewExample } from '../ai/learning/learningDb';
import { meaningOf } from '../ai/learning/meaning';
import { runLearningCheck, checkAndRelease, EVAL_JOBS, type JobInputs } from '../services/learningCheck';
import type { CountTarget } from '../ai/countTargets';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const TROFFER = { key: 'A', type: 'A', description: '2x4 LED recessed troffer', category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: 'E-0.1' } as unknown as CountTarget;
const GFCI = { key: 'GFCI', type: 'GFCI', description: 'GFCI receptacle', category: 'device', source: 'legend', sourceSheet: 'E-0.1' } as unknown as CountTarget;

async function srcBid(): Promise<string> {
  const u = await makeUser('owner');
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id) VALUES ($1,'GC','Here',$2) RETURNING id`, [`Fix ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, u.id]);
  return rows[0].id as string;
}
const newEx = (bidId: string, over: Partial<NewExample> = {}): NewExample => ({
  crop: crypto.randomBytes(24), dhash: 12345n, halfIn: 0.6, polarity: 'positive', meaning: meaningOf(TROFFER), sourceKind: 'marker_confirm', sourceRef: { markupId: crypto.randomUUID() },
  sourceBidId: bidId, sourceDocSha: 'sha-other-set', pageIndex: 0, sheetLabel: 'E-1', xPt: 1, yPt: 1, legendQuote: 'q', accountRuleId: null, projectType: null, quality: 2, verifiedBy: 'Jake', ...over,
});
/** A release row with exactly these examples (isolated from every other test's rows). */
async function release(exampleIds: string[]): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO learning_releases (example_ids, lesson_ids, created_by) VALUES ($1, '{}', 'test') RETURNING id`, [exampleIds]);
  return rows[0].id as number;
}
const inputs = (targets: CountTarget[]): JobInputs => ({ targets, agent1: {}, inventory: [], pdfs: new Map([['p.pdf', Buffer.from('x')]]), docShas: new Set(['sha-eval-set']), remodel: { buildType: null, answer: null } });
const deps = (over: Record<string, unknown>) => ({ client: {} as never, model: 'm', maxTokens: 1, evidence: { model: 'm', maxTokens: 1 }, ...over });

describe('B1 — a job that cannot be checked fails the release unless its bank is empty', () => {
  it('non-empty bank + no stored run / no PDFs -> NOT passed, not activated', async (ctx) => {
    if (!ok) return ctx.skip();
    const id = await insertExample(newEx(await srcBid()));
    const rel = await release([id!]);
    const noRun = await runLearningCheck(rel, deps({ loadInputs: async () => null }));
    expect(noRun.passed).toBe(false);
    expect(noRun.jobs.every(j => !j.ran && /could not check .* not released/.test(j.note))).toBe(true);
    const noPdf = await runLearningCheck(rel, deps({ loadInputs: async () => ({ ...inputs([TROFFER]), pdfs: new Map() }) }));
    expect(noPdf.passed).toBe(false);
    // the button path: stored as failed and never activated
    await checkAndRelease(rel, deps({ loadInputs: async () => null }));
    const r = await getRelease(rel);
    expect(r!.status).toBe('failed');
    expect((await activeRelease())?.id).not.toBe(rel);
  });
  it('an empty bank passes without a stored run (nothing to check, nothing to spend)', async (ctx) => {
    if (!ok) return ctx.skip();
    const rel = await release([]);
    const out = await runLearningCheck(rel, deps({ loadInputs: async () => null }));
    expect(out.passed).toBe(true);
    expect(out.jobs.map(j => j.note).every(n => /^no change/.test(n))).toBe(true);
  });
  it('a bank made only of examples from the eval job itself is empty for that job (leave-one-out) and passes', async (ctx) => {
    if (!ok) return ctx.skip();
    const id = await insertExample(newEx(await srcBid(), { sourceDocSha: 'sha-eval-set' }));
    const rel = await release([id!]);
    // docShas unknown (no PDFs) but the example is another bid's -> non-empty -> fails; with PDFs whose sha matches -> empty -> passes with no model call
    const out = await runLearningCheck(rel, deps({ loadInputs: async () => inputs([TROFFER]), runArm: async () => { throw new Error('no model call expected'); } }));
    expect(out.passed).toBe(true);
    expect(out.jobs.every(j => !j.ran)).toBe(true);
  });
});

describe('S4 — the check skips a job nothing in the bank applies to', () => {
  it('no matching target: no model call; a matching target: the arms run', async (ctx) => {
    if (!ok) return ctx.skip();
    const id = await insertExample(newEx(await srcBid()));
    const rel = await release([id!]);
    const none = await runLearningCheck(rel, deps({ loadInputs: async () => inputs([GFCI]), runArm: async () => { throw new Error('no model call expected'); } }));
    expect(none.passed).toBe(true);
    expect(none.jobs.map(j => [j.ran, j.note])).toEqual(EVAL_JOBS.map(() => [false, 'no change — nothing in the bank applies to this job (no model calls)']));
    await expect(runLearningCheck(rel, deps({ loadInputs: async () => inputs([TROFFER]), runArm: async () => { throw new Error('arm called'); } }))).rejects.toThrow('arm called');
  });
});

describe('S5 — the examples unique index dedupes review examples (NULL parts coalesced)', () => {
  it('the same review example captured twice inserts once; a marker example too', async (ctx) => {
    if (!ok) return ctx.skip();
    const bid = await srcBid();
    const crop = crypto.randomBytes(24);
    const review = newEx(bid, { crop, sourceKind: 'review_unlisted', sourceRef: { itemId: 'unlisted:H', memberKey: 'mark:0' } });
    expect(await insertExample(review)).toBeTruthy();
    expect(await insertExample({ ...review })).toBeNull();
    const marker = newEx(bid, { crop: crypto.randomBytes(24), sourceRef: { markupId: crypto.randomUUID() } });
    expect(await insertExample(marker)).toBeTruthy();
    expect(await insertExample({ ...marker })).toBeNull();
    const { rows } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'symbol_examples_source_crop_uq'`);
    expect(rows[0].indexdef).toContain('COALESCE');
  });
});

describe('S7 — the release claim is atomic and a stale check is recovered', () => {
  it('only one claim wins; a fresh checking release is refused; a stale one is taken over; boot recovery fails it', async (ctx) => {
    if (!ok) return ctx.skip();
    const rel = await release([]);
    const [a, b] = await Promise.all([claimReleaseForCheck(rel), claimReleaseForCheck(rel)]);
    expect([a, b].sort()).toEqual([false, true]);
    expect((await getRelease(rel))!.status).toBe('checking');
    expect(await claimReleaseForCheck(rel)).toBe(false);
    await pool.query(`UPDATE learning_releases SET eval = jsonb_build_object('checking', true, 'at', to_char(now() - interval '3 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) WHERE id = $1`, [rel]);
    expect(await claimReleaseForCheck(rel)).toBe(true);
    expect(await recoverInterruptedChecks()).toBeGreaterThanOrEqual(1);
    const r = await getRelease(rel);
    expect(r!.status).toBe('failed');
    expect(String((r!.eval as { error?: string }).error)).toMatch(/interrupted/);
    // a failed release can be checked again; a passed one cannot be claimed
    expect(await claimReleaseForCheck(rel)).toBe(true);
    await pool.query(`UPDATE learning_releases SET status = 'passed' WHERE id = $1`, [rel]);
    expect(await claimReleaseForCheck(rel)).toBe(false);
  });
});
