// Post-review fixes B1 + B2 (Opus 5 adversarial review of fix/audit-batch1).
//
// B1 — GET /api/documents/drive-file/:fileId's "no documents row -> 403" guard
// lived inside `if (scope)`, so any non-restricted role (read_only, technician,
// owner, ...) could still proxy an arbitrary Drive file id through the service
// account. The guard now applies to every role.
//
// B2 — that same fix, taken alone, would 403 job-site photo thumbnails for
// salespeople: GET /gens/:id/photos and /bids/:id/photos list a Drive Photos
// subfolder directly, so those file ids never get a `documents` row. New
// owned-record routes (GET /gens/:id/photos/:fileId, /bids/:id/photos/:fileId)
// authorize by folder membership instead.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

const getFileParents = vi.fn();
const getFileMedia = vi.fn();
vi.mock('../services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/googleDrive')>();
  return {
    ...actual,
    getFileParents: (...args: unknown[]) => getFileParents(...(args as [string])),
    getFileMedia: (...args: unknown[]) => getFileMedia(...(args as [string])),
  };
});

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

afterEach(() => {
  getFileParents.mockReset();
  getFileMedia.mockReset();
});

describe('GET /api/documents/drive-file/:fileId — fails closed for every role (B1)', () => {
  it('403s a read_only user for an untracked file id', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('read_only');
    const res = await request(app)
      .get(`/api/documents/drive-file/not-tracked-${Date.now()}`)
      .set(auth(user.token));
    expect(res.status).toBe(403);
  });

  it('403s an owner/manager-equivalent role for an untracked file id', async (ctx) => {
    if (!ok) return ctx.skip();
    const user = await makeUser('owner');
    const res = await request(app)
      .get(`/api/documents/drive-file/not-tracked-${Date.now()}`)
      .set(auth(user.token));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/gens/:id/photos/:fileId — owned-record photo proxy (B2)', () => {
  async function createGenWithPhotosFolder(token: string, folderId: string): Promise<string> {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Photo Ownership Test ${Date.now()}` })
      .expect(200);
    await pool.query('UPDATE generator_proposals SET drive_photos_folder_id=$1 WHERE id=$2', [folderId, res.body.id]);
    return res.body.id as string;
  }

  it('200s for the owning salesperson when the file is in the gen\'s photos folder', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');
    const genId = await createGenWithPhotosFolder(rep.token, 'photos-folder-own');
    getFileParents.mockResolvedValueOnce(['photos-folder-own']);
    getFileMedia.mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('fake-image-bytes')),
      mimeType: 'image/jpeg',
      name: 'site.jpg',
    });
    const res = await request(app).get(`/api/gens/${genId}/photos/file-own`).set(auth(rep.token));
    expect(res.status).toBe(200);
    expect(getFileParents).toHaveBeenCalledWith('file-own');
  });

  it('403/404s a salesperson fetching a photo under a gen they do not own', async (ctx) => {
    if (!ok) return ctx.skip();
    const owner = await makeUser('salesperson');
    const genId = await createGenWithPhotosFolder(owner.token, 'photos-folder-other');
    const intruder = await makeUser('salesperson');
    const res = await request(app).get(`/api/gens/${genId}/photos/file-x`).set(auth(intruder.token));
    expect([403, 404]).toContain(res.status);
    // The ownership gate (loadOwnedGen) must reject before Drive is ever consulted.
    expect(getFileParents).not.toHaveBeenCalled();
  });

  it('403s when the file\'s parent is not this gen\'s photos folder', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep = await makeUser('salesperson');
    const genId = await createGenWithPhotosFolder(rep.token, 'photos-folder-real');
    getFileParents.mockResolvedValueOnce(['some-unrelated-folder']);
    const res = await request(app).get(`/api/gens/${genId}/photos/file-wrong-parent`).set(auth(rep.token));
    expect(res.status).toBe(403);
    expect(getFileMedia).not.toHaveBeenCalled();
  });
});
