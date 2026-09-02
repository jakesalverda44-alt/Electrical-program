// @vitest-environment happy-dom
// Task 4 (phase 1 estimating chain): pricing state used to reset on refresh —
// estimateOverrides/overheadPct/profitPct were hardcoded back to {}/10/15 by
// App.tsx's restore block even when the saved bid_estimates row held the real
// values, and a takeoff category missing from the unit-cost library silently
// priced at $0 with no visible signal. This covers both fixes end to end
// through the rendered Pricing tab (the wrapper below mimics App.tsx: it holds
// `ws` in state and feeds onUpdate back in, the same round-trip a refresh does).
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid, BidEstimate, Toast } from '../../types';

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
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function mockApi(estimate: BidEstimate | null) {
  get.mockImplementation((url: string) => {
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: estimate });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url.startsWith('/documents?linked_id=')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

// Mirrors how App.tsx round-trips workspace state through onUpdate — a plain
// `onUpdate={() => {}}` no-op can't show hydration taking effect, since the
// rendered inputs are controlled off the `ws` prop.
function StatefulWrapper({ initialWs }: { initialWs: PcWorkspace }) {
  const [ws, setWs] = useState(initialWs);
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

function renderPricingTab() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'pricing' as const };
  return render(<StatefulWrapper initialWs={ws}/>);
}

describe('PcWorkspace Pricing tab — survives a refresh', () => {
  it('hydrates overhead %, profit %, and overrides from the saved estimate when local state is pristine', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 12,
      profit_pct: 22,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: true },
      ],
      subtotals: {}, total_direct: 350, total_overhead: 0, total_profit: 0, grand_total: 350,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    renderPricingTab();

    const overheadInput = await screen.findByDisplayValue('12') as HTMLInputElement;
    expect(overheadInput).toBeTruthy();
    const profitInput = await screen.findByDisplayValue('22') as HTMLInputElement;
    expect(profitInput).toBeTruthy();
  });

  it('does not overwrite an already-overridden overhead/profit local state (not pristine)', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 12,
      profit_pct: 22,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false },
      ],
      subtotals: {}, total_direct: 350, total_overhead: 0, total_profit: 0, grand_total: 350,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'pricing' as const, overheadPct: 8 };
    render(<StatefulWrapper initialWs={ws}/>);

    // Wait for the saved estimate to actually land and render (proof the fetch
    // resolved and the hydration effect had its chance to run), then confirm it
    // did NOT overwrite the pre-existing, non-pristine overheadPct.
    await screen.findByText('Wall Pack Fixture');
    await new Promise(r => setTimeout(r, 20));

    expect(screen.queryByDisplayValue('12')).toBeNull();
    expect((screen.getByDisplayValue('8') as HTMLInputElement)).toBeTruthy();
  });

  it('flags a zero-cost, non-overridden line item with a banner and count', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'FIRE ALARM', item: 'Pull Station', qty: 3, unit: 'EA', unit_cost: 0, total: 0, overridden: false },
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 150, total: 300, overridden: false },
      ],
      subtotals: {}, total_direct: 300, total_overhead: 0, total_profit: 0, grand_total: 300,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    renderPricingTab();

    await waitFor(() => expect(screen.getByText(/no unit cost/i)).toBeTruthy());
    expect(screen.getByText(/1 line item has no unit cost/i)).toBeTruthy();
  });

  it('does not flag a zero-cost item the estimator explicitly overrode to $0', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'FIRE ALARM', item: 'Pull Station', qty: 3, unit: 'EA', unit_cost: 0, total: 0, overridden: true },
      ],
      subtotals: {}, total_direct: 0, total_overhead: 0, total_profit: 0, grand_total: 0,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    renderPricingTab();

    await waitFor(() => expect(screen.getByText('Pull Station')).toBeTruthy());
    expect(screen.queryByText(/no unit cost/i)).toBeNull();
  });
});

// Task 5 (phase 2 takeoff fidelity): confidence survives to the estimator's
// screen — a FIRM/APPROX/VERIFY chip per row, a header count, and a
// VERIFY-count line added to the save toast.
function renderPricingTabWithToast(showToast: (t: Toast) => void) {
  const ws: PcWorkspace = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'pricing' as const };
  function Wrapper() {
    const [w, setW] = useState<PcWorkspace>(ws);
    return (
      <PcWorkspaceView
        ws={w}
        bid={bid}
        onUpdate={setW}
        onBack={() => {}}
        onConverted={() => {}}
        onBidUpdated={() => {}}
        showToast={showToast}
        embedded
      />
    );
  }
  return render(<Wrapper/>);
}

