// Phase 4 Task 2.5 — public proposal page routes: unknown token 404s;
// ?preview=1 never stamps proposal_viewed_at; the first real view stamps it
// exactly once and writes exactly one proposal_activity row; the fallback to
// the last-filed bid_data.json (Task 2.2) renders when there's no current
// Agent 4 composition on file; /download streams the filed docx bytes.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/bidstd/bid_data.example.json'), 'utf8')
);

async function createBid(token: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `Public Page Test ${Date.now()}`, gc: `Public Page Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}` })
    .expect(200);
  return res.body as { id: string; proposal_token: string };
}

async function fileBidData(bidId: string, bidName: string, override: Record<string, unknown> = {}) {
  const data = { ...FIXTURE, project_name: bidName, ...override };
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
     VALUES ($1,$2,'elec','bid_data.json','bid_data.json','bid_data',10,'application/json','test',$3)`,
    [bidId, bidName, Buffer.from(JSON.stringify(data)).toString('base64')]
  );
}

async function fileProposalDocx(bidId: string, bidName: string) {
  await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
     VALUES ($1,$2,'elec','APT_Bid_Test.docx','APT_Bid_Test.docx','proposal',10,
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document','test',$3)`,
    [bidId, bidName, Buffer.from('fake docx bytes').toString('base64')]
  );
}

describe('GET /bids/p/:token', () => {
  it('404s on an unknown token', async (ctx) => {
    if (!ok) return ctx.skip();
    await request(app).get('/api/bids/p/00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('404s (proposal not available) when no current composition AND no filed bid_data.json exist', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    const res = await request(app).get(`/api/bids/p/${bid.proposal_token}`).expect(404);
    // FIX-2 (post-review) — uniform 404 body across every public-route
    // failure mode (malformed token / unknown token / nothing to show yet).
    expect(res.body.error).toBe('Proposal not found');
  });

  it('404s on a malformed (non-UUID) token instead of hanging', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get(`/api/bids/p/not-a-uuid`).expect(404);
    expect(res.body.error).toBe('Proposal not found');
  });

  it('falls back to the last-filed bid_data.json when there is no current Agent 4 composition, and renders its HTML', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileBidData(bid.id, 'Fallback Rendered Project');

    const res = await request(app).get(`/api/bids/p/${bid.proposal_token}?preview=1`).expect(200);
    expect(res.body.fromFallback).toBe(true);
    expect(res.body.html).toContain('Fallback Rendered Project');
    expect(res.body.html).toContain('id="apt-accept-sign-mount"');
  });

  it('?preview=1 never stamps proposal_viewed_at', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileBidData(bid.id, bid.id);

    await request(app).get(`/api/bids/p/${bid.proposal_token}?preview=1`).expect(200);
    const { rows } = await pool.query('SELECT proposal_viewed_at FROM bids WHERE id=$1', [bid.id]);
    expect(rows[0].proposal_viewed_at).toBeNull();

    const { rows: activityRows } = await pool.query('SELECT 1 FROM proposal_activity WHERE bid_id=$1', [bid.id]);
    expect(activityRows.length).toBe(0);
  });

  it('the first real view stamps proposal_viewed_at exactly once and writes exactly one "viewed" activity row', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileBidData(bid.id, bid.id);

    const first = await request(app).get(`/api/bids/p/${bid.proposal_token}`).expect(200);
    expect(first.body.bid.proposal_viewed_at).not.toBeNull();

    const { rows: afterFirst } = await pool.query('SELECT proposal_viewed_at FROM bids WHERE id=$1', [bid.id]);
    const stampedAt = afterFirst[0].proposal_viewed_at;
    expect(stampedAt).not.toBeNull();

    // A second view must NOT move the timestamp (COALESCE) or add a second activity row.
    await new Promise(r => setTimeout(r, 20));
    await request(app).get(`/api/bids/p/${bid.proposal_token}`).expect(200);
    const { rows: afterSecond } = await pool.query('SELECT proposal_viewed_at FROM bids WHERE id=$1', [bid.id]);
    expect(new Date(afterSecond[0].proposal_viewed_at).getTime()).toBe(new Date(stampedAt).getTime());

    const { rows: activityRows } = await pool.query(
      `SELECT kind, direction FROM proposal_activity WHERE bid_id=$1 AND kind='viewed'`, [bid.id]
    );
    expect(activityRows.length).toBe(1);
    expect(activityRows[0].direction).toBe('in');
  });
});

describe('GET /bids/p/:token/download', () => {
  it('404s when no proposal docx has been filed', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await request(app).get(`/api/bids/p/${bid.proposal_token}/download`).expect(404);
  });

  it('streams the exact bytes of the most recently filed proposal .docx', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await createBid(u.token);
    await fileProposalDocx(bid.id, bid.id);

    // supertest doesn't know how to buffer a docx mimetype by default —
    // a custom parser makes res.body a real Buffer of the raw bytes.
    const res = await request(app).get(`/api/bids/p/${bid.proposal_token}/download`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect((res.body as Buffer).toString()).toBe('fake docx bytes');
  });

  it('404s on an unknown token', async (ctx) => {
    if (!ok) return ctx.skip();
    await request(app).get('/api/bids/p/00000000-0000-0000-0000-000000000000/download').expect(404);
  });

  it('404s on a malformed (non-UUID) token instead of hanging', async (ctx) => {
    if (!ok) return ctx.skip();
    const res = await request(app).get('/api/bids/p/not-a-uuid/download').expect(404);
    expect(res.body.error).toBe('Proposal not found');
  });
});
