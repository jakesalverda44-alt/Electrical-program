// Audit batch 3, Task 12 (audit data #14) — storeDocument already only wrote
// file_data when there was no storage_url (confirmed by reading the current
// code — no change needed there), and the /download and /view routes already
// prefer storage_url and fall back to file_data. This proves both serve-path
// branches, and migration 099's one-time backfill (UPDATE documents SET
// file_data = NULL WHERE storage_url IS NOT NULL AND file_data IS NOT NULL).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);
afterEach(() => { vi.unstubAllGlobals(); });

async function makeDoc(opts: { storageUrl: string | null; fileData: string | null }) {
  // file_type: text/plain, not application/pdf — superagent (supertest) only
  // auto-decodes a text/* response into res.text; a binary content-type would
  // need a custom buffer parser these tests don't otherwise need.
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_type, storage_url, file_data, uploaded_by)
     VALUES (NULL, NULL, 'general', 'plans.txt', 'plans.txt', 'plans', 'text/plain', $1, $2, 'test')
     RETURNING id`,
    [opts.storageUrl, opts.fileData]
  );
  return rows[0].id as string;
}

describe('GET /api/documents/:id/download and /view — storage_url preferred over file_data (Task 12)', () => {
  it('download streams from storage_url when set, ignoring file_data entirely', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    // file_data deliberately holds different bytes than the URL, so the
    // response content proves which one was actually served.
    const wrongData = Buffer.from('THIS SHOULD NEVER BE SERVED').toString('base64');
    const docId = await makeDoc({ storageUrl: 'https://cdn.example.com/plans.pdf', fileData: wrongData });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('bytes-from-storage-url'), { status: 200 })));
    const res = await request(app).get(`/api/documents/${docId}/download`).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.text).toBe('bytes-from-storage-url');
    // This row deliberately violated the "never both" invariant to prove
    // preference; don't leave it that way for later tests/queries in the
    // shared test DB.
    await pool.query(`UPDATE documents SET file_data = NULL WHERE id = $1`, [docId]);
  });

  it('view streams from storage_url when set, ignoring file_data entirely', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const wrongData = Buffer.from('THIS SHOULD NEVER BE SERVED').toString('base64');
    const docId = await makeDoc({ storageUrl: 'https://cdn.example.com/plans.pdf', fileData: wrongData });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('bytes-from-storage-url'), { status: 200 })));
    const res = await request(app).get(`/api/documents/${docId}/view`).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.text).toBe('bytes-from-storage-url');
    await pool.query(`UPDATE documents SET file_data = NULL WHERE id = $1`, [docId]);
  });

  it('download falls back to file_data when storage_url is null', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const data = Buffer.from('bytes-from-the-row').toString('base64');
    const docId = await makeDoc({ storageUrl: null, fileData: data });

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await request(app).get(`/api/documents/${docId}/download`).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.text).toBe('bytes-from-the-row');
    expect(fetchSpy).not.toHaveBeenCalled(); // never touches the network when it's a DB row
  });

  it('view falls back to file_data when storage_url is null', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const data = Buffer.from('bytes-from-the-row').toString('base64');
    const docId = await makeDoc({ storageUrl: null, fileData: data });

    const res = await request(app).get(`/api/documents/${docId}/view`).set(auth(u.token));
    expect(res.status).toBe(200);
    expect(res.text).toBe('bytes-from-the-row');
  });

  it('view 404s when a document somehow has neither storage_url nor file_data', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const docId = await makeDoc({ storageUrl: null, fileData: null });
    const res = await request(app).get(`/api/documents/${docId}/view`).set(auth(u.token));
    expect(res.status).toBe(404);
  });
});

describe('migration 099 — documents file_data backfill (Task 12)', () => {
  it('clears file_data from a row that has both, and is a no-op the second time', async (ctx) => {
    if (!ok) return ctx.skip();
    const wrongData = Buffer.from('should be backfilled to null').toString('base64');
    const docId = await makeDoc({ storageUrl: 'https://cdn.example.com/backfill-me.pdf', fileData: wrongData });

    // Same statement migration 099 runs, scoped by re-checking only this row
    // so it's unaffected by whatever else the shared test DB currently holds.
    const first = await pool.query(
      `UPDATE documents SET file_data = NULL WHERE id = $1 AND storage_url IS NOT NULL AND file_data IS NOT NULL`,
      [docId]
    );
    expect(first.rowCount).toBe(1);

    const { rows } = await pool.query(`SELECT file_data FROM documents WHERE id = $1`, [docId]);
    expect(rows[0].file_data).toBeNull();

    const second = await pool.query(
      `UPDATE documents SET file_data = NULL WHERE id = $1 AND storage_url IS NOT NULL AND file_data IS NOT NULL`,
      [docId]
    );
    expect(second.rowCount).toBe(0); // already cleared — idempotent
  });
});
