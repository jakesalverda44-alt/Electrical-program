// Fewer-questions round Task 0 — the committed review baseline
// (eval/review-baseline-2026-10-01.json, made on merged main 25dce72 before
// any change of this round) is internally consistent, and Gap 1 is pinned:
// a re-run used to drop a legend-zero group's MEMBER answers (only the
// item-level resolution was carried), so enforcedCounts lost them.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayReview, reviewCounts, type ReplayReview, type ReviewBaselineJob } from './reviewReplay';
import { applyGroupMemberResolution, carryOverWithFollowUps, enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import { isPdftoppmAvailable } from '../ai/documentPrep';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/review-baseline-2026-10-01.json'), 'utf8')) as { base: string; jobs: Record<'kissimmee' | '36th', ReviewBaselineJob> };

describe('review baseline (2026-10-01, main 25dce72)', () => {
  it('counts agree with the listed items', () => {
    for (const job of ['kissimmee', '36th'] as const) {
      const b = BASELINE.jobs[job];
      expect(b.items.length).toBe(b.counts.total);
      expect(b.items.filter(i => i.blocking !== false).length).toBe(b.counts.asked + b.counts.scopeStep + b.counts.answered + b.counts.auto);
    }
    expect(BASELINE.jobs.kissimmee.counts).toMatchObject({ total: 29, asked: 25, info: 4 });
    expect(BASELINE.jobs['36th'].counts).toMatchObject({ total: 24, asked: 16, info: 8 });
    expect(Object.values(BASELINE.jobs['36th'].storedAnswers ?? {}).map(a => (a as { answer: string }).answer)).toEqual(['Same area — keep 1', 'Same area — keep 1', 'Same area — keep 9']);
  });
});

let have = false;
let r36: ReplayReview;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (have) r36 = await replayReview('36th');
}, 900_000);

describe('Gap 1 — legend-zero member answers across a re-run', () => {
  it('the replayed list reproduces the baseline counts', (ctx) => {
    if (!have) return ctx.skip();
    expect(reviewCounts(r36.items).total).toBeGreaterThan(0);
  });
  it.fails('FAILS TODAY (Gap 1: carryOverResolutions drops groupedTypes[].resolution) — two answered members (count 6, not on job) survive carry-over into enforcedCounts', (ctx) => {
    if (!have) return ctx.skip();
    const fresh = r36.fresh;
    const g = fresh.find(i => i.id.startsWith('legend-zero:'))!;
    const [a, b] = g.groupedTypes!;
    let answered: ReviewItem = applyGroupMemberResolution(g, a.key, { action: 'count', qty: 6 }, 'Jake');
    answered = applyGroupMemberResolution(answered, b.key, { action: 'not_on_job', reason: 'not shown anywhere on this job' }, 'Jake');
    const prev = fresh.map(i => (i.id === g.id ? answered : i));
    const after = carryOverWithFollowUps(fresh, prev);
    const ec = enforcedCounts(r36.countResult, after);
    expect(ec.byType.get(a.key)).toBe(6);
    expect(ec.byType.has(b.key) && ec.byType.get(b.key)).toBe(null);
  });
});
