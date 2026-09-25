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
  status: 'complete',
  profile: {
    brand: { value: 'AutoZone', sheet: 'C0.1', quote: 'AutoZone Store No. FL10077', confidence: 'high', validated: true },
    project_type: { value: 'retail', sheet: 'C0.1', quote: 'AutoZone Store No. FL10077', confidence: 'high', validated: true },
    store_number: { value: '10077', sheet: 'E-1', quote: 'AutoZone Store No. 10077', confidence: 'high', validated: true },
    sq_ft: { value: 7381, sheet: 'C2.1', quote: 'BUILDING AREA: | 7,381 S.F.', confidence: 'high', validated: true, label: 'building' },
    plan_date: { value: '2025-09-22', sheet: 'E-1', quote: '09/22/2025', confidence: 'high', validated: true },
    prototype: { value: '7N2-L', sheet: 'E-1', quote: '7N2-L', confidence: 'medium', validated: true },
  },
  fills: { brand: { value: 'AutoZone', status: 'filled' }, store_number: { value: '10077', status: 'filled' } },
  suggestions: {
    name: { value: 'AutoZone #10077 – Kissimmee, FL', sheet: null, quote: null, status: 'pending' },
    prototype: { value: '7N2-L', sheet: 'E-1', quote: '7N2-L', status: 'pending', confidence: 'medium', notes: ['a brand prototype code'] },
  },
  systems: {
    fuel: { value: null, sheet: null, quote: null },
    site_lighting: { value: true, sheet: 'E-7', quote: 'SITE LIGHTING PLAN' },
    fire_alarm: { value: null, sheet: null, quote: null },
    generator: { value: false, sheet: 'E-1', quote: 'NO GENERATOR' },
    ev: { value: null, sheet: null, quote: null },
  },
  rejected: [{ field: 'architect', value: 'CPH, INC.', sheet: 'C0.1', reason: 'a landscape / civil / structural consultant, not the architect' }],
  sheet_summary: { status: 'complete', total: 55, electrical: 6, missingRefs: 1 },
  cost_cents: 1.29,
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

  it('dropping a file files it as a plan document, then asks the server to read the current plan set', async () => {
    mockDefaultApi();
    post.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: { id: 'doc-new' } });
      if (url === `/preconstruction/${bid.id}/job-profile/run`) return Promise.resolve({ data: { ...PROFILE_RESPONSE, bid } });
      return Promise.resolve({ data: {} });
    });
    const onBidUpdated = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={onBidUpdated} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());

    const file = new File(['%PDF-1.4'], 'new-plans.pdf', { type: 'application/pdf' });
    const dropzone = screen.getByText(/drop plan sheets here/i).closest('div') as HTMLElement;
    fireEvent.drop(dropzone!, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(post).toHaveBeenCalledWith('/documents', expect.anything(), expect.anything()));
    const fd = post.mock.calls.find(c => c[0] === '/documents')![1] as FormData;
    expect(fd.get('category')).toBe('plans');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/job-profile/run`, {}));
    // The server starts the sheet check itself when it needs one.
    expect(post).not.toHaveBeenCalledWith(`/preconstruction/${bid.id}/sheet-check/run`, expect.anything());
    await waitFor(() => expect(onBidUpdated).toHaveBeenCalledWith(bid));
  });

  it('while the sheet check runs (202 waiting) it polls until the profile is done, then updates the card', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let gets = 0;
      get.mockImplementation((url: string) => {
        if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
        if (url === `/preconstruction/${bid.id}/job-profile`) {
          gets++;
          if (gets === 1) return Promise.resolve({ data: { status: 'idle', profile: {}, suggestions: {} } });
          if (gets === 2) return Promise.resolve({ data: { status: 'running', profile: {}, suggestions: {}, sheet_summary: { status: 'complete', total: 55, electrical: 8, missingRefs: 0 } } });
          return Promise.resolve({ data: { ...PROFILE_RESPONSE, bid: { ...bid, brand: 'AutoZone' } } });
        }
        return Promise.resolve({ data: null });
      });
      post.mockResolvedValue({ status: 202, data: { status: 'waiting', profile: {}, suggestions: {}, sheet_summary: { status: 'running', total: 0, electrical: 0, missingRefs: 0 } } });
      const onBidUpdated = vi.fn();
      render(<PlansJobProfilePanel bid={bid} onBidUpdated={onBidUpdated} onGoEstimating={() => {}}/>);
      fireEvent.click(await screen.findByTestId('read-plans'));
      await waitFor(() => expect(screen.getByTestId('job-profile-status').textContent).toMatch(/sheet check/i));
      expect(screen.getByTestId('sheet-summary-line').textContent).toMatch(/sheet check running/i);
      await vi.advanceTimersByTimeAsync(2600);
      await waitFor(() => expect(screen.getByTestId('job-profile-status').textContent).toMatch(/reading the cover/i));
      await vi.advanceTimersByTimeAsync(2600);
      await waitFor(() => expect(onBidUpdated).toHaveBeenCalledWith(expect.objectContaining({ brand: 'AutoZone' })));
      expect(screen.queryByTestId('job-profile-status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows labels, not codes; dates without the time; systems; confidence; and the values not used', async () => {
    mockDefaultApi();
    const withCard = { ...bid, plan_date: '2025-12-03T05:00:00.000Z', project_type: 'cstore_fuel' } as unknown as Bid;
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: { ...PROFILE_RESPONSE, suggestions: {
        ...PROFILE_RESPONSE.suggestions,
        plan_date: { value: '2025-09-22', sheet: 'E-1', quote: '09/22/2025', status: 'pending', confidence: 'high' },
        project_type: { value: 'retail', sheet: 'C0.1', quote: 'q', status: 'pending', confidence: 'high' },
      } } });
      return Promise.resolve({ data: null });
    });
    render(<PlansJobProfilePanel bid={withCard} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByTestId('detected-profile')).toBeTruthy());
    expect(screen.getByTestId('detected-project_type').textContent).toContain('Retail');
    expect(screen.getByTestId('detected-project_type').textContent).not.toContain('retail (');
    expect(screen.getByTestId('detected-brand').textContent).toContain('filled');
    expect(screen.getByTestId('detected-prototype').textContent).toContain('medium confidence');
    const chips = screen.getByTestId('job-profile-suggestions').textContent!;
    expect(chips).toContain('09/22/2025');
    expect(chips).toContain('12/03/2025');
    expect(chips).not.toMatch(/T05:00/);
    expect(chips).toContain('C-Store w/ Fuel');
    expect(chips).not.toContain('cstore_fuel');
    expect(chips).toContain('medium confidence — a brand prototype code');
    expect(screen.getByTestId('system-site_lighting').textContent).toBe('Site lighting: yes (E-7)');
    expect(screen.getByTestId('system-generator').textContent).toBe('Generator: no');
    expect(screen.getByTestId('system-fuel').textContent).toBe('Fuel: not shown');
    expect(screen.getByTestId('job-profile-rejected').textContent).toContain('CPH, INC.');
  });

  it('a scanned set says it could not determine the job', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: { status: 'undetermined', undetermined_reason: 'The plans have no text layer and the sheet images could not be read.', profile: {}, suggestions: {} } });
      return Promise.resolve({ data: null });
    });
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByTestId('job-profile-undetermined').textContent).toMatch(/couldn't determine the job.*no text layer.*nothing on the card was changed/i));
  });

  it('"Open in Estimating" calls onGoEstimating', async () => {
    mockDefaultApi();
    const onGoEstimating = vi.fn();
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={onGoEstimating}/>);
    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());
    fireEvent.click(screen.getByText(/open in estimating/i));
    expect(onGoEstimating).toHaveBeenCalledTimes(1);
  });

  it('R2-B2 — while waiting, "Read the plans again" is still offered and forces a fresh read', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: { status: 'waiting', profile: {}, suggestions: {} } });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: { status: 'waiting', profile: {}, suggestions: {} } });
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    const btn = await screen.findByTestId('read-plans');
    expect(btn.textContent).toBe('Read the plans again');
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/job-profile/run`, { force: true }));
  });

  it('R2-B2 — an expired run shows the error and the re-read button', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: { status: 'error', error: 'The plans took too long to read — read them again.', profile: {}, suggestions: {} } });
      return Promise.resolve({ data: null });
    });
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    await waitFor(() => expect(screen.getByTestId('job-profile-error').textContent).toMatch(/too long/));
    expect(screen.getByTestId('read-plans').textContent).toBe('Read the plans again');
  });

  it('R3-B1 — a likely revision is a proposal: Replace / Keep both, stored through the API', async () => {
    const proposal = { id: 'a>b', olderFile: 'AZ Elec Rev 1.pdf', newerFile: 'AZ Elec Rev 2.pdf', matchingSheets: ['E1', 'E2', 'E3'], why: 'same file name; revision 2 after 1' };
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [PLAN_DOC] });
      if (url === `/preconstruction/${bid.id}/job-profile`) return Promise.resolve({ data: { ...PROFILE_RESPONSE, revision_proposals: [proposal], duplicate_sheets: [{ sheetNo: 'E4', files: ['Main.pdf', 'Canopy.pdf'], titles: ['POWER', 'CANOPY LIGHTING'] }] } });
      return Promise.resolve({ data: null });
    });
    put.mockResolvedValue({ data: { revisionProposals: [{ ...proposal, decision: { decision: 'keep_both', by: 'Jake', at: 'now' } }], duplicateSheets: [] } });
    render(<PlansJobProfilePanel bid={bid} onBidUpdated={() => {}} onGoEstimating={() => {}}/>);
    const row = await screen.findByTestId('plan-revision-a>b');
    expect(row.textContent).toContain('AZ Elec Rev 2.pdf appears to replace AZ Elec Rev 1.pdf (3 matching sheets)');
    expect(screen.getByTestId('duplicate-sheets').textContent).toContain('both are kept');
    fireEvent.click(screen.getByTestId('revision-keep-a>b'));
    await waitFor(() => expect(put).toHaveBeenCalledWith(`/preconstruction/${bid.id}/plan-revisions`, { id: 'a>b', decision: 'keep_both' }));
    await waitFor(() => expect(screen.getByTestId('plan-revision-a>b').textContent).toContain('Kept both — Jake'));
  });
});
