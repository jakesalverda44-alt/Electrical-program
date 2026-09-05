// @vitest-environment happy-dom
// Post-review B2 (Task 7, audit data #16) — the module-level unit-cost cache
// (useGlobalPcCache in PcWorkspace.tsx) was only ever consulted at mount; a
// workspace kept open across a Settings > Unit Costs save never learned
// about it and would keep pricing (and, on "Save Estimate", persisting)
// against the stale library. UnitCostSection's save now calls
// resetGlobalPcCaches(), which forces every mounted useGlobalPcCache
// instance to refetch immediately. This proves the full path: a save in
// UnitCostSection causes an already-open PcWorkspace pricing tab to refetch
// /estimates/unit-costs and re-price its line items against the new rate.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { UnitCostSection } from '../settings/sections/UnitCostSection';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid, User } from '../../types';
import { moneyFull } from '../../lib/money';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';

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
  id: 'b1', name: 'Cache Reprice Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

const AGENT2_OUTPUT = JSON.stringify({
  takeoff: [{ category: 'Service & Distribution', item: 'Panel', qty: 2, unit: 'EA' }],
});

function Harness() {
  const [ws, setWs] = useState<PcWorkspace>({
    ...blankWorkspace('b1', 'Cache Reprice Job', 0), step: 'estimate', activeTab: 'pricing',
  });
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

describe('Settings unit-cost save reprices an already-open PcWorkspace pricing tab (post-review B2)', () => {
  it('refetches /estimates/unit-costs and re-prices after the Settings save', async () => {
    let currentCostLib = { global: { 'Service & Distribution': 10 }, by_project_type: {} as Record<string, Record<string, number>> };

    get.mockImplementation((url: string) => {
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: currentCostLib });
      if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: { agent2_output: AGENT2_OUTPUT } });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url.includes('/takeoff')) return Promise.resolve({ data: null });
      if (url.includes('/intelligence/')) return Promise.resolve({ data: {} });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });
    put.mockImplementation((url: string, body: unknown) => {
      if (url === '/estimates/unit-costs') currentCostLib = body as typeof currentCostLib; // simulates a real backend
      return Promise.resolve({ data: {} });
    });
    del.mockResolvedValue({ data: {} });

    render(<Harness/>);
    // 2 EA @ $10 = $20, priced from buildLineItemsFromTakeoff via the initial
    // library — appears twice (the line item's own Total column and the
    // Summary panel's Total Direct Cost), so use getAllByText.
    await waitFor(() => expect(screen.getAllByText(moneyFull(20)).length).toBeGreaterThan(0));
    const initialGetCalls = get.mock.calls.filter(c => c[0] === '/estimates/unit-costs').length;
    expect(initialGetCalls).toBeGreaterThan(0);

    // A second, independent render — mirrors two different open browser tabs
    // (Settings and the estimating workspace) sharing the same module cache.
    const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };
    const settingsRender = render(
      <AppProviders user={user} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <UnitCostSection/>
      </AppProviders>,
    );
    // Two trees are mounted at once (PcWorkspaceView also has an Overhead %
    // input defaulting to "10"), so scope to UnitCostSection's own container.
    const rateInput = await within(settingsRender.container).findByDisplayValue('10') as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: '25' } });
    fireEvent.click(within(settingsRender.container).getByText('Save Changes'));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/estimates/unit-costs', expect.objectContaining({
      global: expect.objectContaining({ 'Service & Distribution': 25 }),
    })));

    // The still-mounted PcWorkspaceView must have refetched (not just relied
    // on its 5-minute TTL) and re-priced: 2 EA @ $25 = $50.
    await waitFor(() => expect(get.mock.calls.filter(c => c[0] === '/estimates/unit-costs').length).toBeGreaterThan(initialGetCalls));
    await waitFor(() => expect(screen.getAllByText(moneyFull(50)).length).toBeGreaterThan(0));
  });
});
