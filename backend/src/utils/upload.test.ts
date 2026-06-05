import { describe, it, expect } from 'vitest';
import { documentUpload, pdfUpload, drawingUpload, UnsupportedFileTypeError } from './upload';

// multer stores the configured fileFilter on the instance; exercise it directly.
type Filter = (req: unknown, file: { originalname: string }, cb: (err: Error | null, ok?: boolean) => void) => void;
const filterOf = (u: unknown) => (u as { fileFilter: Filter }).fileFilter;

function run(u: unknown, name: string): { ok: boolean; err: Error | null } {
  let ok = false; let err: Error | null = null;
  filterOf(u)({}, { originalname: name }, (e, accepted) => { err = e; ok = !!accepted; });
  return { ok, err };
}

describe('document upload filter', () => {
  it('accepts common document/image/plan types', () => {
    for (const n of ['plan.pdf', 'photo.JPG', 'contract.docx', 'budget.xlsx', 'data.csv', 'set.dwg', 'pkg.zip']) {
      expect(run(documentUpload, n).ok).toBe(true);
    }
  });
  it('rejects executables and unknown types with a 400 error', () => {
    const r = run(documentUpload, 'malware.exe');
    expect(r.ok).toBe(false);
    expect(r.err).toBeInstanceOf(UnsupportedFileTypeError);
    expect((r.err as unknown as { status: number }).status).toBe(400);
  });
});

describe('pdf upload filter', () => {
  it('accepts only PDFs', () => {
    expect(run(pdfUpload, 'signed.pdf').ok).toBe(true);
    expect(run(pdfUpload, 'image.png').ok).toBe(false);
  });
});

describe('drawing/takeoff upload filter', () => {
  it('accepts drawings, images and zip; rejects office docs', () => {
    expect(run(drawingUpload, 'E1.pdf').ok).toBe(true);
    expect(run(drawingUpload, 'plans.zip').ok).toBe(true);
    expect(run(drawingUpload, 'sheet.png').ok).toBe(true);
    expect(run(drawingUpload, 'notes.docx').ok).toBe(false);
  });
});
