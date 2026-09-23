// @vitest-environment happy-dom
// Fix round 1 / B1 — PcWorkspaceView.tsx's own glue between PlansWorkspace
// and useEstimatingBid: onApplied installs the apply-markups response
// directly (estimatingBid.installSaved), and onCreateLine adds a new line
// through the SAME live lines state (setLines + save(nextLines), never a
// PlansWorkspace-owned PUT of a snapshot). The underlying mechanisms
// (installSaved, save(linesOverride), PlansWorkspace's own dirty-gating)
// are already unit-tested elsewhere; this exercises the ACTUAL wiring in
// PcWorkspaceView.tsx by driving it through a stand-in PlansWorkspace that
// exposes both callbacks as buttons.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';
import { EstimateLine, PricingRecap, SaveBidResponse } from '../estimating/types';

afterEach(cleanup);

function mockDesktopMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minM = /min-width:\s*(\d+)px/.exec(query);
    const maxM = /max-width:\s*(\d+)px/.exec(query);
    const min = minM ? Number(minM[1]) : null;
    const max = maxM ? Number(maxM[1]) : null;
    const matches = (min == null || 1400 >= min) && (max == null || 1400 <= max);
    return {
      matches, media: query, onchange: null,
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

// Exposes onApplied/onCreateLine as plain buttons so the test can invoke
// them directly, the same way the real PlansWorkspace would after its own
// (separately-tested) ensureLinesSavedFirst gating and API calls.
vi.mock('../estimating/plans/PlansWorkspace', () => ({
  default: (props: {
    lines: EstimateLine[];
    onApplied?: (saved: SaveBidResponse) => void;
    onCreateLine?: (newLine: EstimateLine) => Promise<boolean>;
  }) => (
    <div data-testid="plans-workspace-mock">
      <div data-testid="plans-mock-line-count">{props.lines.length}</div>
      <button onClick={() => props.onApplied?.({
        recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 777 } },
        bidEstimate: {},
        lines: [{ id: 'l1', line_key: 'k1', category: 'Branch Power', description: 'Duplex', qty: 24, unit: 'EA', source: 'takeoff', qty_source: 'markup' }],
      })}>
        Simulate Apply
      </button>
      <button onClick={async () => {
        const ok = await props.onCreateLine?.({
          id: 'new-1', line_key: 'new-1', category: 'Branch Power', description: 'New manual line',
          qty: 1, unit: 'EA', source: 'manual', material_unit_override: 42, labor_hours_override: 0,
        });
        document.body.setAttribute('data-create-result', String(ok));
      }}>
        Simulate New Line
      </button>
    </div>
  ),
}));

const EMPTY_RECAP: PricingRecap = {
  lines: [], categories: [],
  totals: { materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0, smallTools: 0, directCost: 0, overhead: 0, profit: 0, grandTotal: 0, sellPerSf: null, crewWeeks: 0 },
  warnings: { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0, unitUnknownCount: 0, fuzzyMatchCount: 0 },
};

function mockApi() {
  get.mockImplementation((url: string) => {
    if (/\/estimating\/[^/]+$/.test(url)) {
      return Promise.resolve({
        data: {
          lines: [{ id: 'l1', line_key: 'k1', category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA', source: 'takeoff', qty_source: 'takeoff' }],
          settings: {
            labor_rate: 38, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
            supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
          },
          recap: EMPTY_RECAP, proposed: false, savedGrandTotal: null,
        },
      });
    }
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: { recap: EMPTY_RECAP } }); // echoes no `lines` — save() falls back to whatever it was PUT with
}

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function renderTakeoffPlans() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'takeoff' as const };
  render(
    <PcWorkspaceView ws={ws} bid={bid} onUpdate={() => {}} onBack={() => {}} onConverted={() => {}} onBidUpdated={() => {}} showToast={() => {}} embedded />,
  );
}

describe('PcWorkspaceView — Apply/New-line-from-markup wiring (Fix round 1 / B1)', () => {
  it('onApplied installs the apply response directly — no GET refetch at all', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffPlans();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy());
    const getCallsBeforeApply = get.mock.calls.length;

    fireEvent.click(screen.getByText('Simulate Apply'));

    // The installed line (qty 24) reaches PlansWorkspace's own `lines` prop.
    await waitFor(() => expect(screen.getByTestId('plans-mock-line-count').textContent).toBe('1'));
    expect(get.mock.calls.length).toBe(getCallsBeforeApply); // installSaved never re-fetches
  });

  it('onCreateLine adds the line through live setLines + save(nextLines) — the new line reaches PlansWorkspace\'s own `lines` prop, and the PUT carries it', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffPlans();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-mock-line-count').textContent).toBe('1')); // the one seeded line

    fireEvent.click(screen.getByText('Simulate New Line'));

    await waitFor(() => expect(document.body.getAttribute('data-create-result')).toBe('true'));
    // The PUT body carries BOTH the original line and the new one — never
    // just the new one alone (which would happen if onCreateLine PUT its
    // own isolated snapshot instead of reading the live lines state).
    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimating/b1', expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ line_key: 'k1' }),
        expect.objectContaining({ line_key: 'new-1', description: 'New manual line' }),
      ]),
    })));
    // And PlansWorkspace's own `lines` prop grew to 2 — the new line is
    // now part of the SAME shared state Labor & Pricing would see too.
    await waitFor(() => expect(screen.getByTestId('plans-mock-line-count').textContent).toBe('2'));
  });
});
