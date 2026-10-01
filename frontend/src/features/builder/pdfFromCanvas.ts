import type { jsPDF as JsPDF } from 'jspdf';

/**
 * Turn one tall html2canvas render of a proposal into a multi-page letter PDF.
 *
 * Each page gets only its own slice of the render, JPEG-encoded. The previous
 * approach embedded the whole document as one lossless PNG on every page and
 * shifted it, so a 5-page proposal came out ~33 MB and email providers
 * (iCloud's limit is 20 MB) rejected it. Sliced JPEG pages are ~1-2 MB total.
 */
export function pdfFromCanvas(canvas: HTMLCanvasElement, PDF: typeof JsPDF, quality = 0.85): JsPDF {
  const pdf = new PDF({ unit: 'pt', format: 'letter', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // Canvas pixels that fill one PDF page at full width.
  const slicePx = Math.floor(canvas.width * (pageH / pageW));
  const pages = Math.max(1, Math.ceil(canvas.height / slicePx));

  for (let i = 0; i < pages; i++) {
    const y = i * slicePx;
    const h = Math.min(slicePx, canvas.height - y);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d');
    if (!ctx) continue;
    // JPEG has no alpha; paint white first so transparent areas don't turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (i > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', quality), 'JPEG', 0, 0, pageW, h * (pageW / canvas.width));
  }
  return pdf;
}
