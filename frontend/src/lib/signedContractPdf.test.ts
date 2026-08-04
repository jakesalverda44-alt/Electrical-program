// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addImage = vi.fn();
const addPage = vi.fn();

vi.mock('html2canvas', () => ({
  default: vi.fn().mockResolvedValue({
    // ~4 letter pages tall at the width the PDF scales to.
    width: 800,
    height: 4000,
    toDataURL: () => 'data:image/png;base64,RENDER',
  }),
}));

vi.mock('jspdf', () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    addImage = addImage;
    addPage = addPage;
    output() { return new Blob(['pdf']); }
  },
}));

import { buildContractPdf, signedContractFilename } from './signedContractPdf';

beforeEach(() => { addImage.mockClear(); addPage.mockClear(); });

describe('buildContractPdf', () => {
  it('draws the same bitmap under ONE alias on every page', async () => {
    await buildContractPdf(document.createElement('div'));

    // Multi-page: the tall render is sliced, so addImage runs more than once.
    expect(addImage.mock.calls.length).toBeGreaterThan(1);
    expect(addPage.mock.calls.length).toBe(addImage.mock.calls.length - 1);

    // Every call must reuse one alias. Without it jsPDF embeds a fresh copy of the
    // full-resolution PNG per page — that is what made a 9-page contract ~34MB and
    // left signed jobs with no archived PDF when the upload died on cell data.
    const aliases = new Set(addImage.mock.calls.map(c => c[6]));
    expect(aliases.size).toBe(1);
    expect([...aliases][0]).toBeTruthy();

    // And the bytes handed over are identical each time, so the alias is honest.
    const datas = new Set(addImage.mock.calls.map(c => c[0]));
    expect(datas.size).toBe(1);
  });

  it('returns a Blob', async () => {
    const out = await buildContractPdf(document.createElement('div'));
    expect(out).toBeInstanceOf(Blob);
  });
});

describe('signedContractFilename', () => {
  it('matches the name the customer-side upload route writes, so the two are one artifact', () => {
    expect(signedContractFilename('Jane Homeowner')).toBe('Signed Proposal - Jane Homeowner.pdf');
  });

  it('falls back when the customer name is empty', () => {
    expect(signedContractFilename('')).toBe('Signed Proposal - Customer.pdf');
  });
});

// The contract markup marks its own pages. Honoring those is the difference between a
// clean PDF and one where a page header lands mid-sheet and a sentence is cut in half —
// which is what the fixed-height slicing below produced on a real signed contract.
describe('buildContractPdf — one PDF page per document page', () => {
  function docWithPages(n: number) {
    const root = document.createElement('div');
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.setAttribute('data-doc-page', '');
      root.appendChild(p);
    }
    return root;
  }

  it('captures each data-doc-page separately and never slices one across sheets', async () => {
    await buildContractPdf(docWithPages(9));

    // Nine document pages -> nine images, eight page breaks. No slicing loop.
    expect(addImage.mock.calls.length).toBe(9);
    expect(addPage.mock.calls.length).toBe(8);

    // Each page gets its own alias: they are genuinely different bitmaps, unlike the
    // fallback path where one bitmap is reused and MUST share an alias.
    const aliases = new Set(addImage.mock.calls.map(c => c[6]));
    expect(aliases.size).toBe(9);
  });

  it('places every page at the top of its sheet rather than at a running offset', async () => {
    await buildContractPdf(docWithPages(4));
    // y is arg index 3. A running offset is what walked content off the sheet before.
    const ys = addImage.mock.calls.map(c => c[3]);
    expect(ys.every(y => y === 0)).toBe(true);
  });

  it('still falls back to slicing when the markup has no page markers', async () => {
    await buildContractPdf(document.createElement('div'));
    expect(addImage.mock.calls.length).toBeGreaterThan(1);
    const aliases = new Set(addImage.mock.calls.map(c => c[6]));
    expect(aliases.size).toBe(1);
  });
});
