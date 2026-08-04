// Rasterizes an already-rendered contract element into a multi-page letter PDF.
//
// Two callers need the identical output: the public signing page (the customer's
// browser, right after they sign) and the gen card's Rebuild action (the rep's
// browser, when the customer-side attempt never produced a file). Keeping one
// implementation means a rebuilt archive is byte-for-byte the same document the
// customer would have uploaded, not a second rendering that drifts from it.
//
// html2canvas and jspdf are both heavy, so they load on demand rather than riding
// in the main bundle — neither path is on a hot route.

// The contract markup marks each of its own pages with data-doc-page (the cover plus
// every .page-break section). Capturing those one at a time is what keeps a PDF page
// break on a document page break.
const PAGE_SELECTOR = '[data-doc-page]';

type Html2Canvas = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;

async function loadDeps() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  return { html2canvas: html2canvas as unknown as Html2Canvas, jsPDF };
}

const CAPTURE_OPTS = { scale: 1.5, backgroundColor: '#ffffff', useCORS: true };

/** Rasterize `el` and return the finished PDF as a Blob. */
export async function buildContractPdf(el: HTMLElement): Promise<Blob> {
  const { html2canvas, jsPDF } = await loadDeps();

  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const pages = [...el.querySelectorAll<HTMLElement>(PAGE_SELECTOR)];

  // Preferred path: one capture per document page, so the PDF breaks exactly where
  // the contract breaks. The old approach captured the whole document as a single
  // tall bitmap and sliced it every 792pt, which cut straight through page headers
  // and mid-sentence — a signed contract came out looking mangled.
  if (pages.length) {
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], CAPTURE_OPTS);
      if (!canvas.width || !canvas.height) continue;

      // Fit to width, but never let an unusually tall page overflow its sheet —
      // fall back to fitting height so the whole page stays on one PDF page.
      const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * scale;
      const h = canvas.height * scale;

      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageW - w) / 2, 0, w, h, `doc-page-${i}`, 'FAST');
    }
    return pdf.output('blob');
  }

  // Fallback for any caller whose markup predates the page markers: the original
  // single-bitmap slice. Kept so this never renders nothing at all.
  const canvas = await html2canvas(el, CAPTURE_OPTS);
  const imgH = canvas.height * (pageW / canvas.width);
  const imgData = canvas.toDataURL('image/png');

  // Every slice draws the SAME bitmap, just offset. A stable alias makes jsPDF store
  // those bytes once instead of embedding a fresh copy per page — without it a 9-page
  // contract weighed ~34MB, a brutal upload from a phone on cell data.
  const ALIAS = 'contract-render';
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH, ALIAS, 'FAST');
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position = heightLeft - imgH;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH, ALIAS, 'FAST');
    heightLeft -= pageH;
  }

  return pdf.output('blob');
}

/** The archived filename, shared so a rebuild matches what the customer-side upload
 *  produces — the backend dedupes on a `Signed Proposal%` name prefix. */
export function signedContractFilename(customer: string): string {
  return `Signed Proposal - ${customer || 'Customer'}.pdf`;
}
