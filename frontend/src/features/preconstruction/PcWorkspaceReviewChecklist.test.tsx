// @vitest-environment happy-dom
// Estimating Phase B, Task 8 (deferral closed) — the Review step's
// pre-send checklist shows the "N lines not verified on plans" count
// (lines already computed for BidSummary's own warning banner — this
// proves the SAME count reaches the Review step's checklist too, and
// that clicking it jumps to the Plans view).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';
import { EstimateLine } from '../estimating/types';

afterEach(cleanup);

// Same mock shape as EstimateShell.test.tsx / PcWorkspaceTakeoffPlansToggle.
// test.tsx — forces the desktop rail (not the mobile chip row), so
// est-step-review has exactly one match.
function mockDesktopMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    // Task 9 (deferral closed): SheetNavigator's own 900-1279px dropdown
    // query has a max-width component too — a min-width-only check would
    // wrongly report "matches" for it at 1400px (min-width:900 alone is
    // satisfied), tripping the dropdown branch instead of the full list.
    const minM = /min-width:\s*(\d+)px/.exec(query);
    const maxM = /max-width:\s*(\d+)px/.exec(query);
    const min = minM ? Number(minM[1]) : null;
    const max = maxM ? Number(maxM[1]) : null;
    const matches = (min == null || 1400 >= min) && (max == null || 1400 <= max);
    return {
      matches,
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    };
  });
}

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return {
    id: 'l1', line_key: 'l1', category: 'Branch Power', description: 'Duplex receptacle',
    qty: 5, unit: 'EA', source: 'takeoff', qty_source: 'takeoff',
    ...over,
  };
}

function mockApi(lines: EstimateLine[]) {
  get.mockImplementation((url: string) => {
    if (/\/estimating\/.+\/sheets$/.test(url)) return Promise.resolve({ data: { sheets: [] } });
    if (/\/estimating\/.+\/markups\/rollup/.test(url)) return Promise.resolve({ data: { rollup: [] } });
    if (/\/estimating\/.+\/markups$/.test(url)) return Promise.resolve({ data: { markups: [] } });
    if (/\/estimating\/[^/]+$/.test(url)) {
      return Promise.resolve({
        data: {
          lines, settings: {
            labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
            supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
          },
          recap: {
            lines: [], categories: [],
            totals: { materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0, smallTools: 0, directCost: 0, overhead: 0, profit: 0, grandTotal: 0, sellPerSf: null, crewWeeks: 0 },
            warnings: { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0, unitUnknownCount: 0, fuzzyMatchCount: 0 },
          },
          proposed: false, savedGrandTotal: null,
        },
      });
    }
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
}

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function renderAtReviewStep() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'proposal' as const }; // maps to the 'review' step
  render(
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={() => {}}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />,
  );
}

describe('Review step — pre-send checklist "N lines not verified on plans" (Task 8, deferral closed)', () => {
  it('shows the count when 1+ takeoff lines have never been confirmed against the plans (qty_source !== \'markup\')', async () => {
    mockDesktopMatchMedia();
    mockApi([line(), line({ id: 'l2', line_key: 'l2', description: 'Another line' })]);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('review-presend-checklist')).toBeTruthy());
    // BidSummary's own sidebar warning uses near-identical wording, so this
    // scopes to the checklist specifically, not just "some element on the
    // page says this".
    expect(within(screen.getByTestId('review-presend-checklist')).getByText(/2 lines not verified on plans/)).toBeTruthy();
  });

  it('uses singular phrasing for exactly one line', async () => {
    mockDesktopMatchMedia();
    mockApi([line()]);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('review-presend-checklist')).toBeTruthy());
    expect(within(screen.getByTestId('review-presend-checklist')).getByText(/1 line not verified on plans/)).toBeTruthy();
  });

  it('a line whose qty_source is \'markup\' (confirmed via Plan Viewer) does not count', async () => {
    mockDesktopMatchMedia();
    mockApi([line({ qty_source: 'markup' })]);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('est-step-review')).toBeTruthy());
    expect(screen.queryByTestId('review-presend-checklist')).toBeNull();
  });

  it('a manual (non-takeoff) line never counts, regardless of qty_source', async () => {
    mockDesktopMatchMedia();
    mockApi([line({ source: 'manual', qty_source: 'manual' })]);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('est-step-review')).toBeTruthy());
    expect(screen.queryByTestId('review-presend-checklist')).toBeNull();
  });

  it('clicking "review on plans" jumps to the Takeoff step\'s Plans view', async () => {
    mockDesktopMatchMedia();
    mockApi([line()]);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('review-presend-checklist')).toBeTruthy());
    fireEvent.click(within(screen.getByTestId('review-presend-checklist')).getByText('review on plans'));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true'));
  });
});

