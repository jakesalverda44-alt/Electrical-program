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

/** Fix round 1 / B9 — GET /sheets no longer indexes synchronously; it
 *  kicks off (fire-and-forget) background jobs and returns immediately
 *  with whatever's already done. Tests that need the FULLY-indexed result
 *  (the first GET for a bid, or a `?refresh=1` call) poll this same route
 *  exactly like the real client (PlansWorkspace.tsx) will, until every
 *  document's status is terminal ('done' or 'failed'). A later GET for a
 *  bid whose documents are already 'done' returns on the very first
 *  request (nothing left to claim), so callers can use this helper
 *  everywhere without worrying about which call is "the first one". */
async function pollSheetsUntilIndexed(
  app: import('express').Express, bidId: string, token: string, opts: { refresh?: boolean } = {}
) {
  // `?refresh=1` (the "Refresh sheets" button) is a single explicit
  // action, same as a real client would send it — only the FIRST request
  // carries it. Every poll after that is a plain GET, exactly like
  // PlansWorkspace.tsx's own polling loop. Sending refresh=1 on EVERY
  // attempt would re-reset an already-'done' document back to 'pending'
  // the instant this loop observes it, forever chasing a moving target.
  let res = await request(app).get(`/api/estimating/${bidId}/sheets${opts.refresh ? '?refresh=1' : ''}`).set(auth(token)).expect(200);
  for (let attempt = 0; attempt < 100; attempt++) {
    const statuses = Object.values(res.body.statuses ?? {});
    if (statuses.every(s => s === 'done' || s === 'failed')) return res;
    await new Promise(r => setTimeout(r, 20));
    res = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(token)).expect(200);
  }
  throw new Error('pollSheetsUntilIndexed: sheets never finished indexing within the test polling budget');
}

describe('GET /api/estimating/:bidId/sheets — build on first call, cache after', () => {
  it('builds est_sheets from a DB-stored plan PDF and returns both pages', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await makePlanDocDbStored(bidId);

    const res = await pollSheetsUntilIndexed(app, bidId, u.token);
    expect(res.body.sheets.length).toBe(2);
    const page1 = res.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.sheet_no).toBe('E1.1');
    expect(page1.title).toBe('LIGHTING PLAN');
    expect(page1.discipline).toBe('E');
    expect(page1.has_text_layer).toBe(true);
    // Fix round 1 / B7 — the indexer's parse is a SUGGESTION only; it
    // never auto-applies to ft_per_pt/scale_label anymore (those stay
    // null until an explicit confirm/calibration — see setSheetScale).
    expect(page1.suggested_label).toBe(`1/8" = 1'-0"`);
    // 6, not 10, decimals — est_sheets.suggested_ft_per_pt is NUMERIC(14,8) in the DB.
    expect(page1.suggested_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 6);
    expect(page1.ft_per_pt).toBeNull();
    expect(page1.scale_label).toBeNull();
    expect(page1.scale_source).toBeNull();
    expect(page1.scale_ambiguous).toBe(false);
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

    await pollSheetsUntilIndexed(app, bidId, u.token);
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

    await pollSheetsUntilIndexed(app, bidId, u.token);
    // Estimator calibrates page 0 by hand — a deliberately different value
    // than the title-block guess, so we can tell the two apart.
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token)).send({
      ft_per_pt: 0.05, source: 'calibrated', label: 'Calibrated: 1" = 4\'',
    }).expect(200);

    const refreshed = await pollSheetsUntilIndexed(app, bidId, u.token, { refresh: true });
    const page1 = refreshed.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.scale_source).toBe('calibrated');
    expect(page1.ft_per_pt).toBeCloseTo(0.05, 10);
    expect(page1.scale_label).toBe('Calibrated: 1" = 4\'');
    // Everything else still refreshed normally.
    expect(page1.sheet_no).toBe('E1.1');
  });
});

