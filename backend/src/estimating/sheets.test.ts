// Estimating Phase B, Task 2 — sheet index extraction against the fixture
// PDF (a small, hand-built, real vector PDF pdfjs-dist can actually parse —
// see backend/src/test/fixtures/estimating/buildSheetPdf.ts). Pure/no-DB:
// exercises extractPageInfo() directly.
import { describe, it, expect } from 'vitest';
import { extractPageInfo } from './sheets';
import { openPdfDocument } from './pdfjsLoader';
import { buildSampleSheetPdf, buildSheetPdf } from '../test/fixtures/estimating/buildSheetPdf';

describe('extractPageInfo — sample sheet fixture', () => {
  it('reads sheet_no/title/scale off the title-block strip and leaves the rest alone', async () => {
    const doc = await openPdfDocument(buildSampleSheetPdf());
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.width_pt).toBe(792);
      expect(info.height_pt).toBe(612);
      expect(info.rotation).toBe(0);
      expect(info.has_text_layer).toBe(true);
      expect(info.sheet_no).toBe('E1.1');
      expect(info.title).toBe('LIGHTING PLAN');
      expect(info.discipline).toBe('E');
      expect(info.kind).toBe('plan');
      expect(info.scale_label).toBe(`1/8" = 1'-0"`);
      expect(info.ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 10);
    } finally {
      await doc.destroy();
    }
  });

  it('reports no text layer / no scale for a blank (scanned) page', async () => {
    const doc = await openPdfDocument(buildSampleSheetPdf());
    try {
      const info = await extractPageInfo(doc, 1);
      expect(info.has_text_layer).toBe(false);
      expect(info.sheet_no).toBe('');
      expect(info.title).toBe('');
      expect(info.scale_label).toBeNull();
      expect(info.ft_per_pt).toBeNull();
      expect(info.kind).toBe('other'); // never guessed 'plan' with nothing to read
    } finally {
      await doc.destroy();
    }
  });
});

describe('extractPageInfo — title-block strip heuristic (right 25%, full height)', () => {
  it('ignores a same-looking sheet-no-shaped string sitting OUTSIDE the strip', async () => {
    // "A1.1" sits at x=50 on an 800pt-wide page (strip starts at 0.75*800=600) —
    // it must NOT be picked up as the sheet number.
    const buf = buildSheetPdf([
      { page: 1, x: 50, y: 300, text: 'A1.1' }, // outside the strip — a callout/tag, not the title block
      { page: 1, x: 650, y: 550, text: 'M2.0' }, // inside the strip — the real sheet number
      { page: 1, x: 650, y: 520, text: 'MECHANICAL PLAN' },
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.sheet_no).toBe('M2.0');
      expect(info.discipline).toBe('M');
      expect(info.title).toBe('MECHANICAL PLAN');
    } finally {
      await doc.destroy();
    }
  });
});

describe('extractPageInfo — rotation', () => {
  it('reports a rotated page\'s /Rotate value and its UNROTATED MediaBox dimensions', async () => {
    const buf = buildSheetPdf(
      [{ page: 1, x: 650, y: 550, text: 'E2.1' }],
      { width: 792, height: 612, rotations: { 1: 90 } }
    );
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.rotation).toBe(90);
      // pdf.js's page.view is always the raw, unrotated MediaBox — rotation
      // is applied only when a viewport is constructed from it (the
      // frontend viewer's job, Task 4/overlay.ts).
      expect(info.width_pt).toBe(792);
      expect(info.height_pt).toBe(612);
    } finally {
      await doc.destroy();
    }
  });

  it('normalizes a negative or >360 /Rotate value into 0-270', async () => {
    const buf = buildSheetPdf(
      [{ page: 1, x: 650, y: 550, text: 'E2.1' }],
      { width: 792, height: 612, rotations: { 1: -90 } }
    );
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.rotation).toBe(270);
    } finally {
      await doc.destroy();
    }
  });
});

describe('extractPageInfo — kind heuristics', () => {
  const cases: Array<[string, string]> = [
    ['PANEL SCHEDULE', 'schedule'],
    ['ELECTRICAL RISER DIAGRAM', 'riser'],
    ['COVER SHEET', 'cover'],
    ['TITLE SHEET', 'cover'],
    ['WIRING DETAIL', 'detail'],
    ['LIGHTING PLAN', 'plan'],
  ];
  for (const [title, expected] of cases) {
    it(`"${title}" -> kind "${expected}"`, async () => {
      const buf = buildSheetPdf([
        { page: 1, x: 650, y: 550, text: 'E1.1' },
        { page: 1, x: 650, y: 520, text: title },
      ]);
      const doc = await openPdfDocument(buf);
      try {
        const info = await extractPageInfo(doc, 0);
        expect(info.kind).toBe(expected);
      } finally {
        await doc.destroy();
      }
    });
  }
});
