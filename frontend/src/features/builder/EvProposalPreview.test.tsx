// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import EvProposalPreview from './EvProposalPreview';
import { blankEvForm, calcEvTotals } from './evCalc';
import { EvForm } from './evData';
import { CustomItem } from './genData';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

function renderEv(over: Partial<EvForm> = {}) {
  mockMatchMedia(false);
  const form: EvForm = { ...blankEvForm(), customer: 'Jane Homeowner', ...over };
  return render(<EvProposalPreview embed form={form} totals={calcEvTotals(form)} proposalNo="JSEV-08102026-123"/>);
}

describe('EvProposalPreview — scope of work', () => {
  it('names the quoted distance tier in the install scope', () => {
    const { container } = renderEv({ distanceTier: 'f16to25' });
    expect(container.textContent).toContain('Scope of Work — Tesla Wall Connector Installation');
    expect(container.textContent).toContain('16 to 25 feet');
  });

  it('states that the customer supplies the charger', () => {
    const { getByText } = renderEv();
    expect(getByText('Equipment — Customer Supplied')).toBeTruthy();
  });

  it('states the one-year workmanship warranty', () => {
    const { getByText, container } = renderEv();
    expect(getByText('1-Year Workmanship Warranty')).toBeTruthy();
    expect(container.textContent).toContain('one (1) year');
  });

  it('shows the service upgrade row only when the upgrade is quoted', () => {
    expect(renderEv({ panelUpgrade: false }).container.textContent).not.toContain('Service Upgrade to 200A');
    cleanup();
    expect(renderEv({ panelUpgrade: true }).container.textContent).toContain('Service Upgrade to 200A');
  });

  it('collapses custom items into one Additional Work row', () => {
    const customItems: CustomItem[] = [
      { id: 'a', desc: 'Extra 40 ft of run', amount: 400, taxable: false },
      { id: 'b', desc: 'Second charger', amount: 850, taxable: false },
    ];
    const { getAllByText, getByText } = renderEv({ customItems });
    expect(getAllByText('Additional Work Included')).toHaveLength(1);
    const row = getByText('Additional Work Included').closest('tr');
    expect(row?.textContent).toContain('Extra 40 ft of run');
    expect(row?.textContent).toContain('Second charger');
  });

  it('never mentions permits anywhere in the document', () => {
    const { container } = renderEv({ panelUpgrade: true, includeBreakdown: true, notes: 'Customer will be home Friday.' });
    expect(container.textContent?.toLowerCase()).not.toContain('permit');
  });

  it('carries no generator sales terms', () => {
    const { container } = renderEv({ includeBreakdown: true });
    const text = container.textContent ?? '';
    expect(text).not.toContain('GENERATOR SALES ARE FINAL');
    expect(text).not.toContain('Generator Proposal');
    expect(text.toLowerCase()).not.toContain('nonrefundable deposit');
  });
});

describe('EvProposalPreview — pricing', () => {
  it('shows the total in the cash price banner', () => {
    const { container } = renderEv({ distanceTier: 'f6to15' });
    // 993 + 50 flat tax
    expect(container.textContent).toContain('$1,043.00');
  });

  it('hides the deposit when no deposit is taken, and states payment on completion', () => {
    const { container } = renderEv({ depositPct: 0 });
    expect(container.textContent).toContain('Due upon completion');
    expect(container.textContent).not.toContain('Deposit at signing');
  });

  it('shows the deposit when the rep sets one', () => {
    const { container } = renderEv({ depositPct: 50 });
    expect(container.textContent).toContain('Deposit at signing');
  });
});

describe('EvProposalPreview — price breakdown page', () => {
  it('is omitted unless the rep opts in', () => {
    const { container } = renderEv({ includeBreakdown: false });
    expect(container.textContent).not.toContain('PRICE BREAKDOWN');
  });

  it('lists the tier, the flat tax and the total, with no tax-status column', () => {
    const { container, getByText } = renderEv({ distanceTier: 'le5', includeBreakdown: true });
    expect(container.textContent).toContain('PRICE BREAKDOWN');
    expect(getByText('Wall Connector Installation — 5 feet or less').closest('tr')?.textContent).toContain('$675.00');
    expect(getByText('Sales Tax').closest('tr')?.textContent).toContain('$50.00');
    // The generator breakdown carries a Tax Status column; the EV one must not.
    expect(container.textContent).not.toContain('Tax Status');
    expect(container.textContent).not.toContain('taxable');
  });

  it('lists each custom item on its own breakdown row', () => {
    const customItems: CustomItem[] = [{ id: 'a', desc: 'Extra 40 ft of run', amount: 400, taxable: false }];
    const { getByText } = renderEv({ customItems, includeBreakdown: true });
    expect(getByText('Extra 40 ft of run').closest('tr')?.textContent).toContain('$400.00');
  });

  it('shows a discount as a negative row', () => {
    const { getByText } = renderEv({ discount: 100, discountType: '$', includeBreakdown: true });
    expect(getByText('Discount').closest('tr')?.textContent).toContain('-$100.00');
  });
});
