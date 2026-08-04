// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ProposalPreview, { embedFontSize, embedDocStyle, embedPageStyle } from './ProposalPreview';
import { blankGenForm, calcGenTotals } from './genCalc';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

// Stand in for window.matchMedia (not implemented meaningfully by happy-dom) so
// useIsMobile can be driven deterministically per test — same pattern as
// LeadsPage.mobile.test.tsx.
function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('embed style-derivation helpers (pure)', () => {
  it('floors sub-11px sizes only when embed AND mobile-width are both true', () => {
    expect(embedFontSize(9, true, true)).toBe(11);
    expect(embedFontSize(8, true, true)).toBe(11);
    expect(embedFontSize(9, true, false)).toBe(9);   // desktop embed — untouched
    expect(embedFontSize(9, false, true)).toBe(9);   // in-app preview/print/PDF — untouched
    expect(embedFontSize(9, false, false)).toBe(9);
    expect(embedFontSize(12, true, true)).toBe(12);  // already >= floor — unchanged
  });

  it('gives embed+mobile a bigger base doc font and tighter side padding; everything else keeps desktop values', () => {
    expect(embedDocStyle(true, true).fontSize).toBe(12);
    expect(embedDocStyle(true, false).fontSize).toBe(10);
    expect(embedDocStyle(false, true).fontSize).toBe(10);
    expect(embedDocStyle(false, false).fontSize).toBe(10);

    expect(embedPageStyle(true, true).padding).toBe('0 12px 24px');
    expect(embedPageStyle(true, false).padding).toBe('0 36px 36px');
    expect(embedPageStyle(false, true).padding).toBe('0 36px 36px');
    expect(embedPageStyle(false, false).padding).toBe('0 36px 36px');
  });
});

describe('ProposalPreview embed vs non-embed rendering', () => {
  const form = blankGenForm();
  form.customer = 'Jane Homeowner';
  const totals = calcGenTotals(form);

  it('applies the mobile-embed page padding and floors the smallest body copy when embed on a narrow viewport', () => {
    mockMatchMedia(true);
    const { container, getByText } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"/>
    );

    expect(container.querySelector('.proposal-embed')).toBeTruthy();

    const page = container.querySelector('.preview-doc > div > div') as HTMLElement;
    expect(page.style.paddingLeft).toBe('12px');
    expect(page.style.paddingRight).toBe('12px');
    expect(page.style.paddingBottom).toBe('24px');

    // "Prepared For" label renders at 8px in the source document — illegible in a
    // ~271px mobile e-sign iframe. Embed+mobile must floor it to >= 11px.
    const label = getByText('Prepared For');
    expect(parseFloat(label.style.fontSize)).toBeGreaterThanOrEqual(11);
  });

  it('keeps print/PDF (non-embed) padding and type pixel-identical regardless of viewport width', () => {
    mockMatchMedia(true); // narrow viewport — non-embed must NOT react to it
    const { container, getByText } = render(
      <ProposalPreview embed={false} form={form} totals={totals} proposalNo="P-1" onBack={() => {}}/>
    );

    const page = container.querySelector('.preview-doc > div > div') as HTMLElement;
    expect(page.style.paddingLeft).toBe('36px');
    expect(page.style.paddingRight).toBe('36px');
    expect(page.style.paddingBottom).toBe('36px');

    const label = getByText('Prepared For');
    expect(label.style.fontSize).toBe('8px');
  });

  // Fix-round-1 minor #3: fontSize:10 sites (SigBlock labels, Disclosures heading,
  // spec-sheet model line, the Proposal No. value cell) were left unwrapped —
  // still needs the embed+mobile floor even though 10 is close to the 11px floor.
  it('floors the fontSize:10 sites too (SigBlock label, Disclosures heading) in embed+mobile, and leaves them untouched otherwise', () => {
    mockMatchMedia(true);
    const embedRender = render(<ProposalPreview embed form={form} totals={totals} proposalNo="P-1"/>);
    const aptLabel = embedRender.getAllByText('"APT" Accurate Power Technology, Inc.')[0];
    const disclosuresHeading = embedRender.getAllByText('General Disclosures:')[0];
    expect(parseFloat(aptLabel.style.fontSize)).toBeGreaterThanOrEqual(11);
    expect(parseFloat(disclosuresHeading.style.fontSize)).toBeGreaterThanOrEqual(11);
    embedRender.unmount();

    const nonEmbedRender = render(<ProposalPreview embed={false} form={form} totals={totals} proposalNo="P-1" onBack={() => {}}/>);
    const aptLabel2 = nonEmbedRender.getAllByText('"APT" Accurate Power Technology, Inc.')[0];
    const disclosuresHeading2 = nonEmbedRender.getAllByText('General Disclosures:')[0];
    expect(aptLabel2.style.fontSize).toBe('10px');
    expect(disclosuresHeading2.style.fontSize).toBe('10px');
  });

  // Fix-round-1 minor #4: the customer-info-grid Proposal No. VALUE cell (source
  // fontSize 10) sits directly under its own LABEL cell (source fontSize 8).
  // Before this fix, embed+mobile floored only the label to 11px while the value
  // stayed at 10px — a hierarchy inversion where the label rendered bigger than
  // the value it labels. Navigated via DOM structure (not getAllByText index)
  // since proposalNo text also repeats once per page via PageHeader.
  it('never lets the Proposal No. value render smaller than its own label after embed+mobile flooring', () => {
    mockMatchMedia(true);
    const { getByText } = render(<ProposalPreview embed form={form} totals={totals} proposalNo="P-1"/>);

    // Row 1 of the customer-info table: Prepared For | (blank) | Proposal No. | (blank)
    const headerRow = getByText('Prepared For').closest('tr') as HTMLTableRowElement;
    const labelCell = headerRow.children[2] as HTMLElement;
    expect(labelCell.textContent).toBe('Proposal No.');

    // Row 2: customer name (colSpan 2) | proposal number value (colSpan 2)
    const valueRow = headerRow.nextElementSibling as HTMLTableRowElement;
    const valueCell = valueRow.children[1] as HTMLElement;
    expect(valueCell.textContent).toBe('P-1');

    const labelSize = parseFloat(labelCell.style.fontSize);
    const valueSize = parseFloat(valueCell.style.fontSize);
    expect(labelSize).toBeGreaterThanOrEqual(11);
    expect(valueSize).toBeGreaterThanOrEqual(11);
    expect(valueSize).toBeGreaterThanOrEqual(labelSize);
  });
});

