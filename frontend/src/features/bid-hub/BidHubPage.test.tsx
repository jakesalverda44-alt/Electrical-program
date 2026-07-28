// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BidHubPage from './BidHubPage';
import api from '../../api/client';
import { Bid } from '../../types';

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
    expect(screen.getByText(/\$250k/i)).toBeTruthy();          // amount tile
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
});
