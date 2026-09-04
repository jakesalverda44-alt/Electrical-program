// Audit batch 3, Task 9 (audit data #15) — the intake similarity match used to
// recompute from scratch (O(pending × all-bids) string comparisons) on every
// GET /api/intake, an endpoint the sidebar badge polls. It's now cached,
// keyed on max(updated_at) of intake_items and bids: two calls with nothing
// changed run the underlying bid-candidates query once; a call after an
// update (a new pending item) runs it again.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { __resetIntakeSimilarCacheForTests } from '../routes/intake';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const BID_CANDIDATES_SQL = `SELECT id, name, stage FROM bids WHERE deleted_at IS NULL`;

describe('GET /api/intake — similarity cache (Task 9)', () => {
  it('two calls with nothing changed recompute once; a new pending item forces a recompute', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');

    // The cache key is deliberately global (max(updated_at) across the whole
    // intake_items/bids tables, per the plan) — under a full-suite run, some
    // other test file's concurrent bid/intake write can legitimately bump
    // that signature between this test's two "nothing changed" calls and
    // force a real (correct) recompute, which isn't this test's own doing.
    // Retry the "hit" half a few times rather than asserting on a single,
    // possibly-unlucky window; the "must invalidate after a real change"
    // half doesn't need this, since it's a red flag if that ever silently
    // stays cached.
    let sawCleanHit = false;
    for (let attempt = 0; attempt < 5 && !sawCleanHit; attempt++) {
      __resetIntakeSimilarCacheForTests();
      const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}_${attempt}`;
      await request(app).post('/api/intake').set(auth(u.token))
        .send({ name: `Cache test A ${uniq}`, gc: 'G' }).expect(200);

      const querySpy = vi.spyOn(pool, 'query');
      await request(app).get('/api/intake').set(auth(u.token)).expect(200);
      const afterFirst = querySpy.mock.calls.filter(c => c[0] === BID_CANDIDATES_SQL).length;
      expect(afterFirst).toBe(1);

      await request(app).get('/api/intake').set(auth(u.token)).expect(200);
      const afterSecond = querySpy.mock.calls.filter(c => c[0] === BID_CANDIDATES_SQL).length;
      querySpy.mockRestore();
      if (afterSecond === afterFirst) sawCleanHit = true; // cache hit, nothing else interfered
    }
    expect(sawCleanHit).toBe(true);

    // A new pending item bumps max(intake_items.updated_at) — must invalidate.
    // No retry here: a stale cache after a real, local change is the actual bug.
    __resetIntakeSimilarCacheForTests();
    const uniq2 = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: `Cache test B1 ${uniq2}`, gc: 'G' }).expect(200);
    const spy2 = vi.spyOn(pool, 'query');
    await request(app).get('/api/intake').set(auth(u.token)).expect(200);
    const before = spy2.mock.calls.filter(c => c[0] === BID_CANDIDATES_SQL).length;
    await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: `Cache test B2 ${uniq2}`, gc: 'G' }).expect(200);
    await request(app).get('/api/intake').set(auth(u.token)).expect(200);
    // >= (not ===): a concurrent test file's own write could also have bumped
    // the same global signature and forced an extra recompute — the only
    // thing that would be a real bug is this test's own change NOT causing
    // at least one.
    expect(spy2.mock.calls.filter(c => c[0] === BID_CANDIDATES_SQL).length).toBeGreaterThanOrEqual(before + 1);
  });

  it('same output as before: a REBID item still matches its original bid after the cache is warm', async (ctx) => {
    if (!ok) return ctx.skip();
    __resetIntakeSimilarCacheForTests();
    const u = await makeUser('owner');
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const baseName = `Cache-Warm Original ${uniq}`;
    const rebidName = `Cache-Warm Original ${uniq} (REBID)`;

    const bidRes = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: baseName, gc: 'Same GC LLC' }).expect(200);

    // Warm the cache with an unrelated GET before the item that should match exists.
    await request(app).get('/api/intake').set(auth(u.token)).expect(200);

    const intakeRes = await request(app).post('/api/intake').set(auth(u.token))
      .send({ name: rebidName, gc: 'Same GC LLC' }).expect(200);

    const list = await request(app).get('/api/intake').set(auth(u.token)).expect(200);
    const item = list.body.find((r: { id: string }) => r.id === intakeRes.body.id);
    expect(item.similar).toEqual([
      expect.objectContaining({ kind: 'bid', id: bidRes.body.id, name: baseName }),
    ]);
  });
});
