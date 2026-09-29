// Remodel reading round, fix B3 — the answer to "How are new vs existing
// devices shown on these plans?" through the REAL review-resolve route, a
// REAL re-run start (beginAnalysisRun wipes review_items), the pipeline's own
// loader, and the counting stage (the 36th Street replay, fake client).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { beginAnalysisRun } from '../routes/preconstruction';
import { loadRemodelInput } from '../estimating/remodelConvention';
import { CONVENTION_OPTIONS } from '../ai/remodel/status';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { replay36th, isCounter } from './fixtures/realrun/replay36th';
import { userText } from './fixtures/takeoff/fakeAnthropic';
import type { ReviewItem } from '../ai/reviewItems';

let ok = false; let have = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); have = await isPdftoppmAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);

const ITEM: ReviewItem = {
  id: 'remodel:conventions', kind: 'count', title: 'How are new vs existing devices shown on these plans?', detail: 'test',
  options: [...CONVENTION_OPTIONS], actions: ['answer'], fingerprint: 'remodel-conv|x',
};

async function bid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`RemodelConv ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify([ITEM])]);
  return rows[0].id as string;
}

describe('fix B3 — the new-vs-existing answer survives the re-run that applies it', () => {
  it('answer (route) → re-run start wipes review_items → the pipeline loader still has it → applied, and no question', async (ctx) => {
    if (!ok || !have) return ctx.skip();
    const bidId = await bid();
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['remodel:conventions'], action: 'answer', answer: CONVENTION_OPTIONS[1] });
    expect(res.status).toBe(200);
    await beginAnalysisRun(bidId);
    const { rows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id=$1', [bidId]);
    expect(rows[0].review_items).toBeNull();
    const input = await loadRemodelInput(bidId);
    expect(input).toEqual({ buildType: null, answer: CONVENTION_OPTIONS[1] });
    // The re-run: the 36th Street replay with NO printed rule on the sheets.
    const r = await replay36th({ conventions: false, remodel: input });
    expect(r.review.some(i => i.id === 'remodel:conventions')).toBe(false);
    const e1 = userText(r.calls.find(c => isCounter(c) && userText(c).includes('SHEET: E1.0'))!);
    expect(e1).toContain('KNOWN RULES for this job');
    expect(r.stage.countResult.remodel!.conventions.map(c => c.source)).toContain('estimator');
  }, 300_000);

  it('reopening the item removes the stored answer; an answer that is not an option is never stored', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await bid();
    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['remodel:conventions'], action: 'answer', answer: CONVENTION_OPTIONS[0] });
    expect((await loadRemodelInput(bidId)).answer).toBe(CONVENTION_OPTIONS[0]);
    const bad = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token))
      .send({ itemIds: ['remodel:conventions'], action: 'answer', answer: 'Something made up' });
    expect(bad.status).toBe(400);
    const re = await request(app).post(`/api/preconstruction/${bidId}/review/reopen`).set(auth(user.token)).send({ itemId: 'remodel:conventions' });
    expect(re.status).toBeLessThan(300);
    expect((await loadRemodelInput(bidId)).answer).toBeNull();
  });
});

describe('fix S3 — through the review route: merging into a type later marked not on this job reopens the tag', () => {
  it('H "Same as Type C", then C "not on this job" -> H is open again with its earlier answer shown', async (ctx) => {
    if (!ok) return ctx.skip();
    const items: ReviewItem[] = [
      { id: 'count:C', kind: 'count', title: 'Type C — pendant', detail: 'Counted 0', typeKey: 'C', type: 'C', aiCount: 0, actions: ['count', 'markers', 'not_on_job'] },
      { id: 'unlisted:H', kind: 'count', title: 'Type H drawn 13× on E2.0 — not in the fixture schedule. What is it?', detail: 'SUGGESTION ONLY', type: 'H', aiCount: 13,
        options: ['Same as Type C'], mergeTargets: { 'Same as Type C': 'C' }, actions: ['answer', 'count', 'not_on_job'] },
    ];
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`Merge ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
    const bidId = rows[0].id as string;
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [bidId, JSON.stringify(items)]);
    const post = (body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
    let res = await post({ itemIds: ['unlisted:H'], action: 'answer', answer: 'Same as Type C' });
    expect(res.status).toBe(200);
    expect((res.body.items as ReviewItem[]).find(i => i.id === 'unlisted:H')!.resolution?.answer).toBe('Same as Type C');
    res = await post({ itemIds: ['count:C'], action: 'not_on_job', reason: 'no pendant fixtures on this job' });
    expect(res.status).toBe(200);
    const h = (res.body.items as ReviewItem[]).find(i => i.id === 'unlisted:H')!;
    expect([h.resolution, h.previousResolution?.answer]).toEqual([undefined, 'Same as Type C']);
    expect(res.body.status).toBe('needs_review');
  });
});
