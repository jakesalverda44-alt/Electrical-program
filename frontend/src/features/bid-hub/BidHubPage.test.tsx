// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BidHubPage from './BidHubPage';
import api from '../../api/client';
import { Bid } from '../../types';
import { PcWorkspace } from '../preconstruction/constants';
import { moneyShort } from '../../lib/money';
import { __resetGlobalPcCachesForTests } from '../preconstruction/PcWorkspace';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => vi.fn(),
  useOptionalShowToast: () => vi.fn(),
  useUser: () => ({ id: 'u1', name: 'Test User', email: 't@example.com', role: 'estimator' }),
  useSettings: () => ({ settings: {}, reloadSettings: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(api.patch).mockClear();
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

const bid: Bid = {
  id: 'b1', name: 'Sonnys Car Wash — Ocala', gc: 'ABC Builders', loc: 'Ocala, FL',
  amount: 250000, due: null, stage: 'due', sheets: null,
} as unknown as Bid;

const lostBid: Bid = {
  id: 'b2', name: 'Ocala Self-Storage', gc: 'XYZ GC', loc: 'Ocala, FL',
  amount: 100000, due: null, stage: 'lost', sheets: null, loss_reason: 'Budget', competitor: '',
} as unknown as Bid;

const noop = () => {};
const baseProps = {
  bidId: 'b1', bids: [bid], setBids: noop as never, setWonJobs: noop as never,
  onBidUpdated: noop, onNav: noop,
};

// Post-review B4 — pcData must be real state, not a `noop` sink: BidHubPage
// only seeds a blank workspace (and only mounts PcWorkspaceView at all) once
// pcDataLoaded is true, via a real onPcUpdate call. A `noop` onPcUpdate made
// every one of these tests silently stuck showing the "Loading workspace…"
// placeholder forever. `pcDataLoaded` defaults to true here (the list has
// "already settled and found nothing" — the common case these tests are
// about); the loading-gate itself is tested separately below.
function Harness(props: {
  bidId: string; bids: Bid[]; pcDataLoaded?: boolean;
  initialPcData?: Record<string, PcWorkspace>;
}) {
  const [pcData, setPcData] = useState<Record<string, PcWorkspace>>(props.initialPcData ?? {});
  return (
    <BidHubPage
      {...baseProps}
      bidId={props.bidId}
      bids={props.bids}
      pcData={pcData}
      onPcUpdate={(id, ws) => setPcData(prev => ({ ...prev, [id]: ws }))}
      pcDataLoaded={props.pcDataLoaded ?? true}
    />
  );
}

describe('BidHubPage', () => {
  it('renders bid name and five tabs', () => {
    render(<MemoryRouter><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);
    expect(screen.getByText('Sonnys Car Wash — Ocala')).toBeTruthy();
    for (const t of ['Overview', 'Estimating', 'Compare', 'Files', 'Activity']) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy();
    }
  });

  it('switches tab on click', () => {
    render(<MemoryRouter><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('hub-tab-files')).toBeTruthy();
  });

  it('shows not-found for unknown bid id', () => {
    render(<MemoryRouter><Harness bidId="nope" bids={[bid]}/></MemoryRouter>);
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });

  it('overview shows stat row and stage pills', () => {
    render(<MemoryRouter><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);
    expect(screen.getByText(moneyShort(250000))).toBeTruthy(); // amount tile
    expect(screen.getByRole('button', { name: /submitted/i })).toBeTruthy(); // stage pill
  });

  it('clicking the Lost stage pill shows the reason form and submits it in the stage PATCH', () => {
    render(<MemoryRouter><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);

    // First click on "Lost" triggers the confirmation gate — no PATCH yet.
    fireEvent.click(screen.getByRole('button', { name: 'Lost' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText(/mark this bid as lost/i)).toBeTruthy();

    // Pick a reason (defaults to "Budget") and confirm.
    fireEvent.change(screen.getByDisplayValue('Budget'), { target: { value: 'Timeline' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm lost/i }));

    expect(api.patch).toHaveBeenCalledWith('/bids/b1/stage', expect.objectContaining({ stage: 'lost', loss_reason: 'Timeline' }));
  });

  it('Activity tab lost-details editor PATCHes the stage endpoint with loss_reason/competitor', () => {
    render(<MemoryRouter><Harness bidId="b2" bids={[lostBid]}/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    fireEvent.change(screen.getByDisplayValue('Budget'), { target: { value: 'Competitor' } });
    fireEvent.change(screen.getByPlaceholderText('Competitor name'), { target: { value: 'Acme Electric' } });
    fireEvent.click(screen.getByRole('button', { name: /save details/i }));

    expect(api.patch).toHaveBeenCalledWith('/bids/b2/stage', { stage: 'lost', loss_reason: 'Competitor', competitor: 'Acme Electric' });
  });

  it('estimating tab mounts the workspace', () => {
    render(<MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);
    expect(screen.getByTestId('hub-tab-estimating')).toBeTruthy();
  });

  // Post-review B4 — the loading-gate itself: pcDataLoaded=false must never
  // let PcWorkspaceView mount on a synthetic blankWorkspace().
  describe('the estimating tab does not mount until pcData is actually loaded (post-review B4)', () => {
    it('shows a loading placeholder, not the workspace, while pcDataLoaded is false', () => {
      render(
        <MemoryRouter initialEntries={['/bid/b1?tab=estimating']}>
          <Harness bidId="b1" bids={[bid]} pcDataLoaded={false}/>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('hub-tab-estimating-loading')).toBeTruthy();
      expect(screen.queryByTestId('hub-tab-estimating')).toBeNull();
    });

    it('the guard does not fire from Overview on a clean bid — pcDataLoaded=false never seeds a blank workspace behind the scenes', () => {
      render(
        <MemoryRouter initialEntries={['/bid/b1?tab=overview']}>
          <Harness bidId="b1" bids={[bid]} pcDataLoaded={false}/>
        </MemoryRouter>,
      );
      // Overview tab is showing (the default), and nothing about it should
      // ever touch PcWorkspaceView while the workspace list hasn't settled.
      expect(screen.getByTestId('hub-tab-overview')).toBeTruthy();
      expect(screen.queryByTestId('hub-tab-estimating')).toBeNull();
    });

    it('no PUT (autosave) fires while pcData for the bid is absent', async () => {
      const put = vi.mocked(api.put);
      put.mockClear();
      render(
        <MemoryRouter initialEntries={['/bid/b1?tab=estimating']}>
          <Harness bidId="b1" bids={[bid]} pcDataLoaded={false}/>
        </MemoryRouter>,
      );
      await new Promise(r => setTimeout(r, 900)); // past the 800ms autosave debounce
      expect(put).not.toHaveBeenCalled();
    });

    it('mounts the real workspace once pcData for the bid arrives, seeded from a genuine saved row (not blank)', () => {
      const savedWs: PcWorkspace = {
        bidId: 'b1', bidName: bid.name, amount: bid.amount ?? 0, step: 'estimate', activeTab: 'overview',
        notes: 'Real saved notes', scope: {}, rfis: [], files: [], aiDone: false, proposalGenerated: false,
        aiRunning: false, aiLog: [], estimateOverrides: {}, overheadPct: 10, profitPct: 15,
      };
      render(
        <MemoryRouter initialEntries={['/bid/b1?tab=estimating']}>
          <Harness bidId="b1" bids={[bid]} pcDataLoaded={true} initialPcData={{ b1: savedWs }}/>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('hub-tab-estimating')).toBeTruthy();
      expect(screen.queryByTestId('hub-tab-estimating-loading')).toBeNull();
    });
  });

  // Task 7 (audit data #16) — PcWorkspaceView is now rendered once per bid and
  // toggled with `hidden`, not mounted/unmounted per tab click.
  describe('estimating workspace stays mounted across tab switches', () => {
    it('switching tabs twice issues no new workspace requests', async () => {
      const get = vi.mocked(api.get);
      get.mockClear();
      render(<MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><Harness bidId="b1" bids={[bid]}/></MemoryRouter>);

      // Bid-scoped calls PcWorkspaceView's mount fires (a subset of its seven —
      // enough to prove "did it refetch", without pinning every URL).
      const workspaceCalls = () => get.mock.calls.filter(c =>
        typeof c[0] === 'string' && (c[0].includes('/takeoff') || c[0].includes('/intelligence/'))
      );
      await new Promise(r => setTimeout(r, 0)); // let the mount-time effects fire
      const afterMount = workspaceCalls().length;
      expect(afterMount).toBeGreaterThan(0);

      // getAllByRole(...)[0]: PcWorkspaceView is now always mounted, and its own
      // internal tab bar (PC_TABS in constants.ts) has its own "Overview" button
      // too — the Hub's own tab bar renders first in DOM order, so index 0 is it.
      const hubOverviewBtn = () => screen.getAllByRole('button', { name: 'Overview' })[0];
      const hubEstimatingBtn = () => screen.getByRole('button', { name: 'Estimating' });
      fireEvent.click(hubOverviewBtn());
      fireEvent.click(hubEstimatingBtn());
      fireEvent.click(hubOverviewBtn());
      fireEvent.click(hubEstimatingBtn());
      await new Promise(r => setTimeout(r, 0));

      expect(workspaceCalls().length).toBe(afterMount);
      // hidden, not unmounted — the tab's content is still in the DOM the whole time.
      expect(screen.getByTestId('hub-tab-estimating')).toBeTruthy();
    });
  });

  // Task 7 (audit data #16) — /preconstruction/costs and /estimates/unit-costs
  // are hoisted into a module-level cache shared across every PcWorkspace
  // instance, so opening a second bid's estimating tab must not refetch them.
  describe('global preconstruction endpoints are session-cached across bids', () => {
    it('/preconstruction/costs and /estimates/unit-costs are each requested once across two bids', async () => {
      __resetGlobalPcCachesForTests(); // other tests in this file may have already warmed the cache
      const get = vi.mocked(api.get);
      get.mockClear();

      const { unmount } = render(
        <MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><Harness bidId="b1" bids={[bid]}/></MemoryRouter>
      );
      await new Promise(r => setTimeout(r, 0));
      unmount();

      render(
        <MemoryRouter initialEntries={['/bid/b2?tab=estimating']}>
          <Harness bidId="b2" bids={[lostBid]}/>
        </MemoryRouter>
      );
      await new Promise(r => setTimeout(r, 0));

      const costsCalls = get.mock.calls.filter(c => c[0] === '/preconstruction/costs');
      const unitCostCalls = get.mock.calls.filter(c => c[0] === '/estimates/unit-costs');
      expect(costsCalls.length).toBe(1);
      expect(unitCostCalls.length).toBe(1);
    });
  });
});
