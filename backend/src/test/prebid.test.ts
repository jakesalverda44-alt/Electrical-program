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

import { readFileSync } from 'fs';
import { join } from 'path';

const fx = (n: string) => join(__dirname, 'fixtures/prebid', n);

describe('import-prebid', () => {
  it('imports takeoff and scope, and fills sq_ft when empty', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Imp ${Date.now()}`, gc: 'G', project_type: 'retail' }).expect(200);

    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx'))
      .attach('scope', fx('autozone_scope.docx'))
      .expect(200);

    expect(r.body.takeoff.itemCount).toBeGreaterThan(30);
    expect(r.body.takeoff.unresolvedCount).toBeGreaterThanOrEqual(6);
    expect(r.body.scope.furnishModel).toBe('OFEI');
    expect(r.body.sqFtApplied).toBe(true);
    expect(r.body.suggestedBrand).toMatch(/AutoZone/);

    const { rows } = await pool.query('SELECT sq_ft, brand FROM bids WHERE id=$1', [bid.body.id]);
    expect(Number(rows[0].sq_ft)).toBe(7381);
    expect(rows[0].brand).toBeNull();          // suggested, never auto-written
  });

  it('never overwrites an existing sq_ft', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Sq ${Date.now()}`, gc: 'G', sq_ft: 1234 }).expect(200);
    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx')).expect(200);
    expect(r.body.sqFtApplied).toBe(false);
    const { rows } = await pool.query('SELECT sq_ft FROM bids WHERE id=$1', [bid.body.id]);
    expect(Number(rows[0].sq_ft)).toBe(1234);
  });

  it('accepts a scope document alone', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ScopeOnly ${Date.now()}`, gc: 'G' }).expect(200);
    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('scope', fx('autozone_scope.docx')).expect(200);
    expect(r.body.takeoff).toBeNull();
    expect(r.body.scope.sections).toHaveLength(6);
  });

  it('rejects a request with neither file', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `None ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .expect(400);
  });

  it('does not disturb a final takeoff on the same bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Both ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'final','[]'::jsonb,'[]'::jsonb,99)`, [bid.body.id]
    );
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx')).expect(200);
    const { rows } = await pool.query(
      `SELECT item_count FROM bid_takeoffs WHERE bid_id=$1 AND kind='final'`, [bid.body.id]
    );
    expect(Number(rows[0].item_count)).toBe(99);
  });

  it('reads the package back', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Read ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app).post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx'))
      .attach('scope', fx('autozone_scope.docx')).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${bid.body.id}/prebid`).set(auth(u.token)).expect(200);
    expect(r.body.takeoff.categories.length).toBeGreaterThan(5);
    expect(r.body.scope.furnish_model).toBe('OFEI');
  });
});
