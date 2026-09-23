// @vitest-environment happy-dom
// Task 9 (estimating redesign) — PricingTab (and the bid_estimates/
// bid_workspaces hydration race this file used to guard, between
// overhead_pct/profit_pct sourced from two different endpoints) is retired;
// the Labor & Pricing step now has a single source of truth
// (GET /api/estimating/:bidId, via useEstimatingBid) with no analogous race.
// This file now covers the NEW dirty-guard integration Task 9 asked for:
// unsaved Labor & Pricing edits arm the same useUnsavedGuard/useConfirmLeave
// mechanism PricingTab used to, and Save clears it — "leaving with unsaved
// pricing prompts the same way it does today," per the plan.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { AppProviders } from '../../contexts/AppContext';
import { UnsavedGuardProvider, useConfirmLeave } from '../../contexts/UnsavedGuardContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Bid, Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'Dirty Guard Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};
const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };

const ESTIMATING_LINE = {
  id: 'l1', category: 'Branch Power', description: 'Duplex receptacle', qty: 10, unit: 'EA', source: 'manual' as const,
};
const ESTIMATING_SETTINGS = {
  labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
  supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3,
  floors_above_2: 0,
};
const EMPTY_TOTALS = {
  materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0,
  smallTools: 0, directCost: 0, overhead: 0, profit: 0, grandTotal: 0, sellPerSf: null, crewWeeks: 0,
};
const EMPTY_WARNINGS = { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0 };

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url === `/estimating/${bid.id}`) return Promise.resolve({
      data: {
        lines: [ESTIMATING_LINE], settings: ESTIMATING_SETTINGS,
        recap: { lines: [], categories: [], totals: EMPTY_TOTALS, warnings: EMPTY_WARNINGS },
        proposed: false,
      },
    });
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
    if (url === `/preconstruction/${bid.id}/workspace`) return Promise.resolve({ data: null });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url.includes('/takeoff')) return Promise.resolve({ data: null });
    if (url.includes('/intelligence/')) return Promise.resolve({ data: {} });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === '/estimating/library') return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
    if (url.includes('/comparables')) return Promise.resolve({ data: { comparables: [] } });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockImplementation((url: string) => {
    if (url === `/estimating/${bid.id}`) return Promise.resolve({
      data: { recap: { lines: [], categories: [], totals: EMPTY_TOTALS, warnings: EMPTY_WARNINGS } },
    });
    return Promise.resolve({ data: {} });
  });
  del.mockResolvedValue({ data: {} });
}

function Nav() {
  const confirmLeave = useConfirmLeave();
  return <button onClick={() => confirmLeave(() => { navigated = true; })}>Leave</button>;
}
let navigated = false;

function Harness({ initialStep }: { initialStep: 'pricing' | 'overview' }) {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Dirty Guard Job', 0), activeTab: initialStep });
  return (
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={setWs}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />
  );
}

// Not findByDisplayValue('10') — the settings row's Overhead % field ALSO
// defaults to displayValue "10" (ESTIMATING_SETTINGS.overhead_pct), which
// made an earlier version of this file's qty edit non-deterministically land
// on the wrong input. Target the qty cell unambiguously via its data-field.
async function findQtyInput(): Promise<HTMLInputElement> {
  const row = await screen.findByTestId('lp-row-0');
  return row.querySelector('input[data-field="qty"]') as HTMLInputElement;
}

function renderWorkspace(initialStep: 'pricing' | 'overview' = 'pricing') {
  navigated = false;
  return render(
    <AppProviders user={user} showToast={(_t: Toast) => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <Nav/>
        <Harness initialStep={initialStep}/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

describe('Labor & Pricing dirty-guard (Task 9)', () => {
  it('does not arm the unsaved-changes guard on load, before any edit', async () => {
    mockApi();
    renderWorkspace();
    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/estimating/${bid.id}`)).toBe(true));
    await new Promise(r => setTimeout(r, 50));

    fireEvent.click(screen.getByText('Leave'));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(navigated).toBe(true);
  });

  it('arms the unsaved-changes guard once a Labor & Pricing line is edited', async () => {
    mockApi();
    renderWorkspace();
    const qtyInput = await findQtyInput();
    fireEvent.change(qtyInput, { target: { value: '20' } });

    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('You have unsaved changes')).toBeTruthy();
    expect(navigated).toBe(false);
  });

  it('clears the guard once the edit is saved', async () => {
    mockApi();
    renderWorkspace();
    const qtyInput = await findQtyInput();
    fireEvent.change(qtyInput, { target: { value: '20' } });

    fireEvent.click(screen.getByTestId('lp-save-button'));
    await waitFor(() => expect(put).toHaveBeenCalledWith(`/estimating/${bid.id}`, expect.objectContaining({
      lines: expect.arrayContaining([expect.objectContaining({ qty: 20 })]),
    })));

    fireEvent.click(screen.getByText('Leave'));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(navigated).toBe(true);
  });

  it('R2-B3: a bid whose bid_workspaces pricing diverges from bid_estimates does NOT arm the leave prompt', async () => {
    // The deleted `pricingDirty` guard compared ws.overheadPct/profitPct
    // (hydrated from whichever of bid_estimates/bid_workspaces was newer)
    // against bid_estimates directly — any divergence between the two rows
    // (a real, ordinary situation once bid_workspaces stopped being the
    // thing that gets edited) used to arm an un-clearable leave prompt with
    // no unsaved Labor & Pricing edit in sight. bid_estimates OH 14 /
    // bid_workspaces OH 12 (newer) is exactly the round-2 review's
    // reproduction.
    get.mockImplementation((url: string) => {
      if (url === `/estimating/${bid.id}`) return Promise.resolve({
        data: {
          lines: [ESTIMATING_LINE], settings: ESTIMATING_SETTINGS,
          recap: { lines: [], categories: [], totals: EMPTY_TOTALS, warnings: EMPTY_WARNINGS },
          proposed: false,
        },
      });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({
        data: { overhead_pct: 14, profit_pct: 20, line_items: [], grand_total: 1000, updated_at: '2026-01-01T00:00:00Z' },
      });
      if (url === `/preconstruction/${bid.id}/workspace`) return Promise.resolve({
        data: { overhead_pct: 12, profit_pct: 18, estimate_overrides: {}, updated_at: '2026-06-01T00:00:00Z' },
      });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url.includes('/takeoff')) return Promise.resolve({ data: null });
      if (url.includes('/intelligence/')) return Promise.resolve({ data: {} });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === '/estimating/library') return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      if (url.includes('/comparables')) return Promise.resolve({ data: { comparables: [] } });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });
    put.mockResolvedValue({ data: {} });
    del.mockResolvedValue({ data: {} });

    renderWorkspace();
    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/estimating/${bid.id}`)).toBe(true));
    await new Promise(r => setTimeout(r, 50));

    fireEvent.click(screen.getByText('Leave'));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(navigated).toBe(true);
  });
});
