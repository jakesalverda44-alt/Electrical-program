// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BidHubPage from './BidHubPage';
import api from '../../api/client';
import { Bid } from '../../types';
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
  pcData: {}, onPcUpdate: noop, onBidUpdated: noop, onNav: noop,
};

describe('BidHubPage', () => {
  it('renders bid name and five tabs', () => {
    render(<MemoryRouter><BidHubPage {...baseProps}/></MemoryRouter>);
    expect(screen.getByText('Sonnys Car Wash — Ocala')).toBeTruthy();
    for (const t of ['Overview', 'Estimating', 'Compare', 'Files', 'Activity']) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy();
    }
  });

  it('switches tab on click', () => {
    render(<MemoryRouter><BidHubPage {...baseProps}/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByTestId('hub-tab-files')).toBeTruthy();
  });

  it('shows not-found for unknown bid id', () => {
    render(<MemoryRouter><BidHubPage {...baseProps} bidId="nope"/></MemoryRouter>);
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });

  it('overview shows stat row and stage pills', () => {
    render(<MemoryRouter><BidHubPage {...baseProps}/></MemoryRouter>);
    expect(screen.getByText(moneyShort(250000))).toBeTruthy(); // amount tile
    expect(screen.getByRole('button', { name: /submitted/i })).toBeTruthy(); // stage pill
  });

  it('clicking the Lost stage pill shows the reason form and submits it in the stage PATCH', () => {
    render(<MemoryRouter><BidHubPage {...baseProps}/></MemoryRouter>);

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
    render(<MemoryRouter><BidHubPage {...baseProps} bids={[lostBid]} bidId="b2"/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

    fireEvent.change(screen.getByDisplayValue('Budget'), { target: { value: 'Competitor' } });
    fireEvent.change(screen.getByPlaceholderText('Competitor name'), { target: { value: 'Acme Electric' } });
    fireEvent.click(screen.getByRole('button', { name: /save details/i }));

    expect(api.patch).toHaveBeenCalledWith('/bids/b2/stage', { stage: 'lost', loss_reason: 'Competitor', competitor: 'Acme Electric' });
  });

  it('estimating tab mounts the workspace', () => {
    render(<MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><BidHubPage {...baseProps}/></MemoryRouter>);
    expect(screen.getByTestId('hub-tab-estimating')).toBeTruthy();
  });

  // Task 7 (audit data #16) — PcWorkspaceView is now rendered once per bid and
  // toggled with `hidden`, not mounted/unmounted per tab click.
  describe('estimating workspace stays mounted across tab switches', () => {
    it('switching tabs twice issues no new workspace requests', async () => {
      const get = vi.mocked(api.get);
      get.mockClear();
      render(<MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><BidHubPage {...baseProps}/></MemoryRouter>);

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
        <MemoryRouter initialEntries={['/bid/b1?tab=estimating']}><BidHubPage {...baseProps}/></MemoryRouter>
      );
      await new Promise(r => setTimeout(r, 0));
      unmount();

      render(
        <MemoryRouter initialEntries={['/bid/b2?tab=estimating']}>
          <BidHubPage {...baseProps} bids={[lostBid]} bidId="b2"/>
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
