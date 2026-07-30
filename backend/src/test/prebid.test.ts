import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import request from 'supertest';
import { app } from '../index';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('prebid schema', () => {
  it('stores a prebid and a final takeoff on the same bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `KindT ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    for (const kind of ['prebid', 'final']) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,$2,'[]'::jsonb,'[]'::jsonb,0)
         ON CONFLICT (bid_id, kind) DO UPDATE SET item_count = EXCLUDED.item_count`,
        [id, kind]
      );
    }

    const { rows } = await pool.query(
      'SELECT kind FROM bid_takeoffs WHERE bid_id=$1 ORDER BY kind', [id]
    );
    expect(rows.map(r => r.kind)).toEqual(['final', 'prebid']);
  });

  it('defaults existing-style inserts to final', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `DefaultT ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, categories, line_items, item_count)
       VALUES ($1,'[]'::jsonb,'[]'::jsonb,0)`, [bid.body.id]
    );
    const { rows } = await pool.query('SELECT kind FROM bid_takeoffs WHERE bid_id=$1', [bid.body.id]);
    expect(rows[0].kind).toBe('final');
  });

  it('accepts the new document categories', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CatT ${Date.now()}`, gc: 'G' }).expect(200);
    for (const category of ['prebid_takeoff', 'prebid_scope']) {
      await expect(pool.query(
        `INSERT INTO documents (linked_id, linked_name, div, name, category, uploaded_by)
         VALUES ($1,'x','elec','f.xlsx',$2,'test')`, [bid.body.id, category]
      )).resolves.toBeTruthy();
    }
  });

  it('creates bid_prebid_scope keyed by bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ScopeT ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_prebid_scope (bid_id, furnish_model, sections)
       VALUES ($1,'OFEI','[]'::jsonb)`, [bid.body.id]
    );
    const { rows } = await pool.query(
      'SELECT furnish_model FROM bid_prebid_scope WHERE bid_id=$1', [bid.body.id]
    );
    expect(rows[0].furnish_model).toBe('OFEI');
  });
});
