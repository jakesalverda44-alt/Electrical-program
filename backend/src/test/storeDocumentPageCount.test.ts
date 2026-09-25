// Bid Overview plans upload + job profile / migration 140 — storeDocument()
// now records a PDF's page count (best effort) so the Documents step's
// read-only plan list can show it without a second parse.
import { describe, it, expect, beforeAll } from 'vitest';
import { dbAvailable } from './harness';
import { storeDocument } from '../utils/storeDocument';
import { buildTestPdf } from './fixtures/buildTestPdf';

function multerFile(originalname: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file', originalname, encoding: '7bit', mimetype: 'application/pdf',
    buffer, size: buffer.length, stream: undefined, destination: '', filename: originalname, path: '',
  } as unknown as Express.Multer.File;
}

describe('storeDocument — page_count', () => {
  let skip = false;
  beforeAll(async () => { skip = !(await dbAvailable()); });

  it('records the real page count of an uploaded multi-page PDF', async () => {
    if (skip) return;
    const buf = buildTestPdf(['cover sheet text', 'sheet two', 'sheet three']);
    const doc = await storeDocument({
      file: multerFile('three-pages.pdf', buf),
      linkedId: null, linkedName: null, div: 'elec', category: 'plans', uploadedBy: 'Test User',
    });
    expect(doc.page_count).toBe(3);
  });

  it('leaves page_count null for a non-PDF file', async () => {
    if (skip) return;
    const file = {
      fieldname: 'file', originalname: 'notes.txt', encoding: '7bit', mimetype: 'text/plain',
      buffer: Buffer.from('hello'), size: 5, stream: undefined, destination: '', filename: 'notes.txt', path: '',
    } as unknown as Express.Multer.File;
    const doc = await storeDocument({ file, linkedId: null, linkedName: null, div: 'elec', category: 'other', uploadedBy: 'Test User' });
    expect(doc.page_count).toBeNull();
  });

  it('does not fail the upload for a corrupt/unreadable "PDF"', async () => {
    if (skip) return;
    const buf = Buffer.from('%PDF-1.4 not actually a real pdf body');
    const doc = await storeDocument({
      file: multerFile('corrupt.pdf', buf),
      linkedId: null, linkedName: null, div: 'elec', category: 'plans', uploadedBy: 'Test User',
    });
    expect(doc.page_count).toBeNull();
    expect(doc.id).toBeTruthy();
  });
});
