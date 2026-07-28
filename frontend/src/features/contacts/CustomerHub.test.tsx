// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import CustomerHub from './CustomerHub';
import api from '../../api/client';
import { CustomerDetail } from '../../types';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const detail: CustomerDetail = {
  customer: { id: 'c1', name: 'ABC Builders', type: 'gc', company: 'ABC Builders' } as CustomerDetail['customer'],
  bids: [
    { id: 'b-due', name: 'Due Bid', gc: 'ABC Builders', loc: 'Ocala, FL', amount: 100000, due: '2026-08-01', stage: 'due' },
    { id: 'b-sub', name: 'Submitted Bid', gc: 'ABC Builders', loc: 'Ocala, FL', amount: 200000, due: null, stage: 'submitted' },
    { id: 'b-won', name: 'Awarded Bid', gc: 'ABC Builders', loc: 'Ocala, FL', amount: 300000, due: null, stage: 'awarded' },
    { id: 'b-lost', name: 'Lost Bid', gc: 'ABC Builders', loc: 'Ocala, FL', amount: 50000, due: null, stage: 'lost' },
  ] as unknown as CustomerDetail['bids'],
  gens: [],
  wonJobs: [],
  communications: [],
  documents: [
    { id: 'd-sheet', linked_id: null, linked_name: null, div: 'elec', name: 'plans.xlsx', display_name: 'Plans.xlsx', category: 'plans', file_size: 1000, file_type: '', uploaded_by: 'u', created_at: '2026-01-01' },
    { id: 'd-none', linked_id: null, linked_name: null, div: 'elec', name: 'note.txt', display_name: 'Note.txt', category: 'other', file_size: 200, file_type: 'text/plain', uploaded_by: 'u', created_at: '2026-01-01' },
  ],
  tasks: [],
};

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/customers/c1') return Promise.resolve({ data: detail });
    return Promise.resolve({ data: [] });
  });
  // happy-dom doesn't implement object URLs and its window.open tries to really
  // navigate — stub both so the download/view code paths don't throw/navigate.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('open', vi.fn(() => null));
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ blob: () => Promise.resolve(new Blob()), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
  ));
});

describe('CustomerHub stage grouping + hub links', () => {
  it('renders all four bid-stage sections in order: Open, Submitted, Awarded, Lost', async () => {
    render(<CustomerHub id="c1" onBack={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Due Bid')).toBeTruthy());

    // Order check: each heading should appear as a .panel-title, left-to-right/top-to-bottom.
    const order = ['Open Bids', 'Submitted Bids', 'Awarded Projects', 'Lost Bids'].map(t =>
      Array.from(document.querySelectorAll('.panel-title')).findIndex(el => el.textContent?.startsWith(t)),
    );
    expect(order.every(i => i >= 0)).toBe(true); // sanity: all four headers present
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(screen.getByText('Due Bid')).toBeTruthy();
    expect(screen.getByText('Submitted Bid')).toBeTruthy();
    expect(screen.getByText('Awarded Bid')).toBeTruthy();
    expect(screen.getByText('Lost Bid')).toBeTruthy();
  });

  it('clicking a submitted bid row calls onNav with its id', async () => {
    const onNav = vi.fn();
    render(<CustomerHub id="c1" onBack={() => {}} onNav={onNav}/>);
    await waitFor(() => expect(screen.getByText('Submitted Bid')).toBeTruthy());

    fireEvent.click(screen.getByText('Submitted Bid'));
    expect(onNav).toHaveBeenCalledWith('bid', 'b-sub');
  });

  it('clicking a lost bid row also calls onNav', async () => {
    const onNav = vi.fn();
    render(<CustomerHub id="c1" onBack={() => {}} onNav={onNav}/>);
    await waitFor(() => expect(screen.getByText('Lost Bid')).toBeTruthy());

    fireEvent.click(screen.getByText('Lost Bid'));
    expect(onNav).toHaveBeenCalledWith('bid', 'b-lost');
  });

  it('doc View on a spreadsheet opens the inline FilePreviewModal', async () => {
    render(<CustomerHub id="c1" onBack={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Plans.xlsx')).toBeTruthy());

    fireEvent.click(screen.getAllByTitle('View')[0]);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Plans.xlsx' })).toBeTruthy());
    expect(global.fetch).toHaveBeenCalledWith('/api/documents/d-sheet/view', expect.any(Object));
  });

  it('doc View on a non-previewable file falls back to download', async () => {
    render(<CustomerHub id="c1" onBack={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Note.txt')).toBeTruthy());

    fireEvent.click(screen.getAllByTitle('View')[1]);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/documents/d-none/download', expect.any(Object)));
    expect(screen.queryByRole('heading', { name: 'Note.txt' })).toBeFalsy();
  });
});