// Fix round 2 / R2-S4(a) — composeBidData.ts's own ambiguousQtyKeys used to
// only ever reach server logs; GET /preconstruction/:bidId/proposal-preview
// now includes it, and it's only meaningful once a proposal exists
// (agent4_status: 'complete' — the same proposalReady gate the Proposal tab
// itself uses), which is why this needs its own mock setup rather than
// reusing the plain mockApi() above (which never mocks /results or
// /proposal-preview at all, so ambiguousQtyKeys stays empty by construction
// there).
describe('Review step — pre-send checklist ambiguous-qty warning (Fix round 2 / R2-S4(a))', () => {
  function mockApiWithProposal(lines: EstimateLine[], ambiguousQtyKeys: string[]) {
    get.mockImplementation((url: string) => {
      if (/\/estimating\/.+\/sheets$/.test(url)) return Promise.resolve({ data: { sheets: [] } });
      if (/\/estimating\/.+\/markups\/rollup/.test(url)) return Promise.resolve({ data: { rollup: [] } });
      if (/\/estimating\/.+\/markups$/.test(url)) return Promise.resolve({ data: { markups: [] } });
      if (/\/estimating\/[^/]+$/.test(url)) {
        return Promise.resolve({
          data: {
            lines, settings: {
              labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
              supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
            },
            recap: {
              lines: [], categories: [],
              totals: { materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0, smallTools: 0, directCost: 0, overhead: 0, profit: 0, grandTotal: 0, sellPerSf: null, crewWeeks: 0 },
              warnings: { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0, unitUnknownCount: 0, fuzzyMatchCount: 0 },
            },
            proposed: false, savedGrandTotal: null,
          },
        });
      }
      if (/\/preconstruction\/.+\/results$/.test(url)) {
        return Promise.resolve({ data: { agent2_output: '{"scopeOfWork":{}}', agent4_status: 'complete', agent4_output: '{}' } });
      }
      if (/\/preconstruction\/.+\/proposal-preview$/.test(url)) {
        return Promise.resolve({
          data: {
            project_name: 'Test Job', project_address: '', client: '', job_number: 'JS.09022026',
            total_price: '$1', scope: [], sections: [], exclusions: [],
            takeoff: [{ name: 'Service & Distribution', items: [{ item: '1.1', description: 'Panel', unit: 'EA', qty: 1, source: 'E1.0' }] }],
            terms: [], ambiguousQtyKeys,
          },
        });
      }
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });
    put.mockResolvedValue({ data: {} });
  }

  it('shows the ambiguous-qty warning in the checklist, naming the count, once the proposal preview has ambiguousQtyKeys', async () => {
    mockDesktopMatchMedia();
    mockApiWithProposal([line({ qty_source: 'markup' })], ['Branch Power::3.1', 'Underground Feeders::5.1']);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('review-presend-checklist')).toBeTruthy());
    // Same wording/count as BidSummary's own sidebar warning — scoped to
    // the checklist specifically.
    expect(within(screen.getByTestId('review-presend-checklist'))
      .getByText('2 items where the GC takeoff qty may not match the saved estimate')).toBeTruthy();
  });

  it('uses singular phrasing for exactly one ambiguous key', async () => {
    mockDesktopMatchMedia();
    mockApiWithProposal([line({ qty_source: 'markup' })], ['Branch Power::3.1']);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('review-presend-checklist')).toBeTruthy());
    expect(within(screen.getByTestId('review-presend-checklist'))
      .getByText('1 item where the GC takeoff qty may not match the saved estimate')).toBeTruthy();
  });

  it('shows no checklist at all when there is nothing unverified AND ambiguousQtyKeys is empty', async () => {
    mockDesktopMatchMedia();
    mockApiWithProposal([line({ qty_source: 'markup' })], []);
    renderAtReviewStep();

    await waitFor(() => expect(screen.getByTestId('est-step-review')).toBeTruthy());
    expect(screen.queryByTestId('review-presend-checklist')).toBeNull();
  });
});
