// Minimal, dependency-free multi-page PDF builder for tests that need a real PDF
// pdftotext/pdftoppm will accept (Phase 2 Task 1/2 — text-extraction and
// page-classification tests need actual poppler output, not a fake "%PDF-1.4"
// buffer). Object offsets are computed programmatically so the xref table is
// always correct regardless of how many/how long the pages are.
//
// Each entry in `pageTexts` becomes the content of one page, word-wrapped into
// fixed-width lines and stacked with a T* leading operator. (An early version
// rendered the whole string as one long Tj — but poppler's text extraction only
// picks up glyphs positioned within the page's MediaBox, so anything past the
// right edge of a normal-sized page was silently clipped. Wrapping into lines on
// a generously sized page avoids that trap and lets a page hold 10,000+ chars.)
//
// ASCII only: the content stream is written as a latin1 buffer with no font
// encoding declared, so non-ASCII characters (em dashes, curly quotes, etc.)
// corrupt the string literal and truncate extraction.
const LINE_CHARS = 250;
const LEADING = 9;
const PAGE_WIDTH = 2200;
const PAGE_HEIGHT = 1000;

function wrapLines(text: string): string[] {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const lines: string[] = [];
  for (let i = 0; i < escaped.length; i += LINE_CHARS) lines.push(escaped.slice(i, i + LINE_CHARS));
  return lines.length ? lines : [''];
}

export function buildTestPdf(pageTexts: string[]): Buffer {
  const n = pageTexts.length;
  if (n === 0) throw new Error('buildTestPdf requires at least one page');

  // obj 1 = catalog, obj 2 = pages, objs 3..(2+n) = page objects,
  // objs (3+n)..(2+2n) = content streams, obj (3+2n) = font.
  const pageObjNums = Array.from({ length: n }, (_, i) => 3 + i);
  const contentObjNums = Array.from({ length: n }, (_, i) => 3 + n + i);
  const fontObjNum = 3 + 2 * n;

  const objects: Record<number, string | { stream: string }> = {};
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map(k => `${k} 0 R`).join(' ')}] /Count ${n} >>`;
  for (let i = 0; i < n; i++) {
    objects[pageObjNums[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjNums[i]} 0 R ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`;
  }
  for (let i = 0; i < n; i++) {
    const lines = wrapLines(pageTexts[i]);
    const body = lines.map(l => `(${l}) Tj T*`).join('\n');
    const stream = `BT /F1 8 Tf ${LEADING} TL 40 ${PAGE_HEIGHT - 60} Td\n${body}\nET`;
    objects[contentObjNums[i]] = { stream };
  }
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  const totalObjs = fontObjNum;
  let out = '%PDF-1.4\n';
  const offsets: number[] = new Array(totalObjs + 1).fill(0);
  for (let num = 1; num <= totalObjs; num++) {
    offsets[num] = Buffer.byteLength(out, 'latin1');
    const val = objects[num];
    if (typeof val === 'string') {
      out += `${num} 0 obj\n${val}\nendobj\n`;
    } else {
      const len = Buffer.byteLength(val.stream, 'latin1');
      out += `${num} 0 obj\n<< /Length ${len} >>\nstream\n${val.stream}\nendstream\nendobj\n`;
    }
  }
  const xrefStart = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${totalObjs + 1}\n`;
  out += `0000000000 65535 f \n`;
  for (let num = 1; num <= totalObjs; num++) {
    out += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
