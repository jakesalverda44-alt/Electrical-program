// Audit: Security #4, #5, #6 (High) / Task 5.
// #4 — POST /documents took linked_id straight from the body with no ownership
//      check, so a restricted rep could attach a file to another rep's bid.
// #5 — the Drive proxy's ownership guard silently skipped (fetched the file
//      anyway) when the tracking lookup found no row.
// #6 — the client's declared multipart Content-Type was persisted and reflected
//      back inline, so `plans.pdf` uploaded as `text/html` was served as HTML.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string, name: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name, gc: `GC ${Date.now()}` })
    .expect(200);
  return res.body as { id: string };
}

describe('POST /api/documents — upload ownership (Task 5.1)', () => {
  it('403s when a restricted rep uploads to a bid they do not own, and stores no row', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('salesperson');
    const bid = await createBid(owner.token, `Owned by A ${Date.now()}`);

    const intruder = await makeUser('salesperson');
    const res = await request(app).post('/api/documents').set(auth(intruder.token))
      .field('linked_id', bid.id)
      .field('div', 'elec')
      .field('category', 'plans')
      .attach('file', Buffer.from('%PDF-1.4 fake'), 'plans.pdf');

    expect(res.status).toBe(403);
    const { rows } = await pool.query('SELECT id FROM documents WHERE linked_id=$1', [bid.id]);
    expect(rows.length).toBe(0);
  });

  it('allows the owning rep to upload to their own bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('salesperson');
    const bid = await createBid(owner.token, `Owned by B ${Date.now()}`);

    const res = await request(app).post('/api/documents').set(auth(owner.token))
      .field('linked_id', bid.id)
      .field('div', 'elec')
      .field('category', 'plans')
      .attach('file', Buffer.from('%PDF-1.4 fake'), 'plans.pdf');

    expect(res.status).toBe(200);
  });

  it('allows an unrestricted (manager/owner) role to upload to any bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const someone = await makeUser('salesperson');
    const bid = await createBid(someone.token, `Owned by C ${Date.now()}`);

    const manager = await makeUser('owner');
    const res = await request(app).post('/api/documents').set(auth(manager.token))
      .field('linked_id', bid.id)
      .field('div', 'elec')
      .field('category', 'plans')
      .attach('file', Buffer.from('%PDF-1.4 fake'), 'plans.pdf');

    expect(res.status).toBe(200);
  });
});

describe('GET /api/documents/drive-file/:fileId — fails closed on an untracked id (Task 5.2)', () => {
  it('403s a restricted rep for a file id with no matching documents row', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');
    const res = await request(app)
      .get(`/api/documents/drive-file/not-a-real-file-id-${Date.now()}`)
      .set(auth(rep.token));
    expect(res.status).toBe(403);
  });
});

describe('Content-Type is derived from the extension, never the client-declared type (Task 5.3)', () => {
  it('stores and serves a .pdf uploaded with multipart Content-Type text/html as application/pdf, inline, with nosniff', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('salesperson');
    const bid = await createBid(owner.token, `Content type test ${Date.now()}`);

    const uploadRes = await request(app).post('/api/documents').set(auth(owner.token))
      .field('linked_id', bid.id)
      .field('div', 'elec')
      .field('category', 'plans')
      .attach('file', Buffer.from('<html><body>not really html</body></html>'), {
        filename: 'plans.pdf',
        contentType: 'text/html',
      })
      .expect(200);

    expect(uploadRes.body.file_type).toBe('application/pdf');

    const viewRes = await request(app).get(`/api/documents/${uploadRes.body.id}/view`).set(auth(owner.token));
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^application\/pdf/);
    expect(viewRes.headers['x-content-type-options']).toBe('nosniff');
    expect(viewRes.headers['content-disposition']).toMatch(/^inline/);
  });

  it('forces attachment (never inline) for a non-pdf/image type even on /view', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('salesperson');
    const bid = await createBid(owner.token, `Content type test 2 ${Date.now()}`);

    const uploadRes = await request(app).post('/api/documents').set(auth(owner.token))
      .field('linked_id', bid.id)
      .field('div', 'elec')
      .field('category', 'plans')
      .attach('file', Buffer.from('col1,col2\n1,2'), { filename: 'data.csv', contentType: 'text/html' })
      .expect(200);

    expect(uploadRes.body.file_type).toBe('text/csv');

    const viewRes = await request(app).get(`/api/documents/${uploadRes.body.id}/view`).set(auth(owner.token));
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-disposition']).toMatch(/^attachment/);
    expect(viewRes.headers['x-content-type-options']).toBe('nosniff');
  });
});
