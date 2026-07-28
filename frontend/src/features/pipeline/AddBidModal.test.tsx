// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AddBidModal from './AddBidModal';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../../api/client', () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));

describe('AddBidModal comps preview', () => {
  it('shows summary once brand entered', async () => {
    get.mockImplementation((url: string) =>
      url.includes('meta/brands')
        ? Promise.resolve({ data: ["Sonny's"] })
        : Promise.resolve({ data: { count: 3, won: 2, lost: 1, avgPerSf: 28.4, top: [
            { id: 'x', name: 'CW Tampa', brand: "Sonny's", project_type: 'car_wash', sq_ft: 4200, amount: 119000, stage: 'awarded' },
          ] } }));
    render(<AddBidModal onClose={() => {}} onAdded={() => {}}/>);
    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Sonny's" } });
    await waitFor(() => expect(screen.getByText(/3 similar past bids/i)).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText(/\$28\.40\/SF/)).toBeTruthy();
    expect(screen.getByText(/2 won/)).toBeTruthy();
  });
});
