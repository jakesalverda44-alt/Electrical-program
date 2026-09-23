// Estimating Phase B, Task 2 — confirms the indirect-dynamic-import
// workaround (see pdfjsLoader.ts's top comment) actually loads pdfjs-dist's
// ESM-only legacy Node build under vitest's own transform, not just under
// plain node running tsc's compiled output.
import { describe, it, expect } from 'vitest';
import { openPdfDocument } from './pdfjsLoader';
import { buildSampleSheetPdf } from '../test/fixtures/estimating/buildSheetPdf';

describe('pdfjsLoader — openPdfDocument', () => {
  it('opens a real PDF buffer and reports the right page count/geometry', async () => {
    const buf = buildSampleSheetPdf();
    const doc = await openPdfDocument(buf);
    try {
      expect(doc.numPages).toBe(2);
      const page1 = await doc.getPage(1);
      expect(page1.view).toEqual([0, 0, 792, 612]);
      expect(page1.rotate).toBe(0);
      const tc = await page1.getTextContent();
      const strs = tc.items.map(i => i.str.trim()).filter(Boolean);
      expect(strs).toContain('E1.1');
      expect(strs).toContain('LIGHTING PLAN');
    } finally {
      await doc.destroy();
    }
  });

  it('reuses the cached module on a second call (no re-import)', async () => {
    const buf = buildSampleSheetPdf();
    const doc1 = await openPdfDocument(buf);
    await doc1.destroy();
    const doc2 = await openPdfDocument(buf);
    try {
      expect(doc2.numPages).toBe(2);
    } finally {
      await doc2.destroy();
    }
  });
});
