// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PlansJobProfilePanel from './PlansJobProfilePanel';
import { Bid } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
  },
}));

vi.mock('../../contexts/AppContext', () => ({
  useOptionalShowToast: () => vi.fn(),
  useShowToast: () => vi.fn(),
}));

const bid: Bid = {
  id: 'b1', name: 'Test Bid', gc: 'Some GC', loc: '—', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
} as unknown as Bid;

const PLAN_DOC = { id: 'doc-1', name: 'plans.pdf', display_name: 'plans.pdf', category: 'plans', file_type: 'application/pdf', page_count: 55 };

const PROFILE_RESPONSE = {
  profile: {
    brand: { value: 'AutoZone', sheet: 'Cover', quote: 'AUTOZONE, INC.', confidence: 'extracted' },
    store_number: { value: '10077', sheet: 'Cover', quote: 'Store No. FL10077', confidence: 'extracted' },
    sq_ft: { value: 7381, sheet: 'C1.1', quote: 'BLDG. AREA = 7,381 SQ. FT.', confidence: 'extracted' },
  },
  suggestions: {
    name: { value: 'AutoZone #10077 – Kissimmee, FL', sheet: null, quote: null, status: 'pending' },
  },
  sheet_summary: { total: 55, electrical: 6, missingRefs: 1 },
  cost_cents: 0,
  updated_at: '2026-09-24T00:00:00.000Z',
};

function mockDefaultApi() {
  get.mockImplementation((url: string) => {
    if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
    if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: PROFILE_RESPONSE });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: { bid } });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

describe('PlansJobProfilePanel', () => {
  it('shows the empty state when there are no plans yet', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: null });
      return Promise.resolve({ data: null });
    });
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/no plans on this bid yet/i)).toBeTruthy());
  });

  it('renders the plan file (with page count), the sheet summary, and the detected profile', async () => {
    mockDefaultApi();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);

    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());
    expect(screen.getByText('55 pg')).toBeTruthy();
    expect(screen.getByTestId('sheet-summary-line').textContent).toMatch(/55 sheets in set.*6 electrical.*1 missing ref/);
    expect(screen.getByTestId('detected-profile').textContent).toContain('AutoZone');
    expect(screen.getByTestId('detected-profile').textContent).toContain('10077');
    expect(screen.getByTestId('detected-profile').textContent).toContain('7,381 SF');
  });

  it('renders a pending suggestion chip and Accept applies it (and never sends a client-side value)', async () => {
    mockDefaultApi();
    const onBidUpdated = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={onBidUpdated} onGoEstimating={() => {}}/>);

    await waitFor(() => expect(screen.getByTestId('suggestion-accept-name')).toBeTruthy());
    expect(screen.getByTestId('job-profile-suggestions').textContent).toContain('AutoZone #10077 – Kissimmee, FL');

    fireEvent.click(screen.getByTestId('suggestion-accept-name'));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(`/preconstruction/${bid.id}/job-profile/suggestions/name`, { action: 'accept' });
    });
    await waitFor(() => expect(onBidUpdated).toHaveBeenCalledWith(bid));
  });

  it('Ignore dismisses a suggestion', async () => {
    mockDefaultApi();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);

    await waitFor(() => expect(screen.getByTestId('suggestion-ignore-name')).toBeTruthy());
    fireEvent.click(screen.getByTestId('suggestion-ignore-name'));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(`/preconstruction/${bid.id}/job-profile/suggestions/name`, { action: 'ignore' });
    });
  });

  it('dropping a file uploads it, runs the sheet check, then the job profile, in that order', async () => {
    mockDefaultApi();
    post.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: { id: 'doc-new' } });
      if (url === `/preconstruction/${bid.id}/sheet-check/run`) return Promise.resolve({ data: {} });
      if (url === `/preconstruction/${bid.id}/job-profile/run`) return Promise.resolve({ data: { bid } });
      return Promise.resolve({ data: {} });
    });
    const onBidUpdated = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={onBidUpdated} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());

    const file = new File(['%PDF-1.4'], 'new-plans.pdf', { type: 'application/pdf' });
    const dropzone = screen.getByText(/drop plan sheets here/i).closest('div') as HTMLElement;
    fireEvent.drop(dropzone!, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(post).toHaveBeenCalledWith('/documents', expect.anything(), expect.anything()));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/sheet-check/run`, { document_ids: ['doc-1', 'doc-new'] });
    });
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/job-profile/run`, { document_ids: ['doc-1', 'doc-new'] });
    });
    await waitFor(() => expect(onBidUpdated).toHaveBeenCalledWith(bid));
  });

  it('a sheet-check permission failure (403) does not block the job-profile run', async () => {
    mockDefaultApi();
    post.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: { id: 'doc-new' } });
      if (url === `/preconstruction/${bid.id}/sheet-check/run`) return Promise.reject({ response: { status: 403 } });
      if (url === `/preconstruction/${bid.id}/job-profile/run`) return Promise.resolve({ data: { bid } });
      return Promise.resolve({ data: {} });
    });
    const onBidUpdated = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={onBidUpdated} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());

    const file = new File(['%PDF-1.4'], 'new-plans.pdf', { type: 'application/pdf' });
    const dropzone = screen.getByText(/drop plan sheets here/i).closest('div') as HTMLElement;
    fireEvent.drop(dropzone!, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onBidUpdated).toHaveBeenCalledWith(bid));
  });

  it('"Open in Estimating" calls onGoEstimating', async () => {
    mockDefaultApi();
    const onGoEstimating = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={onGoEstimating}/>);
    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());
    fireEvent.click(screen.getByText(/open in estimating/i));
    expect(onGoEstimating).toHaveBeenCalledTimes(1);
  });
});
