// @vitest-environment happy-dom
// Post-review B4 (Task 11 + Task 7, audit batch 3) — bid_estimates.overhead_pct
// and profit_pct are Postgres `numeric` columns, which pg serializes as
// strings ("22.00"), not numbers. The pre-existing bid_estimates hydration
// effect used to store that string directly into ws.overheadPct, and the
// dirty check compared against the same string, so the two stayed
// (accidentally) consistent. Task 11's workspace hydration broke that by
// storing a real Number() — whichever of the two async sources won the race
// left ws.overheadPct as a genuine number compared against the saved
// estimate's *string*, so `!==` was always true and pricingDirty was
// permanently stuck on with zero user interaction, arming the unsaved-changes
// guard on every hub tab of every bid with autosaved pricing. Both sides are
// now Number()'d consistently.
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

function mockApi() {
  get.mockImplementation((url: string) => {
    // The real backend serializes numeric columns as strings — this is the
    // exact shape /estimates/:id actually returns, not a simplification.
    if (url === `/estimates/${bid.id}`) return Promise.resolve({
      data: {
        bid_id: bid.id, overhead_pct: '22.00', profit_pct: '15.00',
        line_items: [], subtotals: {}, total_direct: 0, total_overhead: 0, total_profit: 0, grand_total: 0,
        comp_count: 0, confidence: 'LOW', updated_at: '2026-09-01T00:00:00Z',
      },
    });
    if (url === `/preconstruction/${bid.id}/workspace`) return Promise.resolve({ data: null });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url.includes('/takeoff')) return Promise.resolve({ data: null });
    if (url.includes('/intelligence/')) return Promise.resolve({ data: {} });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

function Nav() {
  const confirmLeave = useConfirmLeave();
  return <button onClick={() => confirmLeave(() => { navigated = true; })}>Leave</button>;
}
let navigated = false;

// A real stateful parent — the hydration effect's set() calls (via onUpdate)
// must actually re-render PcWorkspaceView with the updated `ws`, exactly like
// the real BidHubPage owner does. A no-op onUpdate makes every hydration a
// silent, invisible no-op, which would make this test pass for the wrong
// reason (nothing ever changed) rather than proving the fix.
function Harness() {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Dirty Guard Job', 0), activeTab: 'overview' });
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

function renderWorkspace() {
  navigated = false;
  return render(
    <AppProviders user={user} showToast={(_t: Toast) => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <Nav/>
        <Harness/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

describe('PcWorkspace pricing dirty-check string/number normalization (post-review B4)', () => {
  it('hydrating from a saved estimate whose overhead_pct/profit_pct are numeric strings never arms the unsaved-changes guard with no interaction', async () => {
    mockApi();
    renderWorkspace();

    // Let the /estimates/:id fetch resolve and the hydration effect run.
    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/estimates/${bid.id}`)).toBe(true));
    // Give the hydration's own state update a tick to land.
    await new Promise(r => setTimeout(r, 50));

    fireEvent.click(screen.getByText('Leave'));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
    expect(navigated).toBe(true);
  });
});

// Re-review non-blocker (a) — the "estimate first, workspace only if
// strictly newer" priority rule is only actually deterministic once both
// /estimates/:id and /preconstruction/:id/workspace have resolved. Before
// this fix the hydration effect re-ran on every change to either value, so
// whichever one resolved *first* (if it carried real, non-default values)
// would hydrate immediately and flip `isPristine` false — permanently
// locking out the other source once it arrived, regardless of which one the
// priority rule actually says should win. These two tests pin both arrival
// orders against a single savedEstimate/workspaceRow pair with different
// `updated_at`s, and assert on the actually-rendered Overhead % input (not
// just the dirty-guard prompt, which cannot distinguish "correctly newer
// workspace" from "incorrectly locked-in stale workspace" — both look dirty
// against savedEstimate).
function renderWorkspacePricingTab() {
  navigated = false;
  function PricingHarness() {
    const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Dirty Guard Job', 0), activeTab: 'pricing' });
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
  return render(
    <AppProviders user={user} showToast={(_t: Toast) => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <Nav/>
        <PricingHarness/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

function overheadInputValue(): string {
  const label = screen.getByText('Overhead %');
  const input = label.parentElement!.querySelector('input') as HTMLInputElement;
  return input.value;
}

const SAVED_LINE_ITEMS = [
  { category: 'Devices', item: 'Duplex Receptacle', qty: 10, unit: 'ea', unit_cost: 25, total: 250, overridden: false },
];

function mockApiWithTiming(opts: {
  estimateDelayMs: number; estimateOverheadPct: string; estimateUpdatedAt: string;
  workspaceDelayMs: number; workspaceOverheadPct: string; workspaceUpdatedAt: string;
}) {
  get.mockImplementation((url: string) => {
    if (url === `/estimates/${bid.id}`) return new Promise(resolve => setTimeout(() => resolve({
      data: {
        bid_id: bid.id, overhead_pct: opts.estimateOverheadPct, profit_pct: '15.00',
        line_items: SAVED_LINE_ITEMS, subtotals: {}, total_direct: 0, total_overhead: 0, total_profit: 0, grand_total: 0,
        comp_count: 0, confidence: 'LOW', updated_at: opts.estimateUpdatedAt,
      },
    }), opts.estimateDelayMs));
    if (url === `/preconstruction/${bid.id}/workspace`) return new Promise(resolve => setTimeout(() => resolve({
      data: {
        overhead_pct: opts.workspaceOverheadPct, profit_pct: '20.00', estimate_overrides: {},
        updated_at: opts.workspaceUpdatedAt,
      },
    }), opts.workspaceDelayMs));
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url.includes('/takeoff')) return Promise.resolve({ data: null });
    if (url.includes('/intelligence/')) return Promise.resolve({ data: {} });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

describe('PcWorkspace pricing hydration — arrival order cannot defeat the priority rule (re-review non-blocker a)', () => {
  it('workspace resolves first but is OLDER than the estimate — the estimate still wins once both have settled', async () => {
    mockApiWithTiming({
      workspaceDelayMs: 0, workspaceOverheadPct: '30.00', workspaceUpdatedAt: '2026-08-01T00:00:00Z',
      estimateDelayMs: 40, estimateOverheadPct: '22.00', estimateUpdatedAt: '2026-09-01T00:00:00Z',
    });
    renderWorkspacePricingTab();

    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/preconstruction/${bid.id}/workspace`)).toBe(true));
    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/estimates/${bid.id}`)).toBe(true));
    await waitFor(() => expect(overheadInputValue()).toBe('22'));
  });

  it('workspace resolves last but is NEWER than the estimate — the workspace still wins once both have settled', async () => {
    mockApiWithTiming({
      estimateDelayMs: 0, estimateOverheadPct: '22.00', estimateUpdatedAt: '2026-08-01T00:00:00Z',
      workspaceDelayMs: 40, workspaceOverheadPct: '30.00', workspaceUpdatedAt: '2026-09-01T00:00:00Z',
    });
    renderWorkspacePricingTab();

    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/estimates/${bid.id}`)).toBe(true));
    await waitFor(() => expect(get.mock.calls.some(c => c[0] === `/preconstruction/${bid.id}/workspace`)).toBe(true));
    await waitFor(() => expect(overheadInputValue()).toBe('30'));
  });
});
