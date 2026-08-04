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

/** Rasterize `el` and return the finished PDF as a Blob. */
export async function buildContractPdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgH = canvas.height * (pageW / canvas.width);
  const imgData = canvas.toDataURL('image/png');

  // One tall image sliced across pages by shifting it up a page-height at a time.
  //
  // Every page draws the SAME bitmap, just offset. Passing a stable alias makes jsPDF
  // store those bytes once and reference them from each page instead of embedding a
  // fresh copy per page — without it a 9-page contract carried nine copies of a
  // full-resolution PNG and weighed ~34MB, which is a brutal upload from a phone on
  // cell data and the most likely reason signed contracts were silently never archived.
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
