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
});
