// Price accuracy round D — re-check R1: the close-up "reclassified" item is
// answered through the REAL resolve path (resolveReviewItems on the test DB),
// both options, and the answer carries over a re-run.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { resolveReviewItems } from '../estimating/takeoffReview';
import { replay36thB, type Live36thB } from './fixtures/realrun/replay36thB';
import { carryOverResolutions, enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import { enforceCountsOnTakeoff } from '../bidstd/enforceCounts';
import { isPdftoppmAvailable } from '../ai/documentPrep';

const allNew = (quote: string) => (run: Live36thB) => {
  for (const c of run.countResult.remodel.conventions) c.quote = quote;
  for (const m of run.countResult.remodel.marks) if (m.sheetKey.endsWith('#15')) m.status = 'new';
  run.countResult.remodel.unknownStatus = [];
};
const KEYS = ['DUPLEX RECEPTACLE', 'GFI', '42', 'WP'];

async function bidWith(items: ReviewItem[]): Promise<string> {
  const u = await makeUser('owner');
  const res = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `D R1 ${Date.now()}`, gc: `D R1 GC ${Date.now()} ${Math.random()}`, amount: 1000, brand: 'X' }).expect(200);
  const bidId = res.body.id as string;
  await pool.query("INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1,'agent1_complete',$2,'needs_review') ON CONFLICT (bid_id) DO UPDATE SET review_items=$2, review_status='needs_review'", [bidId, JSON.stringify(items)]);
  return bidId;
}

describe('Re-check R1 — statuscrop:reclassified through resolveReviewItems', () => {
  it('"restore" gives the 26 back as new and priced; "confirm" keeps them existing; the answer carries over a re-run', async (ctx) => {
    if (!(await dbAvailable()) || !(await isPdftoppmAvailable())) return ctx.skip();
    const r = await replay36thB({ mutate: allNew('SHADED SYMBOL DENOTES NEW RECEPTICLE'), crops: () => ({ answer: 'open', confidence: 'high' }) });
    const rc = r.review.find(i => i.id === 'statuscrop:reclassified')!;
    const takeoff = () => [{ name: 'Branch Power', items: (r.stage.agent1.quantities as Array<Record<string, unknown>>).filter(q => q.category === 'Branch Power').map(q => ({ item: String(q.item), description: String(q.spec ?? ''), unit: String(q.unit ?? 'EA'), qty: Number(q.qty), source: 'Agent 2', ...(q.countType ? { count_type: String(q.countType) } : {}) })) }];
    const pricedQty = (items: ReviewItem[], type: string) => {
      const out = enforceCountsOnTakeoff(takeoff(), r.stage.countResult, enforcedCounts(r.stage.countResult, items));
      return out.takeoff.flatMap(c => c.items).filter(i => i.count_type === type).reduce((a, i) => a + Number(i.qty), 0);
    };

    // restore
    const b1 = await bidWith(r.review);
    const o1 = await resolveReviewItems(b1, [rc.id], { action: 'answer', answer: rc.options![1] }, 'Test');
    expect(o1.ok).toBe(true);
    const stored1 = o1.ok ? o1.review.items : [];
    expect(stored1.find(i => i.id === rc.id)!.resolution).toMatchObject({ action: 'answer', answer: rc.options![1] });
    const e1 = enforcedCounts(r.stage.countResult, stored1);
    expect(KEYS.map(k => e1.byType.get(k))).toEqual([14, 7, 3, 2]);
    expect(pricedQty(stored1, 'Duplex receptacle')).toBe(14);
    // a re-run with the same evidence keeps the answer
    const again = carryOverResolutions(r.review, stored1).find(i => i.id === rc.id)!;
    expect(again.resolution).toMatchObject({ answer: rc.options![1], carriedOver: true });

    // confirm
    const b2 = await bidWith(r.review);
    const o2 = await resolveReviewItems(b2, [rc.id], { action: 'answer', answer: rc.options![0] }, 'Test');
    expect(o2.ok).toBe(true);
    const stored2 = o2.ok ? o2.review.items : [];
    expect(stored2.find(i => i.id === rc.id)!.resolution).toMatchObject({ answer: rc.options![0] });
    const e2 = enforcedCounts(r.stage.countResult, stored2);
    expect(KEYS.map(k => e2.byType.get(k) ?? 0)).toEqual([0, 0, 0, 0]);
    expect(pricedQty(stored2, 'Duplex receptacle')).toBe(0);
  }, 300_000);

  it('statuscrop:low still resolves type by type through the route', async (ctx) => {
    if (!(await dbAvailable()) || !(await isPdftoppmAvailable())) return ctx.skip();
    const r = await replay36thB({ crops: () => ({ answer: 'unclear', confidence: 'low' }) });
    const low = r.review.find(i => i.id === 'statuscrop:low')!;
    const b = await bidWith(r.review);
    const o = await resolveReviewItems(b, [low.id], { action: 'count', qty: 5, memberKey: 'DUPLEX RECEPTACLE' }, 'Test');
    expect(o.ok).toBe(true);
    const stored = o.ok ? o.review.items.find(i => i.id === low.id)! : null;
    expect(stored!.reconcileMembers!.find(m => m.key === 'DUPLEX RECEPTACLE')!.resolution).toMatchObject({ action: 'count', qty: 5 });
  }, 300_000);
});
