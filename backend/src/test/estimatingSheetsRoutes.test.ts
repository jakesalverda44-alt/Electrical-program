// Estimating Phase B, Task 2 — /api/estimating/:bidId/sheets* routes.
// Covers: sheet index built from a real fixture PDF, refresh preserving a
// calibrated scale, bid-access 403/404, cross-bid document-id 404 on the
// file route, and a mocked Drive fetch (never a real Drive/network call).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, TestUser } from './harness';
import { buildSampleSheetPdf } from './fixtures/estimating/buildSheetPdf';

const getFileMedia = vi.fn();
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return {
    ...actual,
    getFileMedia: (...args: unknown[]) => getFileMedia(...(args as [string])),
  };
});

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
afterEach(() => { getFileMedia.mockReset(); });

async function makeBid(app: import('express').Express, user: TestUser): Promise<string> {
  const res = await request(app).post('/api/bids').set(auth(user.token))
    .send({ name: `SheetsRoute ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' })
    .expect(200);
  return res.body.id as string;
}

/** A plan document stored straight in the DB (file_data base64) — the
 *  simplest path, no Drive involved. */
async function makePlanDocDbStored(bidId: string): Promise<string> {
  const buf = buildSampleSheetPdf();
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
     VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', $2, 'test') RETURNING id`,
    [bidId, buf.toString('base64')]
  );
  return rows[0].id as string;
}

/** A plan document stored on (mocked) Google Drive. */
async function makePlanDocDriveStored(bidId: string, driveFileId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, storage_url, uploaded_by)
     VALUES ($1, 'plans.pdf', 'plans', 'application/pdf', $2, 'test') RETURNING id`,
    [bidId, `https://drive.google.com/file/d/${driveFileId}/view`]
  );
  return rows[0].id as string;
}

describe('GET /api/estimating/:bidId/sheets — build on first call, cache after', () => {
  it('builds est_sheets from a DB-stored plan PDF and returns both pages', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await makePlanDocDbStored(bidId);

    const res = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    expect(res.body.sheets.length).toBe(2);
    const page1 = res.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.sheet_no).toBe('E1.1');
    expect(page1.title).toBe('LIGHTING PLAN');
    expect(page1.discipline).toBe('E');
    expect(page1.has_text_layer).toBe(true);
    expect(page1.scale_label).toBe(`1/8" = 1'-0"`);
    // 6, not 10, decimals — est_sheets.ft_per_pt is NUMERIC(14,8) in the DB.
    expect(page1.ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 6);
    const page2 = res.body.sheets.find((s: { page_index: number }) => s.page_index === 1);
    expect(page2.has_text_layer).toBe(false);
  });

  it('a second call does not re-fetch Drive/re-parse — reads the cached est_sheets rows', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDriveStored(bidId, `drive-cache-${Date.now()}`);
    getFileMedia.mockResolvedValueOnce({
      stream: Readable.from(buildSampleSheetPdf()),
      mimeType: 'application/pdf',
      name: 'plans.pdf',
    });

    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    expect(getFileMedia).toHaveBeenCalledTimes(1);

    const second = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    expect(second.body.sheets.length).toBe(2);
    expect(getFileMedia).toHaveBeenCalledTimes(1); // still 1 — no re-fetch on the cached path

    // Sanity: the document really was fetched through the (mocked) Drive
    // path, not silently falling back to something else.
    expect(getFileMedia).toHaveBeenCalledWith(expect.stringContaining('drive-cache-'));
    void docId;
  });

  it('?refresh=1 rebuilds but PRESERVES a calibrated scale', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);

    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    // Estimator calibrates page 0 by hand — a deliberately different value
    // than the title-block guess, so we can tell the two apart.
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token)).send({
      ft_per_pt: 0.05, source: 'calibrated', label: 'Calibrated: 1" = 4\'',
    }).expect(200);

    const refreshed = await request(app).get(`/api/estimating/${bidId}/sheets?refresh=1`).set(auth(u.token)).expect(200);
    const page1 = refreshed.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.scale_source).toBe('calibrated');
    expect(page1.ft_per_pt).toBeCloseTo(0.05, 10);
    expect(page1.scale_label).toBe('Calibrated: 1" = 4\'');
    // Everything else still refreshed normally.
    expect(page1.sheet_no).toBe('E1.1');
  });
});

describe('PUT /api/estimating/:bidId/sheets/:documentId/:pageIndex/scale', () => {
  it('validates ft_per_pt and source', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);

    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token))
      .send({ ft_per_pt: -1, source: 'calibrated' }).expect(400);
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token))
      .send({ ft_per_pt: 0.01, source: 'guessed' }).expect(400);
  });

  it('404s a page that has not been indexed yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    // Never called GET /sheets, so est_sheets has no rows for this document yet.
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token))
      .send({ ft_per_pt: 0.01, source: 'calibrated' }).expect(404);
  });
});

describe('GET /api/estimating/:bidId/sheets/:documentId/file — authenticated PDF stream', () => {
  it('streams a DB-stored plan PDF with the right content-type, no caching headers that leak across users', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);

    const res = await request(app).get(`/api/estimating/${bidId}/sheets/${docId}/file`).set(auth(u.token)).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.isBuffer(res.body) || typeof res.text === 'string').toBeTruthy();
  });

  it('streams a Drive-stored plan PDF through the mocked Drive fetch', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDriveStored(bidId, `drive-file-${Date.now()}`);
    getFileMedia.mockResolvedValueOnce({
      stream: Readable.from(buildSampleSheetPdf()),
      mimeType: 'application/pdf',
      name: 'plans.pdf',
    });
    const res = await request(app).get(`/api/estimating/${bidId}/sheets/${docId}/file`).set(auth(u.token)).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(getFileMedia).toHaveBeenCalledTimes(1);
  });

  it('404s a documentId that belongs to a DIFFERENT bid, even though this bid is accessible (no cross-bid document access by id)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidA = await makeBid(app, u);
    const bidB = await makeBid(app, u);
    const docOnBidB = await makePlanDocDbStored(bidB);

    // Same user, owns BOTH bids — the guard is document<->bid linkage, not
    // just "does this user have access to some bid".
    await request(app).get(`/api/estimating/${bidA}/sheets/${docOnBidB}/file`).set(auth(u.token)).expect(404);
  });

  it('403s a salesperson who does not own the bid, before ever touching the document', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('salesperson');
    const bidId = await makeBid(app, owner);
    const docId = await makePlanDocDbStored(bidId);
    const intruder = await makeUser('salesperson');

    await request(app).get(`/api/estimating/${bidId}/sheets/${docId}/file`).set(auth(intruder.token)).expect(403);
    expect(getFileMedia).not.toHaveBeenCalled();
  });

  it('404s an unknown documentId under a real, accessible bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await request(app).get(`/api/estimating/${bidId}/sheets/00000000-0000-0000-0000-000000000000/file`).set(auth(u.token)).expect(404);
  });
});

describe('GET /api/estimating/:bidId/sheets — bid access', () => {
  it('404s a bid that does not exist', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    await request(app).get('/api/estimating/00000000-0000-0000-0000-000000000000/sheets').set(auth(u.token)).expect(404);
  });

  it('403s a salesperson reading another rep\'s bid\'s sheets', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('salesperson');
    const bidId = await makeBid(app, owner);
    const intruder = await makeUser('salesperson');
    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(intruder.token)).expect(403);
  });
});
