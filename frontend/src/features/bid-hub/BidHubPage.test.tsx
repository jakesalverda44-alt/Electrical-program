// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BidHubPage from './BidHubPage';
import { Bid } from '../../types';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));

const bid: Bid = {
  id: 'b1', name: 'Sonnys Car Wash — Ocala', gc: 'ABC Builders', loc: 'Ocala, FL',
  amount: 250000, due: null, stage: 'due', sheets: null,
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
});