// The sales contract is initialed page by page on paper. E-signing used to fill only
// the two signature blocks, leaving all six "CUST INT" rules and the effective-date
// blank empty — which is why signed deals kept going back to print-and-wet-sign.
describe('signed marks: initials and effective date', () => {
  const form = blankGenForm();
  form.customer = 'Jane Homeowner';
  const totals = calcGenTotals(form);
  const INITIALS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUf==';

  it('leaves every CUST INT spot as a blank rule when the proposal is unsigned', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"/>
    );
    const blanks = [...container.querySelectorAll('div')]
      .filter(el => el.childElementCount === 0 && el.textContent === 'CUST INT ________');
    expect(blanks).toHaveLength(6);
    expect(container.querySelectorAll('img[alt="Customer initials"]')).toHaveLength(0);
  });

  it('stamps the drawn initials on all six CUST INT spots once signed', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} initialsImage={INITIALS} signedDate="August 3, 2026"/>
    );
    const marks = container.querySelectorAll('img[alt="Customer initials"]');
    expect(marks).toHaveLength(6);
    marks.forEach(m => expect(m.getAttribute('src')).toBe(INITIALS));
    // No blank rules left behind.
    expect([...container.querySelectorAll('div')]
      .filter(el => el.textContent === 'CUST INT ________')).toHaveLength(0);
  });

  it('still stamps the signature at both buyer blocks alongside the initials', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} initialsImage={INITIALS} signedDate="August 3, 2026"/>
    );
    expect(container.querySelectorAll('img[alt="Buyer signature"]')).toHaveLength(2);
  });

  it('fills the Sales Agreement effective date from the signing date, and falls back to a rule when unsigned', () => {
    mockMatchMedia(false);
    const signed = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} initialsImage={INITIALS} signedDate="August 3, 2026"/>
    );
    expect(signed.container.textContent).toContain('entered into effective August 3, 2026');
    cleanup();

    const unsigned = render(<ProposalPreview embed form={form} totals={totals} proposalNo="P-1"/>);
    expect(unsigned.container.textContent).toContain('entered into effective ________________________');
  });

  it('does not stamp initials when only a signature is on file (older signed proposals)', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} signedDate="August 3, 2026"/>
    );
    expect(container.querySelectorAll('img[alt="Buyer signature"]')).toHaveLength(2);
    expect(container.querySelectorAll('img[alt="Customer initials"]')).toHaveLength(0);
    expect([...container.querySelectorAll('div')]
      .filter(el => el.textContent === 'CUST INT ________')).toHaveLength(6);
  });
});

// A contract signed by the buyer but never countersigned is only half executed — the APT
// column ("By: Authorized Representative" / "Date") stayed blank forever before this.
describe('countersignature', () => {
  const form = blankGenForm();
  form.customer = 'Jane Homeowner';
  const totals = calcGenTotals(form);
  const SIGNATURE = 'data:image/png;base64,BUYER';
  const COUNTERSIGN = 'data:image/png;base64,APT';

  it('leaves the APT side blank when the contract has not been countersigned', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} signedDate="August 4, 2026"/>
    );
    expect(container.querySelectorAll('img[alt="APT signature"]')).toHaveLength(0);
    expect(container.querySelectorAll('img[alt="Buyer signature"]')).toHaveLength(2);
  });

  it('stamps the APT signature and date at both signature blocks once countersigned', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} signedDate="August 4, 2026"
        countersignImage={COUNTERSIGN} countersignDate="August 5, 2026"/>
    );
    const apt = container.querySelectorAll('img[alt="APT signature"]');
    expect(apt).toHaveLength(2);
    apt.forEach(i => expect(i.getAttribute('src')).toBe(COUNTERSIGN));
    expect(container.textContent).toContain('August 5, 2026');
  });

  it('does not disturb the buyer side when countersigned', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ProposalPreview embed form={form} totals={totals} proposalNo="P-1"
        signatureImage={SIGNATURE} initialsImage={'data:image/png;base64,INIT'} signedDate="August 4, 2026"
        countersignImage={COUNTERSIGN} countersignDate="August 5, 2026"/>
    );
    expect(container.querySelectorAll('img[alt="Buyer signature"]')).toHaveLength(2);
    expect(container.querySelectorAll('img[alt="Customer initials"]')).toHaveLength(6);
  });
});