// Fix round 1 / B9 — indexing is now a background job with a per-document
// status GET /sheets returns alongside whatever's already indexed, so the
// client can poll instead of the request itself blocking on a Drive
// download + full pdfjs parse (which used to blow well past the frontend's
// 30s axios timeout on a real 100-150MB plan set).
describe('GET /api/estimating/:bidId/sheets — background indexing status (B9)', () => {
  it('an immediate (unpolled) call returns a status for the document even before indexing finishes, and it reaches "done"', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);

    const first = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    // Whatever it is right now, it must be ONE of the real states — never
    // absent (every plan PDF document gets a status row the moment it's
    // seen) and never something outside the documented enum.
    expect(['pending', 'indexing', 'done', 'failed']).toContain(first.body.statuses[docId]);

    const finished = await pollSheetsUntilIndexed(app, bidId, u.token);
    expect(finished.body.statuses[docId]).toBe('done');
    expect(finished.body.sheets.length).toBe(2);
  });

  it('a document that fails to index (e.g. a Drive error) is marked "failed" and never crashes the request — the status is STICKY (a plain poll never silently retries it) until an explicit Refresh, which retries it successfully', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDriveStored(bidId, `drive-fail-${Date.now()}`);
    getFileMedia.mockRejectedValueOnce(new Error('simulated Drive outage'));

    const failed = await pollSheetsUntilIndexed(app, bidId, u.token);
    expect(failed.body.statuses[docId]).toBe('failed');
    expect(failed.body.sheets.length).toBe(0);

    // A plain poll (no refresh) leaves it 'failed' — never silently
    // re-attempted on its own; there is nothing left mocked to reject
    // again, so if this silently retried it would show up as 'done' here.
    const stillFailed = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    expect(stillFailed.body.statuses[docId]).toBe('failed');

    // "Refresh sheets" is the retry action — never a permanent dead end.
    getFileMedia.mockResolvedValueOnce({
      stream: Readable.from(buildSampleSheetPdf()),
      mimeType: 'application/pdf',
      name: 'plans.pdf',
    });
    const retried = await pollSheetsUntilIndexed(app, bidId, u.token, { refresh: true });
    expect(retried.body.statuses[docId]).toBe('done');
    expect(retried.body.sheets.length).toBe(2);
  });

  it('two independent documents index independently — one succeeding does not wait on, or get blocked by, a slower/failed one', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const okDocId = await makePlanDocDbStored(bidId);
    const failDocId = await makePlanDocDriveStored(bidId, `drive-fail2-${Date.now()}`);
    getFileMedia.mockRejectedValueOnce(new Error('simulated Drive outage'));

    const res = await pollSheetsUntilIndexed(app, bidId, u.token);
    expect(res.body.statuses[okDocId]).toBe('done');
    expect(res.body.statuses[failDocId]).toBe('failed');
    // Only the successfully-indexed document contributed sheet rows.
    expect(res.body.sheets.every((s: { document_id: string }) => s.document_id === okDocId)).toBe(true);
    expect(res.body.sheets.length).toBe(2);
  });

  it('a plan document uploaded AFTER the first GET /sheets call is picked up (registered as pending) on the next call, not lost', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    await makePlanDocDbStored(bidId);
    await pollSheetsUntilIndexed(app, bidId, u.token);

    const secondDocId = await makePlanDocDbStored(bidId);
    const after = await pollSheetsUntilIndexed(app, bidId, u.token);
    expect(after.body.statuses[secondDocId]).toBe('done');
    expect(after.body.sheets.length).toBe(4); // 2 pages x 2 documents
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

// Fix round 1 / B7 — the "Half-size set?" toggle, per document.
describe('PUT /api/estimating/:bidId/sheets/:documentId/half-size', () => {
  it('doubles both ft_per_pt and suggested_ft_per_pt for EVERY sheet of the document when turned on', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    const before = await pollSheetsUntilIndexed(app, bidId, u.token);
    const page1Before = before.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1Before.suggested_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 6);
    // Confirm the suggestion too, so both columns have a real value to double.
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/0/scale`).set(auth(u.token))
      .send({ ft_per_pt: page1Before.suggested_ft_per_pt, source: 'titleblock', label: page1Before.suggested_label }).expect(200);

    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token))
      .send({ half_size: true }).expect(200);

    const after = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    const page1After = after.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1After.half_size).toBe(true);
    expect(page1After.ft_per_pt).toBeCloseTo(page1Before.suggested_ft_per_pt * 2, 6);
    expect(page1After.suggested_ft_per_pt).toBeCloseTo(page1Before.suggested_ft_per_pt * 2, 6);
    // The OTHER page (no scale of its own — a blank/scanned page) stays null, not NaN or 0.
    const page2After = after.body.sheets.find((s: { page_index: number }) => s.page_index === 1);
    expect(page2After.half_size).toBe(true);
    expect(page2After.ft_per_pt).toBeNull();
    expect(page2After.suggested_ft_per_pt).toBeNull();
  });

  it('turning it back OFF halves the values again — round-trips to the original', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    const initial = await pollSheetsUntilIndexed(app, bidId, u.token);
    const originalSuggested = initial.body.sheets.find((s: { page_index: number }) => s.page_index === 0).suggested_ft_per_pt as number;

    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token)).send({ half_size: true }).expect(200);
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token)).send({ half_size: false }).expect(200);

    const after = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    const page1 = after.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.half_size).toBe(false);
    expect(page1.suggested_ft_per_pt).toBeCloseTo(originalSuggested, 6);
  });

  it('calling it twice with the SAME value is a no-op the second time (idempotent, never double-doubles)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    const initial = await pollSheetsUntilIndexed(app, bidId, u.token);
    const originalSuggested = initial.body.sheets.find((s: { page_index: number }) => s.page_index === 0).suggested_ft_per_pt as number;

    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token)).send({ half_size: true }).expect(200);
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token)).send({ half_size: true }).expect(200);

    const after = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    const page1 = after.body.sheets.find((s: { page_index: number }) => s.page_index === 0);
    expect(page1.suggested_ft_per_pt).toBeCloseTo(originalSuggested * 2, 6); // exactly 2x, not 4x
  });

  it('a re-index (?refresh=1) never resets half_size — only setHalfSize itself ever writes it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    await pollSheetsUntilIndexed(app, bidId, u.token);
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token)).send({ half_size: true }).expect(200);

    await pollSheetsUntilIndexed(app, bidId, u.token, { refresh: true });

    const after = await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    expect(after.body.sheets.find((s: { page_index: number }) => s.page_index === 0).half_size).toBe(true);
  });

  it('rejects a non-boolean half_size with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    await request(app).get(`/api/estimating/${bidId}/sheets`).set(auth(u.token)).expect(200);
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token))
      .send({ half_size: 'yes' }).expect(400);
  });

  it('404s a document with no indexed sheets yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);
    // Never indexed — no est_sheets rows for this document.
    await request(app).put(`/api/estimating/${bidId}/sheets/${docId}/half-size`).set(auth(u.token))
      .send({ half_size: true }).expect(404);
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

  // Fix round 1 / S4 (security) — R4's reproduced failure: a category:
  // 'other' text/html document, linked to the same bid, used to stream
  // straight through this route as a plain 200 text/html with no
  // Content-Disposition — routes/documents.ts's own lockdown (Security
  // #6) never applied to this route at all. loadPlanDocumentForBid now
  // filters to plans-category PDFs only, so a non-plans document 404s
  // exactly like a document that doesn't belong to this bid.
  it('404s a document linked to this bid that is NOT plans-category (was: streamed as text/html with no Content-Disposition)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { rows } = await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
       VALUES ($1, 'notes.html', 'other', 'text/html', $2, 'test') RETURNING id`,
      [bidId, Buffer.from('<script>alert(1)</script>').toString('base64')]
    );
    const otherDocId = rows[0].id as string;

    const res = await request(app).get(`/api/estimating/${bidId}/sheets/${otherDocId}/file`).set(auth(u.token));
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).not.toContain('text/html');
  });

  // Fix round 1 / S4 — a plans-category row whose file_type somehow isn't
  // application/pdf (a mislabeled upload, an old row) gets 415, never a
  // 200 with an attacker/upload-influenced Content-Type.
  it('415s a plans-category document whose file_type is not application/pdf', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const { rows } = await pool.query(
      `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
       VALUES ($1, 'plans.pdf', 'plans', 'text/html', $2, 'test') RETURNING id`,
      [bidId, Buffer.from('<script>alert(1)</script>').toString('base64')]
    );
    const docId = rows[0].id as string;

    const res = await request(app).get(`/api/estimating/${bidId}/sheets/${docId}/file`).set(auth(u.token));
    expect(res.status).toBe(415);
  });

  it('sends application/pdf, inline Content-Disposition with the filename, and nosniff for a real plan PDF', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBid(app, u);
    const docId = await makePlanDocDbStored(bidId);

    const res = await request(app).get(`/api/estimating/${bidId}/sheets/${docId}/file`).set(auth(u.token)).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-disposition']).toContain('plans.pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
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
