// Job profile fix round — S3 (a document id is only read for the bid it
// belongs to) and S6 (a .zip filed as a plan document is unpacked into its
// plan files exactly like the old raw zip upload). DB-backed, no AI calls.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { buildTestPdf } from './fixtures/buildTestPdf';
import { gatherAnalysisInputs } from '../routes/preconstruction';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function newBid(token: string): Promise<string> {
  const { app } = await import('../index');
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `ScopeZip ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  return res.body.id as string;
}

async function addDoc(bidId: string, name: string, fileType: string, buf: Buffer): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by)
     VALUES ($1, $2, 'plans', $3, $4, 'test') RETURNING id`, [bidId, name, fileType, buf.toString('base64')]);
  return rows[0].id as string;
}

function zipOf(entries: Array<[string, Buffer]>): Buffer {
  const z = new AdmZip();
  for (const [n, b] of entries) z.addFile(n, b);
  return z.toBuffer();
}

describe('gatherAnalysisInputs — S3 bid scoping', () => {
  it("never reads another bid's document; it is reported as other_bid", async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bidA = await newBid(u.token);
    const bidB = await newBid(u.token);
    const docA = await addDoc(bidA, 'a-plans.pdf', 'application/pdf', buildTestPdf(['A set']));
    const { files, excluded } = await gatherAnalysisInputs(bidB, [], [docA]);
    expect(files).toHaveLength(0);
    expect(excluded).toEqual([expect.objectContaining({ documentId: docA, reason: 'other_bid' })]);
    const own = await gatherAnalysisInputs(bidA, [], [docA]);
    expect(own.files).toHaveLength(1);
  });
});

describe('gatherAnalysisInputs — S6 zip plan documents', () => {
  it('unpacks a stored .zip into the same plan files a raw zip upload gives, each keeping the zip document id', async () => {
    if (!ok) return;
    const u = await makeUser('estimator');
    const bid = await newBid(u.token);
    const e1 = buildTestPdf(['E-1 POWER PLAN']);
    const a0 = buildTestPdf(['A-0 COVER SHEET']);
    const zip = zipOf([['set/E-1.pdf', e1], ['set/A-0.pdf', a0], ['set/readme.txt', Buffer.from('not a plan')]]);
    const zipDoc = await addDoc(bid, 'Plans.zip', 'application/zip', zip);

    const fromDoc = await gatherAnalysisInputs(bid, [], [zipDoc]);
    const raw = {
      fieldname: 'files', originalname: 'Plans.zip', encoding: '7bit', mimetype: 'application/zip',
      buffer: zip, size: zip.length, stream: undefined, destination: '', filename: 'Plans.zip', path: '',
    } as unknown as Express.Multer.File;
    const fromUpload = await gatherAnalysisInputs(bid, [raw], []);

    const shape = (fs: Express.Multer.File[]) => fs.map(f => ({ name: f.originalname, type: f.mimetype, bytes: f.buffer.toString('base64') }))
      .sort((x, y) => x.name.localeCompare(y.name));
    expect(shape(fromDoc.files)).toEqual(shape(fromUpload.files));
    expect(fromDoc.files.map(f => f.originalname).sort()).toEqual(['A-0.pdf', 'E-1.pdf']);
    for (const f of fromDoc.files) expect((f as unknown as { documentId?: string }).documentId).toBe(zipDoc);
  });
});
