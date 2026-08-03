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
