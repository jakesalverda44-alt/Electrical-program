// @vitest-environment happy-dom
// Takeoff accuracy Task 7 — the Needs-review list in the Takeoff step.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: vi.fn() } };
});

import TakeoffReviewPanel, { type TakeoffReview } from './TakeoffReviewPanel';

afterEach(cleanup);
beforeEach(() => post.mockReset());

const REVIEW: TakeoffReview = {
  status: 'needs_review',
  items: [
    { id: 'count:G', kind: 'count', title: 'Type G — 6 in LED downlight', detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, sheets: [] },
    { id: 'count:OS', kind: 'count', title: 'Type OS — Ceiling occupancy sensor', detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, sheets: [] },
    { id: 'count:S1:heads', kind: 'count', title: 'Type S1 — fixture heads', detail: '2 poles counted, but the schedule does not say how many heads each pole carries.' },
    { id: 'scope:power_poles', kind: 'scope_question', title: 'Power poles', detail: 'Who furnishes and installs the power poles? (APT / GC / Owner)', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 power poles (E-2)'] },
  ],
};

function setup(review: TakeoffReview = REVIEW, countResult: React.ComponentProps<typeof TakeoffReviewPanel>['countResult'] = null) {
  const onReviewChange = vi.fn();
  const showToast = vi.fn();
  render(<TakeoffReviewPanel bidId="b1" review={review} countResult={countResult} onReviewChange={onReviewChange} showToast={showToast} />);
  return { onReviewChange, showToast };
}

describe('TakeoffReviewPanel', () => {
  it('shows Needs review with the open count and every item', () => {
    setup();
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Needs review — 4 open');
    expect(screen.getByTestId('review-item-count:G')).toBeTruthy();
    expect(screen.getByTestId('review-item-scope:power_poles').textContent).toContain('AI count: 8 power poles (E-2)');
    // Heads are not markers — no "Use confirmed markers" there.
    expect(screen.getByTestId('review-item-count:S1:heads').textContent).not.toContain('Use confirmed markers');
  });

  it('Save count POSTs the count and hands the server review back', async () => {
    const next: TakeoffReview = { status: 'needs_review', items: REVIEW.items.map(i => i.id === 'count:G' ? { ...i, resolution: { action: 'count', qty: 11, by: 'Jake', at: 't' } } : i) };
    post.mockResolvedValue({ data: next });
    const { onReviewChange } = setup();
    fireEvent.change(screen.getByLabelText('Count for Type G — 6 in LED downlight'), { target: { value: '11' } });
    fireEvent.click(screen.getAllByText('Save count')[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:G'], action: 'count', qty: 11 }));
    expect(onReviewChange).toHaveBeenCalledWith(next);
  });

  it('"Not on this job" is disabled until a reason is typed', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup();
    const btn = screen.getAllByText('Not on this job')[1] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why Type OS — Ceiling occupancy sensor is not on this job'), { target: { value: 'No sensors on this prototype' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:OS'], action: 'not_on_job', reason: 'No sensors on this prototype' }));
  });

  it('a scope question is answered from its options', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup();
    fireEvent.click(screen.getByLabelText('GC'));
    fireEvent.click(screen.getByText('Save answer'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['scope:power_poles'], action: 'answer', answer: 'GC' }));
  });

  it('bulk "Not on this job" across selected count items with one reason', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup();
    fireEvent.click(screen.getByLabelText('Select Type G — 6 in LED downlight'));
    fireEvent.click(screen.getByLabelText('Select Type OS — Ceiling occupancy sensor'));
    fireEvent.change(screen.getByLabelText('Why the selected types are not on this job'), { target: { value: 'Generic legend' } });
    fireEvent.click(screen.getByText('Mark selected not on this job'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:G', 'count:OS'], action: 'not_on_job', reason: 'Generic legend' }));
  });

  it('a server refusal shows as an error toast, nothing changes', async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'No confirmed markers for this type yet — confirm or place them in the Plans view first.' } } });
    const { onReviewChange, showToast } = setup();
    fireEvent.click(screen.getAllByText('Use confirmed markers')[0]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ variant: 'error', title: 'Could not save', sub: 'No confirmed markers for this type yet — confirm or place them in the Plans view first.' }));
    expect(onReviewChange).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('resolved items list who resolved them and can be reopened; a clear review says so', async () => {
    const clear: TakeoffReview = { status: 'clear', items: [{ id: 'count:G', kind: 'count', title: 'Type G', detail: '', resolution: { action: 'markers', qty: 10, by: 'Jake', at: 't', carriedOver: true } }] };
    post.mockResolvedValue({ data: REVIEW });
    setup(clear);
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Takeoff review clear');
    expect(screen.getByTestId('review-resolved-count:G').textContent).toContain('10 EA — confirmed markers on the plans (Jake, from the previous run)');
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/reopen', { itemId: 'count:G' }));
  });

  it('counting details show skipped sheets, the load check and rows removed from Agent 1', () => {
    setup(REVIEW, {
      ran: true,
      sheets: [{ label: 'E-3 "LIGHTING PLAN"', status: 'counted' }, { label: 'E-1 "SITE PLAN"', status: 'failed', error: 'the model declined to count this sheet' }],
      skippedSheets: [{ label: 'PH0.1 "PHOTOMETRIC SITE PLAN"', reason: 'photometric / lighting-calculation sheet — never counted' }],
      loadCheck: { ran: true, countedWatts: 6999, circuitVA: 5410, gapPct: -0.29, discrepancy: true },
      removedRows: [{ row: { item: 'Site lights', qty: 4, sourceSheet: 'E-7' }, reason: 'fixture row that matches no scheduled type' }],
      flags: [],
    });
    expect(screen.getByText(/Counted on E-3 · Not counted: E-1/)).toBeTruthy();
    fireEvent.click(screen.getByText('Counting details'));
    const d = screen.getByTestId('takeoff-count-details').textContent!;
    expect(d).toContain('PH0.1 "PHOTOMETRIC SITE PLAN" — photometric / lighting-calculation sheet — never counted');
    expect(d).toContain('E-1 "SITE PLAN" — the model declined to count this sheet');
    expect(d).toContain('counted fixtures 6,999 W vs lighting circuits 5,410 VA (-29%) — more than 20% apart');
    expect(d).toContain('Site lights × 4 (E-7) — fixture row that matches no scheduled type');
  });
});
