// Task 1 — migration 101 (est_items / est_assemblies / est_assembly_components /
// est_labor_factors / est_bid_lines / est_bid_settings) applies cleanly on the
// test DB and its CHECK constraints hold.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('migration 101 — estimating labor schema', () => {
  it('creates every est_* table', async (ctx) => {
    if (!ok) return ctx.skip();
    for (const table of [
      'est_items', 'est_assemblies', 'est_assembly_components',
      'est_labor_factors', 'est_bid_lines', 'est_bid_settings',
    ]) {
      await expect(pool.query(`SELECT 1 FROM ${table} LIMIT 1`)).resolves.toBeDefined();
    }
  });

  it('seeds the est_default_* app settings (insert-if-absent) without duplicates', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key LIKE 'est_default_%' ORDER BY key`
    );
    expect(rows.map(r => r.key)).toEqual([
      'est_default_consumables_pct',
      'est_default_labor_rate',
      'est_default_material_tax_pct',
      'est_default_small_tools_pct',
      'est_default_supervision_pct',
    ]);
    // Numeric and non-empty — either the Accubid-derived average or the 38.00 fallback.
    expect(Number(rows.find(r => r.key === 'est_default_labor_rate')!.value)).toBeGreaterThan(0);
  });

  it('rejects an est_items row with a unit outside EA/LF/C/M', async (ctx) => {
    if (!ok) return ctx.skip();
    await expect(pool.query(
      `INSERT INTO est_items (code, name, category, unit, source) VALUES ($1,'Bad Unit','Branch Power','GAL','manual')`,
      [`TEST-BADUNIT-${Date.now()}`]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects an est_items row with negative labor_hours', async (ctx) => {
    if (!ok) return ctx.skip();
    await expect(pool.query(
      `INSERT INTO est_items (code, name, category, unit, labor_hours, source) VALUES ($1,'Bad Hours','Branch Power','EA',-1,'manual')`,
      [`TEST-BADHOURS-${Date.now()}`]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects an est_bid_lines row with both assembly_id and item_id set', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `EstSchema ${Date.now()}`, gc: 'G' }).expect(200);
    const bidId = bid.body.id as string;

    const { rows: itemRows } = await pool.query(
      `INSERT INTO est_items (code, name, category, unit, labor_hours, source)
       VALUES ($1,'Test Item','Branch Power','EA',0.1,'manual') RETURNING id`,
      [`TEST-ITEM-${Date.now()}`]
    );
    const { rows: asmRows } = await pool.query(
      `INSERT INTO est_assemblies (code, name, category, unit, source)
       VALUES ($1,'Test Assembly','Branch Power','EA','manual') RETURNING id`,
      [`TEST-ASM-${Date.now()}`]
    );
    const itemId = itemRows[0].id as string;
    const asmId = asmRows[0].id as string;

    await expect(pool.query(
      `INSERT INTO est_bid_lines (bid_id, category, description, qty, unit, assembly_id, item_id)
       VALUES ($1,'Branch Power','bad row',1,'EA',$2,$3)`,
      [bidId, asmId, itemId]
    )).rejects.toThrow(/violates check constraint/i);

    // A row with neither set (unmatched/manual) is allowed.
    await expect(pool.query(
      `INSERT INTO est_bid_lines (bid_id, category, description, qty, unit)
       VALUES ($1,'Branch Power','manual row',1,'EA')`,
      [bidId]
    )).resolves.toBeDefined();

    await pool.query('DELETE FROM est_assemblies WHERE id=$1', [asmId]);
    await pool.query('DELETE FROM est_items WHERE id=$1', [itemId]);
  });
});
