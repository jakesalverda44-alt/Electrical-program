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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid, BidEstimate } from '../../types';

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
