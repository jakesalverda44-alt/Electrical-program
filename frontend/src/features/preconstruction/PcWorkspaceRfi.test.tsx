// @vitest-environment happy-dom
// Phase 4 Task 5.1/5.2 — the RFI tab: "Suggest RFIs" (a hardcoded keyword
// table + setTimeout) is replaced by "Import from AI analysis" (Agent 2's
// real rfis[], deduped against the existing list), and the fake per-row
// "Submit" (client-only, "GC will be notified" toast) is replaced by one
// batch action that drafts a real Outlook email via POST /rfi-draft.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'Circle K #4521', loc: '1234 Main St', gc: 'ABC Construction', due: '', due_days: 0, amount: null,
  sheets: 0, contact: 'gc@example.com', stage: 'due', salesperson_name: '',
};

const AI_RESULTS_WITH_RFIS = {
  agent2_output: JSON.stringify({
    scopeOfWork: {},
    rfis: [
      { item: 'Service', risk: 'HIGH', question: 'What is the available fault current at the utility service point?' },
      { item: 'Lighting', risk: 'MEDIUM', question: 'Are lighting fixture submittals required prior to rough-in?' },
    ],
  }),
};

function baseMocks(aiResults: Record<string, unknown> = {}) {
  get.mockImplementation((url: string) => {
    if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: aiResults });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
    if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

// A real stateful parent — set()'s calls (via onUpdate) must actually
// re-render PcWorkspaceView with the updated `ws`, exactly like the real
// BidHubPage/PcWorkspacePage owner does. A no-op onUpdate would make every
// set()-driven UI change (Import/Submit included) untestable.
function Harness({ rfis }: { rfis: { id: string; question: string; submitted: boolean; answer: string }[] }) {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Circle K #4521', 0), activeTab: 'rfis', rfis });
  return (
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={setWs}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />
  );
}

function renderRfiTab(rfis: { id: string; question: string; submitted: boolean; answer: string }[] = []) {
  return render(<Harness rfis={rfis}/>);
}

describe('PcWorkspace RFI tab — Import from AI analysis (Task 5.2)', () => {
  it('is disabled with a hint when there is no AI analysis yet', async () => {
    baseMocks({});
    renderRfiTab();
    await waitFor(() => expect(screen.getByText('Import from AI analysis').closest('button')).toBeTruthy());
    const btn = screen.getByText('Import from AI analysis').closest('button')!;
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('imports Agent 2s real rfis[] as new RFI rows', async () => {
    baseMocks(AI_RESULTS_WITH_RFIS);
    renderRfiTab();
    await waitFor(() => {
      const btn = screen.getByText('Import from AI analysis').closest('button')!;
      expect(btn.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByText('Import from AI analysis'));

    expect(await screen.findByText('What is the available fault current at the utility service point?')).toBeTruthy();
    expect(screen.getByText('Are lighting fixture submittals required prior to rough-in?')).toBeTruthy();
  });

  it('dedupes against an existing RFI with the same question text (case/whitespace-insensitive)', async () => {
    baseMocks(AI_RESULTS_WITH_RFIS);
    renderRfiTab([
      { id: 'existing-1', question: '  what is the available fault current at the utility service point?  ', submitted: false, answer: '' },
    ]);
    await waitFor(() => {
      const btn = screen.getByText('Import from AI analysis').closest('button')!;
      expect(btn.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByText('Import from AI analysis'));

    // Only the genuinely-new one is imported; the duplicate isn't added a second time.
    expect(await screen.findByText('Are lighting fixture submittals required prior to rough-in?')).toBeTruthy();
    expect(screen.getAllByText(/available fault current/).length).toBe(1);
  });
});

describe('PcWorkspace RFI tab — Submit to GC (Task 5.1)', () => {
  it('posts to /preconstruction/:bidId/rfi-draft and marks open RFIs submitted on success', async () => {
    baseMocks({});
    post.mockImplementation((url: string) => {
      if (url === `/preconstruction/${bid.id}/rfi-draft`) {
        // FIX-11 (post-review) — the client now marks rows submitted from
        // submittedIds, not "everything currently unsubmitted."
        return Promise.resolve({ data: { draftWebLink: 'https://outlook.office.com/draft/1', submittedCount: 1, submittedIds: ['r1'] } });
      }
      return Promise.resolve({ data: {} });
    });
    renderRfiTab([{ id: 'r1', question: 'Confirm service entrance rating.', submitted: false, answer: '' }]);

    await waitFor(() => expect(screen.getByText(/Submit 1 Open RFI to GC/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Submit 1 Open RFI to GC/));

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/rfi-draft`));
    // Scope to the RFI row itself — the step progress bar also has an
    // unrelated "Submitted" label (the pipeline's final step).
    const row = screen.getByText('Confirm service entrance rating.').closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Submitted')).toBeTruthy());
    expect(screen.queryByText(/Submit.*Open RFI/)).toBeNull();
  });

  // FIX-11 (post-review) — the mismatch this locks against: a blank-question
  // RFI is never included in the server's submittedIds (rfi-draft only
  // drafts RFIs with real question text), so it must stay unsubmitted
  // client-side too, even when the batch call otherwise succeeds.
  it('leaves a blank-question RFI unsubmitted when submittedIds excludes it', async () => {
    baseMocks({});
    post.mockImplementation((url: string) => {
      if (url === `/preconstruction/${bid.id}/rfi-draft`) {
        return Promise.resolve({ data: { draftWebLink: 'https://outlook.office.com/draft/1', submittedCount: 1, submittedIds: ['r1'] } });
      }
      return Promise.resolve({ data: {} });
    });
    renderRfiTab([
      { id: 'r1', question: 'Confirm service entrance rating.', submitted: false, answer: '' },
      { id: 'r2', question: '   ', submitted: false, answer: '' },
    ]);

    await waitFor(() => expect(screen.getByText(/Submit \d+ Open RFIs? to GC/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Submit \d+ Open RFIs? to GC/));

    const submittedRow = await waitFor(() => screen.getByText('Confirm service entrance rating.').closest('tr')!);
    await waitFor(() => expect(within(submittedRow).getByText('Submitted')).toBeTruthy());

    // Exactly ONE RFI table row shows "Submitted" — the blank-question row
    // (excluded from submittedIds) still shows "Draft", not "Submitted".
    // (Scoped to <tbody> rows — the step progress bar elsewhere on the page
    // has its own unrelated "Submitted" label.)
    const rfiRows = within(submittedRow.closest('tbody')!).getAllByRole('row');
    expect(rfiRows).toHaveLength(2);
    const statuses = rfiRows.map(r => within(r).getByRole('cell', { name: /Submitted|Draft/ }).textContent);
    expect(statuses.filter(s => s === 'Submitted')).toHaveLength(1);
    expect(statuses.filter(s => s === 'Draft')).toHaveLength(1);
  });

  it('the batch submit button is hidden once there are no open RFIs', async () => {
    baseMocks({});
    renderRfiTab([{ id: 'r1', question: 'Already asked', submitted: true, answer: '' }]);
    await waitFor(() => expect(screen.getByText('Already asked')).toBeTruthy());
    expect(screen.queryByText(/Submit.*Open RFI/)).toBeNull();
  });
});
