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

  it('ignores a stale comps-preview response after brand is cleared', async () => {
    let resolveStale: (v: unknown) => void = () => {};
    const stalePromise = new Promise(res => { resolveStale = res; });
    get.mockImplementation((url: string) =>
      url.includes('meta/brands') ? Promise.resolve({ data: [] }) : stalePromise
    );
    render(<AddBidModal onClose={() => {}} onAdded={() => {}}/>);
    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: 'Old Brand' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('comparables-preview')), { timeout: 2000 });

    // Clear the query before the in-flight request resolves.
    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: '' } });
    resolveStale({ data: { count: 3, won: 2, lost: 1, avgPerSf: 10, top: [] } });
    await new Promise(r => setTimeout(r, 50));

    expect(screen.queryByText(/similar past bids/i)).toBeNull();
  });
});
