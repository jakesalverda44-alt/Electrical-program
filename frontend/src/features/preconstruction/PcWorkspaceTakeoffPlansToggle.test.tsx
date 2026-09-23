// @vitest-environment happy-dom
// Estimating Phase B, Task 8/9 — the Takeoff step's List|Plans toggle:
// switching to Plans mounts PlansWorkspace behind its OWN lazy chunk
// (separate from EstimatingWorkspace's), the Bid Summary collapses to its
// slim form while Plans is open, and switching back to List restores the
// original BidTab/TakeoffTab content unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);

// Force desktop width (>=1280px) so forceSlimSummary's effect is actually
// observable — happy-dom's default matchMedia otherwise resolves to
// whatever this environment's default viewport is, which can mask the very
// distinction (full aside vs slim toggle) these tests exist to prove. Same
// mock shape as EstimateShell.test.tsx's own mockMatchMedia.
function mockDesktopMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const threshold = m ? Number(m[1]) : 0;
    return {
      matches: 1400 >= threshold,
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

function mockApi() {
  get.mockImplementation((url: string) => {
    if (/\/estimating\/.+\/sheets$/.test(url)) return Promise.resolve({ data: { sheets: [] } });
    if (/\/estimating\/.+\/markups\/rollup/.test(url)) return Promise.resolve({ data: { rollup: [] } });
    if (/\/estimating\/.+\/markups$/.test(url)) return Promise.resolve({ data: { markups: [] } });
    if (/\/estimating\/[^/]+$/.test(url)) {
      return Promise.resolve({
        data: {
          lines: [], settings: {
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

function renderTakeoffStep() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'takeoff' as const };
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

describe('Takeoff step — List|Plans toggle', () => {
  it('defaults to the List view (unchanged BidTab/TakeoffTab content)', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'List' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('false');
    // The desktop Bid Summary is still the full aside — Plans hasn't been opened.
    expect(screen.queryByTestId('est-summary-slim-toggle')).toBeNull();
  });

  it('clicking Plans mounts PlansWorkspace behind its own lazy chunk and shows the empty-sheets state', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Plans' }));

    expect(await screen.findByText('No plan sheets found for this bid yet.')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/estimating\/b1\/sheets$/), expect.anything()));
  });

  it('collapses the Bid Summary to its slim form while Plans is open', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy());
  });

  it('switching back to List restores the original content and the full summary', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    await waitFor(() => expect(screen.queryByTestId('est-summary-slim-toggle')).toBeNull());
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
  });
});
