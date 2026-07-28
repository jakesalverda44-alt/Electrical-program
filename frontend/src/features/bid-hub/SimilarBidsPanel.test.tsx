// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SimilarBidsPanel from './SimilarBidsPanel';
import { moneyShort } from '../../lib/money';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../../api/client', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

describe('SimilarBidsPanel', () => {
  it('renders top rows with name, brand, $/SF, badge, and moneyShort amount', async () => {
    get.mockResolvedValue({
      data: {
        bid: { id: 'b1', brand: "Sonny's", project_type: 'car_wash' },
        comparables: [
          { id: 'c1', name: 'CW Tampa', stage: 'awarded', brand: "Sonny's", sq_ft: 4000, amount: '120000' },
          { id: 'c2', name: 'CW Ocala', stage: 'lost', brand: "Sonny's", sq_ft: 3500, amount: '98000' },
        ],
      },
    });
    render(<SimilarBidsPanel bidId="b1" onGoCompare={() => {}}/>);
    await waitFor(() => expect(screen.getByText('CW Tampa')).toBeTruthy());
    expect(screen.getByText('Won')).toBeTruthy();
    expect(screen.getByText('Lost')).toBeTruthy();
    expect(screen.getByText(/\$30\.00\/SF/)).toBeTruthy(); // 120000/4000
    expect(screen.getByText(moneyShort(120000))).toBeTruthy();
  });

  it('calls onGoCompare when the button is clicked', async () => {
    get.mockResolvedValue({
      data: { bid: { id: 'b1', brand: 'X', project_type: null }, comparables: [
        { id: 'c1', name: 'Job A', stage: 'due', brand: 'X', sq_ft: 1000, amount: '50000' },
      ] },
    });
    const onGoCompare = vi.fn();
    render(<SimilarBidsPanel bidId="b1" onGoCompare={onGoCompare}/>);
    await waitFor(() => expect(screen.getByText('Job A')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /compare in detail/i }));
    expect(onGoCompare).toHaveBeenCalled();
  });

  it('shows the brand/type nudge when the subject bid has neither classification', async () => {
    get.mockResolvedValue({ data: { bid: { id: 'b1', brand: null, project_type: null }, comparables: [] } });
    render(<SimilarBidsPanel bidId="b1" onGoCompare={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/set a brand or project type/i)).toBeTruthy());
  });

  it('shows the generic empty state when classified but no comps exist yet', async () => {
    get.mockResolvedValue({ data: { bid: { id: 'b1', brand: 'X', project_type: null }, comparables: [] } });
    render(<SimilarBidsPanel bidId="b1" onGoCompare={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/no comparable past bids yet/i)).toBeTruthy());
  });
});
