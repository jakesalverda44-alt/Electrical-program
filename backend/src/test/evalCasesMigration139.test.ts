// Evidence fix round 3 — migration nit: a database holding duplicate
// takeoff_eval_cases rows (pre-merge dev DBs that ran 136) must migrate: 139
// removes the duplicates (newest kept) and then creates the unique index.
// Runs inside a transaction that is rolled back; test DB only.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const SQL = fs.readFileSync(path.join(__dirname, '../../../database/migrations/139_eval_cases_dedupe_unique.sql'), 'utf8');

describe('migration 139 — de-duplicate eval cases, then the unique index', () => {
  it('a DB with duplicates migrates: newest row kept, index created; re-running is a no-op', async (ctx) => {
    if (!ok) return ctx.skip();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DROP INDEX IF EXISTS takeoff_eval_cases_bid_run_source_uniq');
      const { rows } = await c.query(`INSERT INTO bids (name, gc, loc) VALUES ('M139 ${Date.now()}', 'GC', 'X') RETURNING id`);
      const bid = rows[0].id;
      for (const [t, e] of [['2026-09-01', 1], ['2026-09-02', 2], ['2026-09-03', 3]] as const) {
        await c.query(`INSERT INTO takeoff_eval_cases (bid_id, run_id, source, expected, created_at) VALUES ($1, NULL, 'confirmed_counts', $2, $3)`, [bid, JSON.stringify([{ n: e }]), t]);
      }
      await c.query(SQL);
      const left = await c.query('SELECT expected FROM takeoff_eval_cases WHERE bid_id=$1', [bid]);
      expect(left.rows.map(r => r.expected)).toEqual([[{ n: 3 }]]);
      const idx = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname='takeoff_eval_cases_bid_run_source_uniq'`);
      expect(idx.rowCount).toBe(1);
      await c.query(SQL);
      expect((await c.query('SELECT 1 FROM takeoff_eval_cases WHERE bid_id=$1', [bid])).rowCount).toBe(1);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
