// Estimating Phase B, Task 1 — migration 108 (est_bid_lines.line_key/qty_source,
// est_sheets, est_markups, est_default_drop_ft/slack_pct) applies cleanly on
// the test DB and its CHECK constraints hold.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function makeBid(app: import('express').Express, token: string): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `PlanViewerSchema ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' })
    .expect(200);
  return res.body.id as string;
}

async function makeDocument(bidId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, storage_url, uploaded_by)
     VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', 'https://drive.google.com/file/d/FAKEID/view', 'test')
     RETURNING id`,
    [bidId]
  );
  return rows[0].id as string;
}

describe('migration 108 — plan viewer schema', () => {
  it('creates est_sheets and est_markups', async (ctx) => {
    if (!ok) return ctx.skip();
    for (const table of ['est_sheets', 'est_markups']) {
      await expect(pool.query(`SELECT 1 FROM ${table} LIMIT 1`)).resolves.toBeDefined();
    }
  });

  it('adds line_key (unique, non-null) and qty_source to est_bid_lines', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_name='est_bid_lines' AND column_name IN ('line_key','qty_source')`
    );
    const byName = new Map(rows.map(r => [r.column_name, r]));
    expect(byName.get('line_key')?.is_nullable).toBe('NO');
    expect(byName.get('qty_source')?.is_nullable).toBe('NO');
    expect(byName.get('qty_source')?.column_default).toContain('takeoff');
  });

  it('seeds est_default_drop_ft and est_default_slack_pct (insert-if-absent)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { rows } = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('est_default_drop_ft','est_default_slack_pct') ORDER BY key`
    );
    expect(rows).toEqual([
      { key: 'est_default_drop_ft', value: '10' },
      { key: 'est_default_slack_pct', value: '10' },
    ]);
  });

  it('rejects an est_bid_lines row with qty_source outside takeoff/manual/markup', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    await expect(pool.query(
      `INSERT INTO est_bid_lines (bid_id, category, description, qty, unit, source, qty_source)
       VALUES ($1, 'Branch Power', 'Bad qty_source', 1, 'EA', 'manual', 'ai')`,
      [bidId]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('every est_bid_lines row gets a distinct, non-null line_key', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    await pool.query(
      `INSERT INTO est_bid_lines (bid_id, category, description, qty, unit, source)
       VALUES ($1, 'Branch Power', 'Line A', 1, 'EA', 'manual'), ($1, 'Branch Power', 'Line B', 1, 'EA', 'manual')`,
      [bidId]
    );
    const { rows } = await pool.query(`SELECT line_key FROM est_bid_lines WHERE bid_id=$1`, [bidId]);
    expect(rows.length).toBe(2);
    expect(rows[0].line_key).toBeTruthy();
    expect(rows[1].line_key).toBeTruthy();
    expect(rows[0].line_key).not.toBe(rows[1].line_key);
  });

  it('rejects an est_sheets row with an unknown discipline or kind', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    await expect(pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt, discipline)
       VALUES ($1, $2, 0, 792, 612, 'Q')`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
    await expect(pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt, kind)
       VALUES ($1, $2, 0, 792, 612, 'blueprint')`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects a negative or zero ft_per_pt on est_sheets', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    await expect(pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt, ft_per_pt)
       VALUES ($1, $2, 0, 792, 612, -1)`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
    await expect(pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt, ft_per_pt)
       VALUES ($1, $2, 0, 792, 612, 0)`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('allows a (document_id, page_index) pair once, per the composite primary key', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    await pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt) VALUES ($1, $2, 0, 792, 612)`,
      [bidId, docId]
    );
    await expect(pool.query(
      `INSERT INTO est_sheets (bid_id, document_id, page_index, width_pt, height_pt) VALUES ($1, $2, 0, 792, 612)`,
      [bidId, docId]
    )).rejects.toThrow(/duplicate key/i);
  });

  it('rejects an est_markups row with an unknown kind or status', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    await expect(pool.query(
      `INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status)
       VALUES ($1, $2, 0, 'polygon', '[[1,1]]'::jsonb, 'confirmed')`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
    await expect(pool.query(
      `INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status)
       VALUES ($1, $2, 0, 'count', '[[1,1]]'::jsonb, 'draft')`,
      [bidId, docId]
    )).rejects.toThrow(/violates check constraint/i);
  });

  it('allows a null line_key on est_markups (unassigned marker)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    const { rows } = await pool.query(
      `INSERT INTO est_markups (bid_id, document_id, page_index, line_key, kind, points, status)
       VALUES ($1, $2, 0, NULL, 'count', '[[100,200]]'::jsonb, 'confirmed') RETURNING id, line_key`,
      [bidId, docId]
    );
    expect(rows[0].line_key).toBeNull();
  });

  it('a soft-deleted markup keeps deleted_at set and is not lost', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u.token);
    const docId = await makeDocument(bidId);
    const { rows } = await pool.query(
      `INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status)
       VALUES ($1, $2, 0, 'count', '[[1,1]]'::jsonb, 'confirmed') RETURNING id`,
      [bidId, docId]
    );
    await pool.query(`UPDATE est_markups SET deleted_at = now() WHERE id = $1`, [rows[0].id]);
    const { rows: stillThere } = await pool.query(`SELECT deleted_at FROM est_markups WHERE id = $1`, [rows[0].id]);
    expect(stillThere[0].deleted_at).toBeTruthy();
  });
});
