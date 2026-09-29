// Fix round S5 — the REAL "assign a type to each power pole" item, as the
// 2026-09-28 Kissimmee replay builds it (runCountingStage -> buildReviewItems),
// stored for a test bid and answered through POST /review/resolve with its
// own member keys; the stored items then go through enforcedCounts and the
// eval scorer. Test DB only; no model call.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { takeoffGate } from '../estimating/takeoffReview';
import { enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { diffAgainstExpected, validateExpectedFile } from '../eval/takeoffEval';
import { replay0928 } from './fixtures/realrun/replay0928';
import type { CountResult } from '../ai/countingStage';

const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/autozone-10077-kissimmee.expected.json'), 'utf8')));
const D = 'DUPLEX / FLOOR RECEPTACLE';

let ok = false; let user: TestUser; let cr: CountResult; let review: ReviewItem[];
beforeAll(async () => {
  ok = (await dbAvailable()) && (await isPdftoppmAvailable());
  if (!ok) return;
  user = await makeUser('owner');
  ({ cr, review } = await replay0928());
}, 300_000);

async function bid(): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`TypicalAssignReal ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, review_items, review_status) VALUES ($1, 'complete', $2, 'needs_review')`, [rows[0].id, JSON.stringify(review)]);
  return rows[0].id as string;
}
const post = (bidId: string, body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(user.token)).send(body);
const stored = async (bidId: string) => (await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [bidId])).rows[0].review_items as ReviewItem[];
function scored(items: ReviewItem[]) {
  const byType = enforcedCounts(cr, items).byType;
  const types = cr.types.map(t => (byType.get(t.key) != null ? { ...t, count: byType.get(t.key)! } : t));
  return { byType, diff: diffAgainstExpected(expected, { ...cr, types }) };
}

async function assignSuggested(bidId: string) {
  const item = review.find(i => i.id.startsWith('typicalassign:'))!;
  let last: request.Response | null = null;
  for (const m of item.hostAssignment!.members) {
    last = await post(bidId, m.suggested
      ? { itemIds: [item.id], memberKey: m.key, action: 'count', qty: m.suggested }
      : { itemIds: [item.id], memberKey: m.key, action: 'confirm', reason: 'none of this pole type here' });
    expect(last.status, m.key).toBe(200);
  }
  return { item, res: last! };
}

describe('the real Kissimmee pole-assignment item through /review/resolve', () => {
  it('the real member keys; nothing counted until answered (receptacles 24)', async (ctx) => {
    if (!ok) return ctx.skip();
    const item = review.find(i => i.id.startsWith('typicalassign:'))!;
    expect(item.reconcileMembers!.map(m => m.key)).toEqual(['#1 Office area power pole', '#2 Checkout counter power pole', '#3 Parts pod power pole', '#4 Test station power pole', '#6 Commercial counter power pole']);
    const bidId = await bid();
    expect(scored(await stored(bidId)).diff.rows.find(r => r.id === 'receptacles_total')!.actual).toBe(24);
  });

  it('the suggestion answered type by type, the drawn simplex answered "additional": duplex 14, simplex 8, receptacles 33', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await bid();
    const { item, res } = await assignSuggested(bidId);
    const items = res.body.items as ReviewItem[];
    expect(items.find(i => i.id === item.id)!.resolution).toBeTruthy(); // 1+1+2+1+1 = 6: no reason needed
    // S4 — the follow-up for the simplex drawn at an unknown pole blocks.
    const q = items.find(i => i.id === 'typicalassignat:PP-1..6:SIMPLEX')!;
    expect(q).toBeTruthy();
    expect(await takeoffGate(bidId)).not.toBeNull();
    const r = await post(bidId, { itemIds: [q.id], action: 'answer', answer: q.options![0] });
    expect(r.status).toBe(200);
    const s = scored(await stored(bidId));
    expect([s.byType.get(D), s.byType.get('SIMPLEX'), s.byType.get('GFCI'), s.byType.get('WP GFI')]).toEqual([14, 8, 7, 4]);
    const row = s.diff.rows.find(x => x.id === 'receptacles_total')!;
    expect([row.actual, row.delta]).toEqual([33, -5]);
    // Everything that passed still passes.
    for (const id of ['type_A', 'type_B', 'type_M', 'type_C', 'linear_led_total', 'downlights', 'site_poles', 'site_heads', 'rtu_connections', 'battery_chargers']) {
      expect(s.diff.rows.find(x => x.id === id)!.verdict, id).toBe('pass');
    }
  });

  it('the same, with the drawn simplex answered "the same outlet as the pole package": simplex 7, receptacles 32', async (ctx) => {
    if (!ok) return ctx.skip();
    const bidId = await bid();
    const { res } = await assignSuggested(bidId);
    const q = (res.body.items as ReviewItem[]).find(i => i.id === 'typicalassignat:PP-1..6:SIMPLEX')!;
    expect((await post(bidId, { itemIds: [q.id], action: 'answer', answer: q.options![1] })).status).toBe(200);
    const s = scored(await stored(bidId));
    expect([s.byType.get(D), s.byType.get('SIMPLEX')]).toEqual([14, 7]);
    expect(s.diff.rows.find(x => x.id === 'receptacles_total')!.actual).toBe(32);
  });
});
