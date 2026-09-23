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
      expect(info.suggested_label).toBe(`1/8" = 1'-0"`);
      expect(info.suggested_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 10);
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
      expect(info.suggested_label).toBeNull();
      expect(info.suggested_ft_per_pt).toBeNull();
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

// Fix round 1 / B7 — the indexer's parsed scale is ALWAYS a suggestion
// (suggested_ft_per_pt/suggested_label), never auto-applied; a page with
// more than one DISTINCT scale value is flagged ambiguous and offers NO
// suggestion at all — never a guess at which one is right.
describe('extractPageInfo — scale suggestion vs. ambiguity (B7)', () => {
  it('a single scale cue in the title-block strip is offered as the suggestion, not ambiguous', async () => {
    const buf = buildSheetPdf([
      { page: 1, x: 650, y: 550, text: 'E1.1' },
      { page: 1, x: 650, y: 500, text: `SCALE: 1/8" = 1'-0"` },
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.scale_ambiguous).toBe(false);
      expect(info.suggested_label).toBe(`1/8" = 1'-0"`);
      expect(info.suggested_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 10);
    } finally {
      await doc.destroy();
    }
  });

  it('TWO DISTINCT scale values anywhere on the page (an enlarged-detail callout alongside the main plan) flags scale_ambiguous and offers NO suggestion', async () => {
    const buf = buildSheetPdf([
      { page: 1, x: 650, y: 550, text: 'E1.1' },
      { page: 1, x: 650, y: 500, text: `SCALE: 1/8" = 1'-0"` }, // the main plan's real scale, in the strip
      { page: 1, x: 100, y: 300, text: `ENLARGED ELECTRICAL ROOM PLAN — SCALE: 1/4" = 1'-0"` }, // a detail callout elsewhere
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.scale_ambiguous).toBe(true);
      expect(info.suggested_label).toBeNull();
      expect(info.suggested_ft_per_pt).toBeNull();
    } finally {
      await doc.destroy();
    }
  });

  it('the SAME scale value appearing twice (worded identically, e.g. a repeated note) is NOT ambiguous', async () => {
    const buf = buildSheetPdf([
      { page: 1, x: 650, y: 550, text: 'E1.1' },
      { page: 1, x: 650, y: 500, text: `SCALE: 1/8" = 1'-0"` },
      { page: 1, x: 100, y: 300, text: `SCALE: 1/8" = 1'-0"` }, // identical value, elsewhere
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.scale_ambiguous).toBe(false);
      expect(info.suggested_ft_per_pt).toBeCloseTo(1 / (0.125 * 72), 10);
    } finally {
      await doc.destroy();
    }
  });

  it('prefers the title-block strip\'s OWN scale cue over one elsewhere on the page, when the strip has one at all', async () => {
    // Two DIFFERENT-looking labels that parse to the SAME real scale (a
    // ratio vs. an architectural fraction) — not ambiguous (same ftPerPt),
    // but the STRIP's own phrasing (the authoritative one) is what should
    // be offered, not whichever text happens to come first in scan order.
    const buf = buildSheetPdf([
      { page: 1, x: 100, y: 300, text: 'SCALE: 1:96' }, // same real scale as 1/8"=1'-0" (96 = 12*8), off-strip, appears FIRST
      { page: 1, x: 650, y: 550, text: 'E1.1' },
      { page: 1, x: 650, y: 500, text: `SCALE: 1/8" = 1'-0"` }, // the strip's own phrasing
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.scale_ambiguous).toBe(false);
      expect(info.suggested_label).toBe(`1/8" = 1'-0"`); // the strip's own label text, not "1:96"
    } finally {
      await doc.destroy();
    }
  });

  it('a sheet with no SCALE cue at all offers no suggestion and is not ambiguous', async () => {
    const buf = buildSheetPdf([
      { page: 1, x: 650, y: 550, text: 'E1.1' },
      { page: 1, x: 650, y: 520, text: 'LIGHTING PLAN' },
    ], { width: 800, height: 600 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.scale_ambiguous).toBe(false);
      expect(info.suggested_label).toBeNull();
      expect(info.suggested_ft_per_pt).toBeNull();
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

// Fix round 1 / S1 — the title-block strip used to compare a text item's
// RAW, unrotated, origin-absolute x-coordinate against a boundary computed
// as if the page started at (0,0) and was never rotated. Neither the
// origin nor the rotation tests above actually exercised this: the
// rotation test's own item sat at a raw x that happened to still read as
// "in the strip" under the OLD buggy math too, so it never caught the
// bug. These do — each picks coordinates where the OLD math and the
// correct, origin-and-rotation-aware math actively DISAGREE.
describe('extractPageInfo — origin- and rotation-aware title-block strip (S1)', () => {
  it('reports the page\'s own MediaBox origin', async () => {
    const buf = buildSheetPdf(
      [{ page: 1, x: 650, y: 550, text: 'E1.1' }],
      { width: 612, height: 792, originX: 100, originY: 200 }
    );
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.origin_x_pt).toBe(100);
      expect(info.origin_y_pt).toBe(200);
    } finally {
      await doc.destroy();
    }
  });

  it('a non-zero origin (S1\'s own worked example): a decoy the OLD raw-x check would have wrongly matched is correctly excluded, and the real title block is found', async () => {
    // MediaBox [100 200 712 992] — width 612, height 792, origin (100, 200).
    // Old (buggy) check: raw x >= 0.75*612=459. Decoy at absolute x=500
    // passes THAT (500 >= 459) even though it's really left of the strip
    // boundary once the origin is accounted for: the page's own right-25%
    // boundary sits at absolute x = 100 + 0.75*612 = 559, and 500 < 559.
    const buf = buildSheetPdf([
      { page: 1, x: 500, y: 300, text: 'A9.9' }, // decoy — old check wrongly included it
      { page: 1, x: 650, y: 550, text: 'E1.1' }, // genuinely in the strip either way
      { page: 1, x: 650, y: 500, text: 'REAL TITLE' },
    ], { width: 612, height: 792, originX: 100, originY: 200 });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.sheet_no).toBe('E1.1'); // NOT the decoy 'A9.9'
      expect(info.title).toBe('REAL TITLE');
    } finally {
      await doc.destroy();
    }
  });

  it('a 90-degree rotation (S1\'s own worked example, zero origin): the strip is the right side of the DISPLAYED page, not the raw content-stream x-axis', async () => {
    // width 792, height 612, rotated 90. Displayed (swapped) width = 612,
    // so the right-25% boundary in DISPLAYED x is 0.75*612=459, which
    // (rotation-90's own transform) corresponds to raw y >= 459 — raw x
    // is irrelevant to the rotated strip position at all.
    const buf = buildSheetPdf([
      // Old (buggy) check: raw x >= 0.75*792=594, ignoring rotation
      // entirely. Decoy at raw x=650 passes THAT (wrongly, since rotation
      // moves it out of the real displayed strip: rotated screenX = raw
      // y = 50, well under the displayed boundary of 459) — the fixed
      // check correctly excludes it.
      { page: 1, x: 650, y: 50, text: 'A9.9' },
      // The REAL sheet number — old check wrongly EXCLUDED this (raw
      // x=100 < 594); correctly INCLUDED once rotation is applied
      // (rotated screenX = raw y = 550 >= 459).
      { page: 1, x: 100, y: 550, text: 'E3.2' },
      { page: 1, x: 100, y: 500, text: 'REAL TITLE 90' },
    ], { width: 792, height: 612, rotations: { 1: 90 } });
    const doc = await openPdfDocument(buf);
    try {
      const info = await extractPageInfo(doc, 0);
      expect(info.sheet_no).toBe('E3.2');
      expect(info.title).toBe('REAL TITLE 90');
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
