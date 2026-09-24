// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), delete: (...a: unknown[]) => del(...a) } };
});

import { AccubidPricingPanel } from './AccubidPricingPanel';
import { AccubidBidResponse, DEFAULT_ACCUBID_SETTINGS, EMPTY_ACCUBID_RECAP } from './types';

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset();
});

const base: AccubidBidResponse = {
  recap: { ...EMPTY_ACCUBID_RECAP, sellingPrice: 5000, blocksSend: false },
  settings: DEFAULT_ACCUBID_SETTINGS,
  totalHours: 12.5,
  quotes: [],
  costLines: [],
  alternates: [],
};

describe('AccubidPricingPanel', () => {
  it('renders the selling price and crew defaults once loaded', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-selling-price')).toBeTruthy());
    expect(screen.getByTestId('accubid-selling-price').textContent).toContain('5,000');
    expect(screen.getByText('12.500', { exact: false })).toBeTruthy();
  });

  it('shows the budget-pending banner and lists the blocking quotes', async () => {
    get.mockResolvedValue({
      data: { ...base, recap: { ...base.recap, blocksSend: true, budgetPendingQuotes: [{ id: 'q1', description: 'Switchgear', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 }] } },
    });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-blocks-send')).toBeTruthy());
    expect(screen.getByTestId('accubid-blocks-send').textContent).toContain('Switchgear');
  });

  it('never shows the blocking banner once every quote is firm', async () => {
    get.mockResolvedValue({ data: { ...base, recap: { ...base.recap, blocksSend: false } } });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-recap-table')).toBeTruthy());
    expect(screen.queryByTestId('accubid-blocks-send')).toBeNull();
  });

  it('adding a quote POSTs to /accubid/quotes with a non-firm default status', async () => {
    get.mockResolvedValue({ data: base });
    post.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-add-quote')).toBeTruthy());
    const quotesSection = screen.getByTestId('accubid-quotes');
    fireEvent.change(within(quotesSection).getByPlaceholderText('Switchgear'), { target: { value: 'Distribution gear' } });
    fireEvent.change(within(quotesSection).getByPlaceholderText('0.00'), { target: { value: '4500' } });
    fireEvent.click(screen.getByTestId('accubid-add-quote'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/bid1/accubid/quotes', expect.objectContaining({ description: 'Distribution gear', amount: 4500, status: 'budget_pending' })));
  });

  it('an auto alternate has no Remove button; a manual one does', async () => {
    get.mockResolvedValue({
      data: {
        ...base,
        alternates: [
          { id: 'auto1', kind: 'deduct', description: 'Graybar package deduct', amount: 9600, auto: true, sourceRule: 'account_rule_auto_deduct', sort: 0 },
          { id: 'manual1', kind: 'deduct', description: 'Existing fixtures stay', amount: 1830, auto: false, sourceRule: null, sort: 1 },
        ],
      },
    });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-alternate-auto1')).toBeTruthy());
    const autoRow = screen.getByTestId('accubid-alternate-auto1');
    const manualRow = screen.getByTestId('accubid-alternate-manual1');
    expect(autoRow.textContent).toContain('(auto)');
    expect(Array.from(autoRow.querySelectorAll('button')).some(b => b.textContent === 'Remove')).toBe(false);
    expect(Array.from(manualRow.querySelectorAll('button')).some(b => b.textContent === 'Remove')).toBe(true);
  });

  it('saving crew settings PUTs the form values', async () => {
    get.mockResolvedValue({ data: base });
    put.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-save-settings')).toBeTruthy());
    const laborOhInputs = screen.getAllByDisplayValue('38');
    fireEvent.change(laborOhInputs[0], { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('accubid-save-settings'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/settings', expect.objectContaining({ laborOverheadPct: 45 })));
  });
});
