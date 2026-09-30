// Price accuracy round, decision 2 — migration 155 moves #12 / #10 THHN to
// Chris's 5.15 / 5.65 h/M only on an untouched seed row; a manual or
// calibrated row is never changed. Runs the migration's own UPDATEs inside a
// rolled-back transaction.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/155_allowance_and_demolition_units.sql'), 'utf8');
const updates = sql.split('\n').filter(l => /^UPDATE est_items SET labor_hours/.test(l));

describe('migration 155 — #12 / #10 THHN labor units', () => {
  it('has exactly the two guarded UPDATEs', () => {
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toMatch(/AND source = 'seed'/);
  });

  it("moves a seed row, never a manual or calibrated one", async (ctx) => {
    if (!ok) return ctx.skip();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE est_items SET source = 'seed', labor_hours = 3.5 WHERE code = 'THHN-12'`);
      await client.query(`UPDATE est_items SET source = 'calibrated', labor_hours = 4.2 WHERE code = 'THHN-10'`);
      for (const u of updates) await client.query(u);
      const { rows } = await client.query(`SELECT code, labor_hours FROM est_items WHERE code IN ('THHN-12','THHN-10') ORDER BY code`);
      expect(rows.map(r => [r.code, Number(r.labor_hours)])).toEqual([['THHN-10', 4.2], ['THHN-12', 5.15]]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
