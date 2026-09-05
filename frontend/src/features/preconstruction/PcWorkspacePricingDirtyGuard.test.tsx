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
