// Audit batch 3, Task 8 (audit data #8) — services/brief.ts's 13-query SQL
// half now shares the same TTL + in-flight-collapse cache shape as the
// existing Graph snapshot cache (services/brief.ts:loadGraphSnapshot),
// keyed per scope. Two calls to buildBrief within the TTL must run the
// queries once; a call after the TTL must run them again.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser } from './harness';
import { buildBrief, __resetBriefCachesForTests } from '../services/brief';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

beforeEach(() => { __resetBriefCachesForTests(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('buildBrief — SQL half is cached per scope with a 90s TTL (Task 8)', () => {
  it('two calls within the TTL run the 13 SQL-brief queries once, not twice', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const querySpy = vi.spyOn(pool, 'query');

    await buildBrief({ id: u.id, role: u.role });
    const afterFirst = querySpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await buildBrief({ id: u.id, role: u.role });
    expect(querySpy.mock.calls.length).toBe(afterFirst); // cache hit — no new queries
  });

  it('a call after the TTL re-runs the queries', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const querySpy = vi.spyOn(pool, 'query');

    await buildBrief({ id: u.id, role: u.role });
    const afterFirst = querySpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 91_000); // > the 90s TTL

    await buildBrief({ id: u.id, role: u.role });
    expect(querySpy.mock.calls.length).toBe(afterFirst * 2); // ran fresh again
  });

  it('different scopes (different users) get independent cache entries', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const querySpy = vi.spyOn(pool, 'query');

    await buildBrief({ id: rep1.id, role: rep1.role });
    const afterRep1 = querySpy.mock.calls.length;
    expect(afterRep1).toBeGreaterThan(0);

    // A different rep (different salesperson scope) must not hit rep1's cache entry.
    await buildBrief({ id: rep2.id, role: rep2.role });
    expect(querySpy.mock.calls.length).toBe(afterRep1 * 2);

    // But a second call for rep1 still hits their own cache entry.
    await buildBrief({ id: rep1.id, role: rep1.role });
    expect(querySpy.mock.calls.length).toBe(afterRep1 * 2);
  });
});
