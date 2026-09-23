// Estimating Phase B, Task 2 — a minimal, dependency-free PDF builder for
// sheets.ts's tests, distinct from ../buildTestPdf.ts (that one wraps a
// single long string into fixed-width lines at a fixed position; sheets.ts
// needs individual text runs placed at EXPLICIT (x, y) positions, so the
// right-25%-strip title-block heuristic (reused from ai/pageClassifier.ts's
// titleBlockCropRect) and the scale-label search have something realistic to
// find). Each page can also declare its own /Rotate and omit its content
// stream entirely (a "scanned", no-text-layer sheet).
//
// The font is declared with /Encoding /WinAnsiEncoding — WITHOUT it, a
// base-14 Helvetica falls back to StandardEncoding, whose apostrophe/quote
// glyphs are Unicode U+2019/U+201D ("quoteright"/"quotedblright"), not the
// plain ASCII characters a real CAD export's WinAnsi-encoded text would
// extract as. Confirmed empirically against pdfjs-dist before writing this:
// the same content stream without /Encoding /WinAnsiEncoding round-trips
// "1'-0\"" as "1’-0”" through getTextContent().
export interface SheetPdfTextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface SheetPdfOptions {
  width?: number;
  height?: number;
  /** page number (1-based) -> /Rotate value (0/90/180/270). */
  rotations?: Record<number, number>;
  /** Page numbers to include with NO content stream at all (has_text_layer
   *  must come back false) even if `items` lists no text for them either —
   *  lets a test declare a blank/scanned page explicitly rather than relying
   *  on "no items happened to be given for this page". */
  blankPages?: number[];
  /** Fix round 1 / S1 — a non-zero MediaBox origin, e.g. [100 200 712 992]
   *  (originX=100, originY=200, width=612, height=792). Real CAD-exported
   *  PDFs routinely have one; every fixture defaults to (0, 0), the origin
   *  every OTHER test in this file already implicitly assumes. `items`'
   *  x/y are still given in the same absolute PDF user-space coordinates a
   *  real /Tm content-stream operator uses — unaffected by MediaBox, same
   *  as a real PDF. */
  originX?: number;
  originY?: number;
}

function escapePdfString(s: string): string {
  return s.replace(/([()\\])/g, '\\$1');
}

export function buildSheetPdf(items: SheetPdfTextItem[], opts: SheetPdfOptions = {}): Buffer {
  const width = opts.width ?? 792;
  const height = opts.height ?? 612;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const pageNums = Array.from(new Set([...items.map(i => i.page), ...(opts.blankPages ?? [])])).sort((a, b) => a - b);
  if (pageNums.length === 0) throw new Error('buildSheetPdf requires at least one page (items or blankPages)');
  // Pages must be contiguous 1..N for this builder's simple object numbering.
  const n = Math.max(...pageNums);

  const pageObjNums = Array.from({ length: n }, (_, i) => 3 + i);
  const contentObjNums = Array.from({ length: n }, (_, i) => 3 + n + i);
  const fontObjNum = 3 + 2 * n;

  const objects: Record<number, string | { stream: string }> = {};
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map(k => `${k} 0 R`).join(' ')}] /Count ${n} >>`;

  for (let p = 1; p <= n; p++) {
    const rotate = opts.rotations?.[p] ?? 0;
    const pageItems = items.filter(it => it.page === p);
    const isBlank = pageItems.length === 0;
    const contentRef = isBlank ? '' : ` /Contents ${contentObjNums[p - 1]} 0 R`;
    objects[pageObjNums[p - 1]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [${originX} ${originY} ${originX + width} ${originY + height}] /Rotate ${rotate}${contentRef} ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`;
    if (!isBlank) {
      let body = 'BT /F1 10 Tf\n';
      for (const it of pageItems) {
        body += `1 0 0 1 ${it.x} ${it.y} Tm (${escapePdfString(it.text)}) Tj\n`;
      }
      body += 'ET';
      objects[contentObjNums[p - 1]] = { stream: body };
    }
  }
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  const totalObjs = fontObjNum;
  let out = '%PDF-1.4\n';
  const offsets: number[] = new Array(totalObjs + 1).fill(0);
  for (let num = 1; num <= totalObjs; num++) {
    offsets[num] = Buffer.byteLength(out, 'latin1');
    const val = objects[num];
    if (val === undefined) continue; // a blank page's content object number is simply unused
    if (typeof val === 'string') {
      out += `${num} 0 obj\n${val}\nendobj\n`;
    } else {
      const len = Buffer.byteLength(val.stream, 'latin1');
      out += `${num} 0 obj\n<< /Length ${len} >>\nstream\n${val.stream}\nendstream\nendobj\n`;
    }
  }
  const xrefStart = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= totalObjs; num++) {
    out += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

/** The plan's own fixture spec (Task 2): "a title block 'E1.1 LIGHTING
 *  PLAN', 'SCALE: 1/8\" = 1\'-0\"', and a few tag strings" — a single-page,
 *  792x612pt (letter, landscape) sheet with the title block text positioned
 *  in the right 25% strip (x >= 0.75*792 = 594) and a couple of device tag
 *  strings elsewhere on the sheet for tagSuggest.ts (Task 7) to eventually
 *  find. A second, blank page has no text layer at all (a "scanned" sheet).
 */
export function buildSampleSheetPdf(): Buffer {
  return buildSheetPdf(
    [
      { page: 1, x: 650, y: 560, text: 'E1.1' },
      { page: 1, x: 600, y: 540, text: 'LIGHTING PLAN' },
      { page: 1, x: 600, y: 510, text: `SCALE: 1/8" = 1'-0"` },
      { page: 1, x: 100, y: 300, text: 'A1' },
      { page: 1, x: 200, y: 300, text: 'A2' },
    ],
    { blankPages: [2] }
  );
}
