// @vitest-environment happy-dom
// Fix round 1 / B3(c) — the Takeoff step's List/Plans toggle and the step
// rail's onSelectStep both used to unmount PlansWorkspace (and whatever
// pending/failed markup autosave it was holding) unconditionally, never
// consulting an unsaved-work guard the way App.tsx's own navigation does.
//
// Fix round 2 / R2-S2 — rewritten from the original version of this test,
// which routed through the GLOBAL confirmLeave (the whole
// UnsavedGuardContext registry, which also includes the separate Labor &
// Pricing dirty guard — a step change never actually loses THAT, since it
// lives in this component's own shared estimatingBid state). Step/toggle
// navigation now checks ONLY the markup-autosave condition, surfaced via a
// dedicated onMarkupUnsavedChange callback prop (not useUnsavedGuard/the
// global registry at all), through the app's own ad-hoc useConfirm()
// dialog with markup-specific wording — never the generic
// "You have unsaved changes" / "the changes on this screen will be lost"
// text, which was false for this exact case. The mocked PlansWorkspace
// below calls onMarkupUnsavedChange(true) instead of useUnsavedGuard(true),
// standing in for "there's an unsynced or failed markup autosave batch"
// exactly the way useMarkupAutosave.ts's own status tracking does it for
// real.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';
import { UnsavedGuardProvider } from '../../contexts/UnsavedGuardContext';
import { ConfirmProvider } from '../../components/ConfirmDialog';

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

// A stand-in for the real PlansWorkspace that reports "unsaved markup
// work" via the SAME callback prop the real one uses
// (autosave.status === 'pending'/'saving'/'error') — without needing real
// sheets/pdf.js.
vi.mock('../estimating/plans/PlansWorkspace', () => ({
  default: ({ onMarkupUnsavedChange }: { onMarkupUnsavedChange?: (v: boolean) => void }) => {
    onMarkupUnsavedChange?.(true);
    return <div data-testid="plans-workspace-mock">Plans (unsaved markup work)</div>;
  },
}));

function mockApi() {
  get.mockImplementation((url: string) => {
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
    <ConfirmProvider>
      <UnsavedGuardProvider>
        <PcWorkspaceView ws={ws} bid={bid} onUpdate={() => {}} onBack={() => {}} onConverted={() => {}} onBidUpdated={() => {}} showToast={() => {}} embedded />
      </UnsavedGuardProvider>
    </ConfirmProvider>,
  );
}

describe('PcWorkspaceView — step/toggle navigation checks ONLY the markup-unsaved guard (Fix round 2 / R2-S2)', () => {
  it('clicking "List" while Plans has unsaved markup work shows the markup-specific confirm dialog instead of switching immediately', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'List' }));

    expect(screen.getByText('Unsaved plan markup')).toBeTruthy();
    // NOT the generic, pricing-implying wording from the global guard.
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy(); // still mounted — nothing switched yet
  });

  it('"Cancel" cancels the switch — Plans stays open', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Unsaved plan markup')).toBeNull();
    expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true');
  });

  it('"Leave anyway" proceeds — switches to List and unmounts Plans', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    fireEvent.click(screen.getByText('Leave anyway'));

    await waitFor(() => expect(screen.queryByTestId('plans-workspace-mock')).toBeNull());
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching to a DIFFERENT STEP (not just the List/Plans toggle) also routes through the markup guard', async () => {
    mockDesktopMatchMedia();
    mockApi();
    renderTakeoffStep();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plans' }));
    await waitFor(() => expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy());

    fireEvent.click(screen.getByTestId('est-step-pricing'));

    expect(screen.getByText('Unsaved plan markup')).toBeTruthy();
    expect(screen.getByTestId('plans-workspace-mock')).toBeTruthy(); // Takeoff/Plans still showing
  });

  // The genuine "nothing unsaved" case (autosave idle/saved ->
  // onMarkupUnsavedChange(false), no dialog at all) is covered at the
  // unit level in PlansWorkspace.test.tsx itself, where the REAL
  // autosave status drives the callback — this file's own mock always
  // reports true (module-level, not per-test), so it only exercises the
  // "something IS unsaved" path.
});
