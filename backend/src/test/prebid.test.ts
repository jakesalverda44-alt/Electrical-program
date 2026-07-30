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

describe('prebid comparables', () => {
  it('matches unpriced jobs that have a prebid takeoff', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const type = `t_${Date.now()}`;

    const comp = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Comp ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5000 }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,5)`, [comp.body.id]
    );

    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Subj ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 7500 }).expect(200);

    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/prebid-comparables`).set(auth(u.token)).expect(200);

    const hit = r.body.comparables.find((c: { id: string }) => c.id === comp.body.id);
    expect(hit).toBeTruthy();                       // matched despite amount being null
    expect(Math.round(hit.sq_ft_delta_pct)).toBe(50); // 7500 vs 5000
  });

  it('excludes jobs with no prebid takeoff', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const type = `t2_${Date.now()}`;
    const bare = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Bare ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 4000 }).expect(200);
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `S2 ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 4200 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/prebid-comparables`).set(auth(u.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).not.toContain(bare.body.id);
  });

  it('a bid with both kinds appears once in comparables', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const brand = `Dup${Date.now()}`;
    const other = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dup ${Date.now()}`, gc: 'G', brand, amount: 100000, sq_ft: 4000 }).expect(200);
    for (const kind of ['prebid', 'final']) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,$2,'[]'::jsonb,'[]'::jsonb,1)`, [other.body.id, kind]
      );
    }
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `DupS ${Date.now()}`, gc: 'G', brand, amount: 90000 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/comparables`).set(auth(u.token)).expect(200);
    const hits = r.body.comparables.filter((c: { id: string }) => c.id === other.body.id);
    expect(hits).toHaveLength(1);
  });

  it('compare selects rows by kind', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Cmp ${Date.now()}`, gc: 'G', sq_ft: 5000 }).expect(200);
    const comp = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CmpC ${Date.now()}`, gc: 'G', sq_ft: 5000 }).expect(200);
    for (const id of [subj.body.id, comp.body.id]) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,'prebid','[{"name":"LIGHTING","itemCount":2,"unresolvedCount":0,"totals":{"EA":10},"subcategories":[]}]'::jsonb,'[]'::jsonb,2)`,
        [id]
      );
    }
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/compare?kind=prebid&against=${comp.body.id}`)
      .set(auth(u.token)).expect(200);
    expect(r.body.categoryNames).toContain('LIGHTING');
    expect(r.body.jobs).toHaveLength(2);
  });

  it('rep cannot pull another rep job into prebid comparables', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const type = `t3_${Date.now()}`;
    const hidden = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `H ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5000 }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,1)`, [hidden.body.id]
    );
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: `M ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5100 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${mine.body.id}/prebid-comparables`).set(auth(rep2.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).not.toContain(hidden.body.id);
  });
});

describe('takeoff drill-down kind selection', () => {
  it('returns the final row by default when a bid holds both kinds', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `TDD ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,11)`, [bid.body.id]
    );
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'final','[]'::jsonb,'[]'::jsonb,22)`, [bid.body.id]
    );
    const r = await request(app)
      .get(`/api/preconstruction/${bid.body.id}/takeoff`).set(auth(u.token)).expect(200);
    expect(r.body.item_count).toBe(22);
  });

  it('returns the prebid row when kind=prebid is passed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `TDD2 ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,11)`, [bid.body.id]
    );
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'final','[]'::jsonb,'[]'::jsonb,22)`, [bid.body.id]
    );
    const r = await request(app)
      .get(`/api/preconstruction/${bid.body.id}/takeoff?kind=prebid`).set(auth(u.token)).expect(200);
    expect(r.body.item_count).toBe(11);
  });

  it('falls back to final for an unexpected kind value', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `TDD3 ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,11)`, [bid.body.id]
    );
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'final','[]'::jsonb,'[]'::jsonb,22)`, [bid.body.id]
    );
    const r = await request(app)
      .get(`/api/preconstruction/${bid.body.id}/takeoff?kind=bogus`).set(auth(u.token)).expect(200);
    expect(r.body.item_count).toBe(22);
  });
});

describe('prebid-analyze', () => {
  it('requires an against parameter', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AI ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_prebid_scope (bid_id, sections) VALUES ($1,'[]'::jsonb)`, [bid.body.id]);
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/prebid-analyze`).set(auth(u.token))
      .expect(400);
  });

  it('404s when the bid has no pre-bid scope', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const a = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIa ${Date.now()}`, gc: 'G' }).expect(200);
    const b = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIb ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app)
      .post(`/api/preconstruction/${a.body.id}/prebid-analyze?against=${b.body.id}`)
      .set(auth(u.token)).expect(404);
  });

  // This sandbox intentionally leaves the Anthropic key unset (see .env), and the
  // synchronous 503 gate mirrors the sibling AI routes (/analyze, run-agent4): passing
  // both the `against` and pre-bid-scope checks with no key configured proves request
  // validation ran and stops before any Anthropic call, without a live network request
  // or mocking infrastructure (this backend has none).
  it('passes validation but 503s when the Anthropic key is not configured, without stamping running', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const a = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIc ${Date.now()}`, gc: 'G' }).expect(200);
    const b = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AId ${Date.now()}`, gc: 'G' }).expect(200);
    for (const id of [a.body.id, b.body.id]) {
      await pool.query(
        `INSERT INTO bid_prebid_scope (bid_id, sections)
         VALUES ($1,'[{"id":"A","title":"Service & Distribution","items":["gear"]}]'::jsonb)`, [id]);
    }
    const r = await request(app)
      .post(`/api/preconstruction/${a.body.id}/prebid-analyze?against=${b.body.id}`)
      .set(auth(u.token)).expect(503);
    expect(r.body.error).toMatch(/not configured/);
    const { rows } = await pool.query(
      'SELECT ai_status, ai_comparison_against FROM bid_prebid_scope WHERE bid_id=$1', [a.body.id]);
    expect(rows[0].ai_status).toBeNull();
    expect(rows[0].ai_comparison_against).toBeNull();
  });
});
