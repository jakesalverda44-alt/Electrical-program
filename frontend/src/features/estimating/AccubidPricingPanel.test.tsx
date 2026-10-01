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
  window.localStorage.clear();
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

  it('B4: a seeded default cost line is labelled, and its amount can be corrected in place', async () => {
    get.mockResolvedValue({
      data: { ...base, costLines: [{ id: 'eq1', kind: 'equipment', description: 'Equipment — default', amount: 890, taxPct: 0, sort: 0, autoDefault: true }] },
    });
    put.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-costline-default-eq1')).toBeTruthy());
    const input = screen.getByTestId('accubid-costline-amount-eq1') as HTMLInputElement;
    expect(input.value).toBe('890');
    fireEvent.change(input, { target: { value: '1250' } });
    fireEvent.blur(input);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/cost-lines/eq1', expect.objectContaining({ amount: 1250 })));
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

  // Review round 2 / N15 — a null night rate used to be passed straight as
  // an <input>'s `value`, which React treats as an uncontrolled input and
  // warns about the moment it later gets a real number (or vice versa).
  it('N15: switching to night shift renders blank (not crashing, not warning) night-rate inputs, and a typed value saves; clearing it back to blank saves null', async () => {
    get.mockResolvedValue({ data: base }); // DEFAULT_ACCUBID_SETTINGS — all three night rates are null
    put.mockResolvedValue({ data: base });
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<AccubidPricingPanel bidId="bid1" />);
      await waitFor(() => expect(screen.getByTestId('accubid-shift')).toBeTruthy());
      fireEvent.change(screen.getByTestId('accubid-shift'), { target: { value: 'night' } });

      const nightJourneyman = await screen.findByLabelText('Night journeyman $/hr') as HTMLInputElement;
      expect(nightJourneyman.value).toBe(''); // never the literal string "null"

      fireEvent.change(nightJourneyman, { target: { value: '42' } });
      fireEvent.click(screen.getByTestId('accubid-save-settings'));
      await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/settings', expect.objectContaining({ nightJourneymanRate: 42 })));

      put.mockClear();
      fireEvent.change(nightJourneyman, { target: { value: '' } });
      fireEvent.click(screen.getByTestId('accubid-save-settings'));
      await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/settings', expect.objectContaining({ nightJourneymanRate: null })));

      // No React "changing an uncontrolled input to be controlled" (or the
      // reverse) warning was ever printed through this whole sequence.
      const reactWarning = warnSpy.mock.calls.some(args => typeof args[0] === 'string' && /uncontrolled/i.test(args[0]));
      expect(reactWarning).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
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

describe('AccubidPricingPanel — price accuracy C4/C6', () => {
  it('C6: a bid that predates the defaults offers "use the default" per kind; clicking posts that kind only', async () => {
    get.mockResolvedValue({ data: { ...base, defaultOptIns: ['equipment', 'general_expense'] } });
    post.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-use-default-equipment')).toBeTruthy());
    expect(screen.getByTestId('accubid-use-default-general_expense')).toBeTruthy();
    fireEvent.click(screen.getByTestId('accubid-use-default-equipment'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/estimating/bid1/accubid/cost-lines/use-defaults', { kinds: ['equipment'] }));
  });

  it('C6: no button when the bid may not opt in', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-selling-price')).toBeTruthy());
    expect(screen.queryByTestId('accubid-use-default-equipment')).toBeNull();
  });

  it('C4: a previewed default (added on save) shows read-only, with no remove / edit', async () => {
    get.mockResolvedValue({ data: { ...base, proposed: true, costLines: [{ id: 'preview-equipment', kind: 'equipment', description: 'Equipment — default (added on save)', amount: 890, taxPct: 0, sort: 0, preview: true }] } });
    render(<AccubidPricingPanel bidId="bid1" />);
    const row = await screen.findByTestId('accubid-costline-preview-equipment');
    expect(row.textContent).toContain('$890.00');
    expect(within(row).queryByText('Remove')).toBeNull();
  });
});

describe('AccubidPricingPanel — decision 3: fixture package quote', () => {
  it('shows the flag on a quote and saves the toggle', async () => {
    get.mockResolvedValue({ data: { ...base, quotes: [{ id: 'q1', description: 'Lighting package', amount: 3795, taxPct: 7, markupPct: 10, status: 'firm', vendor: null, sort: 0, fixturePackage: false }] } });
    put.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    const box = await screen.findByTestId('accubid-quote-fixture-package-q1') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/quotes/q1', { fixturePackage: true }));
  });
});

describe('gap-closing T3 — "is this quote the fixture package?"', () => {
  const q = { id: 'q1', description: 'materials. vendor', amount: 4470, taxPct: 0, markupPct: 18, status: 'budget_pending' as const, vendor: null, sort: 0, fixturePackage: false };
  const asked: AccubidBidResponse = { ...base, quotes: [q], fixturePackageQuestion: { quoteIds: ['q1'], fixtureMaterial: 3005, message: "Quote 'materials. vendor' $4,470 and library fixture material $3,005 are both priced — is this quote the fixture package?" } };
  it('shows the prompt; Yes sets the fixture package; No only marks it answered', async () => {
    get.mockResolvedValue({ data: asked });
    put.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-fixture-package-question')).toBeTruthy());
    expect(screen.getByTestId('accubid-fixture-package-question').textContent).toMatch(/both priced — is this quote the fixture package\?/);
    fireEvent.click(screen.getByTestId('accubid-fixture-package-yes'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/quotes/q1', { fixturePackage: true, fixturePackageDecided: true }));
  });
  it('No only marks the quote answered (fixture package stays off)', async () => {
    get.mockResolvedValue({ data: asked });
    put.mockResolvedValue({ data: {} });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-fixture-package-no')).toBeTruthy());
    fireEvent.click(screen.getByTestId('accubid-fixture-package-no'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/quotes/q1', { fixturePackageDecided: true }));
  });
  it('no question → no prompt', async () => {
    get.mockResolvedValue({ data: { ...base, quotes: [q] } });
    render(<AccubidPricingPanel bidId="bid1" />);
    await waitFor(() => expect(screen.getByTestId('accubid-recap-table')).toBeTruthy());
    expect(screen.queryByTestId('accubid-fixture-package-question')).toBeNull();
  });
});

// ── UI cleanup round 2B, Task 5 — Accubid sections as cards ──
describe('UI cleanup round 2B — Accubid cards', () => {
  const quote = (id: string, amount: number, status: 'firm' | 'budget_pending') => ({ id, description: `Quote ${id}`, amount, taxPct: 0, markupPct: 18, status, vendor: null, sort: 0 });

  it('empty Quotes and Alternates start closed; Equipment, General expenses, Crew and the price card start open', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await screen.findByTestId('accubid-quotes');
    for (const id of ['accubid-quotes', 'accubid-alternates']) {
      expect(screen.getByTestId(`${id}-toggle`).getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByTestId(`${id}-body`).hasAttribute('hidden')).toBe(true);
    }
    for (const id of ['accubid-crew-card', 'accubid-costlines-equipment', 'accubid-costlines-general_expense', 'accubid-price-card']) {
      expect(screen.getByTestId(`${id}-toggle`).getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('Quotes is open when quotes exist, and its summary counts the pending ones', async () => {
    get.mockResolvedValue({ data: { ...base, quotes: [quote('a', 5000, 'budget_pending'), quote('b', 4500, 'firm')] } });
    render(<AccubidPricingPanel bidId="bid1" />);
    await screen.findByTestId('accubid-quotes');
    expect(screen.getByTestId('accubid-quotes-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('accubid-quotes-summary').textContent).toBe('2 quotes · $9,500.00 · 1 budget-pending');
  });

  it('toggling a card stores the choice', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    fireEvent.click(await screen.findByTestId('accubid-quotes-toggle'));
    expect(window.localStorage.getItem('est-lp-acb-quotes-open')).toBe('1');
    expect(screen.getByTestId('accubid-quotes-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('editing a crew field flags "Not saved" in the header and beside the button, and the typed value survives a fold', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await screen.findByTestId('accubid-crew-card');
    expect(screen.queryByTestId('accubid-crew-dirty-note')).toBeNull();
    fireEvent.change(screen.getByLabelText('Labor overhead %'), { target: { value: '45' } });
    expect(screen.getByTestId('accubid-crew-card-summary').textContent).toContain('Not saved');
    expect(screen.getByTestId('accubid-crew-dirty-note')).toBeTruthy();
    fireEvent.click(screen.getByTestId('accubid-crew-card-toggle'));
    expect(screen.getByTestId('accubid-crew-card-body').hasAttribute('hidden')).toBe(true);
    expect((screen.getByLabelText('Labor overhead %') as HTMLInputElement).value).toBe('45');
    expect(screen.getByTestId('accubid-crew-card-summary').textContent).toContain('Labor overhead 45%');
  });

  it('the fixture-package question is never inside a folded card', async () => {
    get.mockResolvedValue({ data: { ...base, quotes: [quote('q1', 5000, 'budget_pending')], fixturePackageQuestion: { quoteIds: ['q1'], fixtureMaterial: 3000, message: 'Is it the fixture package?' } } });
    render(<AccubidPricingPanel bidId="bid1" />);
    const q = await screen.findByTestId('accubid-fixture-package-question');
    fireEvent.click(screen.getByTestId('accubid-quotes-toggle')); // close Quotes
    expect(screen.getByTestId('accubid-quotes-body').hasAttribute('hidden')).toBe(true);
    expect(q.closest('[hidden]')).toBeNull();
    expect(screen.getByTestId('accubid-quotes').contains(q)).toBe(false);
  });

  it('the selling-price card carries the live-total hint and its total in the header', async () => {
    get.mockResolvedValue({ data: base });
    render(<AccubidPricingPanel bidId="bid1" />);
    await screen.findByTestId('accubid-price-card');
    expect(screen.getByTestId('accubid-price-card-summary').textContent).toBe('$5,000.00');
    expect(screen.getByTestId('accubid-price-hint').textContent).toContain('live total, including unsaved changes');
  });

  it('showStatus={false} leaves the warnings to the page (LaborPricingStep renders them at the top)', async () => {
    get.mockResolvedValue({ data: { ...base, recap: { ...base.recap, blocksSend: true, budgetPendingQuotes: [quote('q1', 1, 'budget_pending')] } } });
    render(<AccubidPricingPanel bidId="bid1" showStatus={false} />);
    await screen.findByTestId('accubid-recap-table');
    expect(screen.queryByTestId('accubid-blocks-send')).toBeNull();
  });
});
