// Audit batch 3, Task 10 (audit data #20) — the pool had no explicit sizing
// or statement timeout, so a single runaway/blocked query could hold a
// connection (and, at pg's default max: 10, potentially a good fraction of
// the pool) forever. statement_timeout: 15_000 is set as a pool/connection
// option (db/pool.ts), not a manual SQL SET, so it applies to every
// connection this pool ever opens.
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('db/pool.ts — statement_timeout (Task 10)', () => {
  it('a deliberately slow query is rejected by the statement timeout, not left to hang', async (ctx) => {
    if (!ok) return ctx.skip();
    await expect(pool.query('SELECT pg_sleep(20)')).rejects.toMatchObject({
      code: '57014', // Postgres's own "query_canceled" (statement timeout) SQLSTATE
    });
  }, 25_000);

  it('a normal, fast query is unaffected', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query('SELECT 1 AS n');
    expect(rows[0].n).toBe(1);
  });
});