describe('PcWorkspace Pricing tab — confidence chips (Task 5)', () => {
  it('renders a FIRM chip for VERIFIED and an APPROX chip for ASSUMED, and a header count', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false, confidence: 'VERIFIED' },
        { category: 'BRANCH POWER', item: 'Duplex Receptacle', qty: 10, unit: 'EA', unit_cost: 25, total: 250, overridden: false, confidence: 'ASSUMED' },
        { category: 'LOW VOLTAGE', item: 'Data Cable', qty: 500, unit: 'LF', unit_cost: 1, total: 500, overridden: false, confidence: 'NOT SHOWN' },
      ],
      subtotals: {}, total_direct: 1100, total_overhead: 0, total_profit: 0, grand_total: 1100,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    renderPricingTab();

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    expect(screen.getByText('FIRM')).toBeTruthy();
    expect(screen.getByText('APPROX')).toBeTruthy();
    expect(screen.getByText('VERIFY')).toBeTruthy();
    // Header count: "1 FIRM · 1 APPROX · 1 VERIFY"
    expect(screen.getByText(/1 FIRM · 1 APPROX · 1 VERIFY/)).toBeTruthy();
  });

  it('renders no chip and no header count when no line item carries a recognizable confidence', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false },
      ],
      subtotals: {}, total_direct: 350, total_overhead: 0, total_profit: 0, grand_total: 350,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    renderPricingTab();

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    expect(screen.queryByText('FIRM')).toBeNull();
    expect(screen.queryByText('APPROX')).toBeNull();
    expect(screen.queryByText('VERIFY')).toBeNull();
    expect(screen.queryByText(/FIRM ·/)).toBeNull();
  });

  it('adds a VERIFY-count line to the save toast when VERIFY items are present', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'LOW VOLTAGE', item: 'Data Cable', qty: 500, unit: 'LF', unit_cost: 1, total: 500, overridden: false, confidence: 'NOT SHOWN' },
        { category: 'LOW VOLTAGE', item: 'Conduit', qty: 200, unit: 'LF', unit_cost: 2, total: 400, overridden: false, confidence: 'NOT SHOWN' },
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false, confidence: 'VERIFIED' },
      ],
      subtotals: {}, total_direct: 1250, total_overhead: 0, total_profit: 0, grand_total: 1250,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    put.mockResolvedValue({ data: { ...estimate, grand_total: 1250 } });
    const showToast = vi.fn();
    renderPricingTabWithToast(showToast);

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    fireEvent.click(screen.getByText('Save Estimate'));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    const call = showToast.mock.calls[showToast.mock.calls.length - 1][0];
    expect(call.title).toBe('Estimate saved');
    expect(call.sub).toMatch(/2 items need verification/);
  });

  it('does not mention verification in the save toast when no VERIFY items are present', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false, confidence: 'VERIFIED' },
      ],
      subtotals: {}, total_direct: 350, total_overhead: 0, total_profit: 0, grand_total: 350,
      comp_count: 0, confidence: 'LOW',
    };
    mockApi(estimate);
    put.mockResolvedValue({ data: { ...estimate, grand_total: 350 } });
    const showToast = vi.fn();
    renderPricingTabWithToast(showToast);

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    fireEvent.click(screen.getByText('Save Estimate'));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    const call = showToast.mock.calls[showToast.mock.calls.length - 1][0];
    expect(call.sub).not.toMatch(/verification/);
  });
});

// FIX-3 (post-review): computePricingItems short-circuited to
// savedEstimate.line_items whenever a saved estimate existed — old rows
// saved before confidence tracking existed have no `confidence` field, so
// chips/counts/toast never appeared and re-running the takeoff didn't help
// (this branch never looked at the fresh takeoff again). Confidence must be
// backfilled by category||item from a freshly-built takeoff, without ever
// overwriting a confidence value the saved row already carries.
function mockApiWithFreshTakeoff(estimate: BidEstimate | null, agent2Output: string) {
  get.mockImplementation((url: string) => {
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: estimate });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: { status: 'complete', agent2_output: agent2Output } });
    if (url.startsWith('/documents?linked_id=')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

describe('PcWorkspace Pricing tab — confidence backfill on a saved estimate (FIX-3)', () => {
  it('backfills a saved line item\'s missing confidence from a fresh agent2 takeoff, without overwriting a confidence the saved row already has', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        // Saved before confidence tracking existed — no `confidence` field at all.
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false },
        // Already carries its own confidence — must NOT be clobbered by the fresh takeoff's value.
        { category: 'BRANCH POWER', item: 'Duplex Receptacle', qty: 10, unit: 'EA', unit_cost: 25, total: 250, overridden: false, confidence: 'ASSUMED' },
      ],
      subtotals: {}, total_direct: 600, total_overhead: 0, total_profit: 0, grand_total: 600,
      comp_count: 0, confidence: 'LOW',
    };
    const agent2Output = JSON.stringify({
      takeoff: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', confidence: 'VERIFIED' },
        { category: 'BRANCH POWER', item: 'Duplex Receptacle', qty: 10, unit: 'EA', confidence: 'VERIFIED' },
      ],
    });
    mockApiWithFreshTakeoff(estimate, agent2Output);
    renderPricingTab();

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    // Backfilled from the fresh takeoff: VERIFIED -> FIRM chip.
    expect(screen.getByText('FIRM')).toBeTruthy();
    // Not overwritten: the saved row's own ASSUMED -> APPROX chip survives.
    expect(screen.getByText('APPROX')).toBeTruthy();
    expect(screen.getByText(/1 FIRM · 1 APPROX · 0 VERIFY/)).toBeTruthy();
  });

  it('leaves chips absent when the fresh takeoff has no matching row to backfill from', async () => {
    const estimate: BidEstimate = {
      bid_id: 'b1',
      overhead_pct: 10,
      profit_pct: 15,
      line_items: [
        { category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 2, unit: 'EA', unit_cost: 175, total: 350, overridden: false },
      ],
      subtotals: {}, total_direct: 350, total_overhead: 0, total_profit: 0, grand_total: 350,
      comp_count: 0, confidence: 'LOW',
    };
    // No agent2_output at all — nothing to backfill from.
    mockApiWithFreshTakeoff(estimate, '');
    renderPricingTab();

    await waitFor(() => expect(screen.getByText('Wall Pack Fixture')).toBeTruthy());
    expect(screen.queryByText('FIRM')).toBeNull();
    expect(screen.queryByText('APPROX')).toBeNull();
    expect(screen.queryByText('VERIFY')).toBeNull();
  });
});
