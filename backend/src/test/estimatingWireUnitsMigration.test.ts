// Price accuracy round — decision 2 / fix round S6 / S7. Migration 156 moves
// #12 / #10 THHN to Chris's 5.15 / 5.65 h/M only on an untouched seed row: a
// manual or calibrated row, or a row an Accubid import reconciled from a real
// BOM (it keeps source 'seed', stamped accubid_reconciled_at), never moves.
// 155 carries no seed-row UPDATE any more. Runs 156's own SQL inside a
// rolled-back transaction, twice (idempotent).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const DIR = path.join(__dirname, '../../../database/migrations');
const m155 = fs.readFileSync(path.join(DIR, '155_allowance_and_demolition_units.sql'), 'utf8');
const m156 = fs.readFileSync(path.join(DIR, '156_price_accuracy_seed_updates.sql'), 'utf8');

describe('migrations 155 / 156 — seed-row updates', () => {
  it('155 updates no existing row; every 156 UPDATE skips non-seed and reconciled rows', () => {
    expect(m155).not.toMatch(/^UPDATE /m);
    const updates = m156.split(/;\s*\n/).filter(st => /UPDATE est_items/.test(st));
    expect(updates).toHaveLength(3);
    for (const u of updates) {
      expect(u).toMatch(/source = 'seed'/);
      expect(u).toMatch(/accubid_reconciled_at IS NULL/);
    }
  });

  it('moves a plain seed row; never a calibrated or an Accubid-reconciled one; running it twice changes nothing more', async (ctx) => {
    if (!ok) return ctx.skip();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE est_items SET source = 'seed', labor_hours = 3.5, accubid_reconciled_at = NULL WHERE code = 'THHN-12'`);
      await client.query(`UPDATE est_items SET source = 'seed', labor_hours = 4.8, accubid_reconciled_at = now() WHERE code = 'THHN-10'`);
      await client.query(`UPDATE est_items SET source = 'calibrated', aliases = ARRAY['x']::text[] WHERE code = 'LTG-POLEHEAD'`);
      await client.query(m156);
      const read = async () => (await client.query(`SELECT code, labor_hours, aliases FROM est_items WHERE code IN ('THHN-12','THHN-10','LTG-POLEHEAD') ORDER BY code`)).rows
        .map(r => [r.code, Number(r.labor_hours), (r.aliases as string[]).join('|')]);
      const once = await read();
      expect(once.find(r => r[0] === 'THHN-12')![1]).toBe(5.15);
      expect(once.find(r => r[0] === 'THHN-10')![1]).toBe(4.8); // reconciled from a real BOM: untouched
      expect(once.find(r => r[0] === 'LTG-POLEHEAD')![2]).toBe('x'); // calibrated: untouched
      await client.query(m156);
      expect(await read()).toEqual(once);
      // A plain seed pole head gains the alias once.
      await client.query(`UPDATE est_items SET source = 'seed', accubid_reconciled_at = NULL WHERE code = 'LTG-POLEHEAD'`);
      await client.query(m156);
      await client.query(m156);
      const { rows } = await client.query(`SELECT aliases FROM est_items WHERE code = 'LTG-POLEHEAD'`);
      expect((rows[0].aliases as string[]).filter(a => a === 'pole fixture head')).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('153–157 are idempotent: a second run is a no-op', async (ctx) => {
    if (!ok) return ctx.skip();
    const files = ['153_match_confidence_confirm.sql', '154_led_high_bay_2x4.sql', '155_allowance_and_demolition_units.sql', '156_price_accuracy_seed_updates.sql', '157_time_switch_unit.sql'];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const snap = async () => JSON.stringify((await client.query(`SELECT code, labor_hours, material_cost, aliases, source FROM est_items ORDER BY code`)).rows);
      for (const f of files) await client.query(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const first = await snap();
      for (const f of files) await client.query(fs.readFileSync(path.join(DIR, f), 'utf8'));
      expect(await snap()).toBe(first);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('fix round 3 N6: 156 is final (no insert); LC-TIMESW lives in 157 without the bare "timer switch" alias', async (ctx) => {
    expect(m156).not.toMatch(/LC-TIMESW/);
    const m157 = fs.readFileSync(path.join(DIR, '157_time_switch_unit.sql'), 'utf8');
    expect(m157).toMatch(/'LC-TIMESW'/);
    expect(m157).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    expect(m157).not.toMatch(/'timer switch'/);
    if (!ok) return ctx.skip();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM est_items WHERE code = 'LC-TIMESW'`);
      await client.query(m157);
      await client.query(m157);
      const { rows } = await client.query(`SELECT count(*)::int AS n, max(labor_hours) AS h FROM est_items WHERE code = 'LC-TIMESW'`);
      expect(rows[0].n).toBe(1);
      expect(Number(rows[0].h)).toBe(1.65);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
