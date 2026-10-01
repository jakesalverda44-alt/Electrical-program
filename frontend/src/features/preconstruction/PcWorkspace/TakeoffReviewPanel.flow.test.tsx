// @vitest-environment happy-dom
// UI cleanup round 2A, Tasks 5-6 — the progress header, "Next unanswered", and
// where keyboard focus goes after an answer folds away.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const post = vi.fn();
const get = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: vi.fn() } };
});

import TakeoffReviewPanel, { type TakeoffReview, type ReviewItem } from './TakeoffReviewPanel';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockResolvedValue({ data: {} }); });

const res = (o: Partial<NonNullable<ReviewItem['resolution']>> = {}): NonNullable<ReviewItem['resolution']> => ({ action: 'not_on_job', reason: 'because reasons here', by: 'Jake', at: 't', ...o });
const ZERO = (id: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({ id: `count:${id}`, kind: 'count', group: 'zero', title: `Type ${id} — thing`, detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, actions: ['count', 'markers', 'not_on_job'], ...extra });
const SCOPE = (id: string): ReviewItem => ({ id: `scope:${id}`, kind: 'scope_question', group: 'scope', title: `Scope ${id}`, detail: 'q', options: ['APT', 'GC'] });
const LEGEND = (members: Array<[string, boolean]>): ReviewItem => ({
  id: 'legend-zero:X', kind: 'count', group: 'legend-zero', title: 'Legend items', detail: 'd', actions: ['count', 'not_on_job'],
  groupedTypes: members.map(([k, done]) => ({ key: k, type: k, description: k, ...(done ? { resolution: res() } : {}) })),
});

function Harness({ initial }: { initial: TakeoffReview }) {
  const [review, setReview] = useState(initial);
  return (
    <ConfirmProvider>
      <TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={setReview} countResult={null} review={review} />
    </ConfirmProvider>
  );
}
const card = (id: string) => screen.getByTestId(`review-item-${id}`);
const active = () => document.activeElement as HTMLElement | null;

describe('round 2A Task 5 — progress header and Next unanswered', () => {
  const REVIEW: TakeoffReview = {
    status: 'needs_review',
    items: [
      ZERO('A', { resolution: res() }),                    // 1 of 1 answered
      LEGEND([['MS', true], ['OS', false], ['PC', false]]), // 1 of 3 answered
      ZERO('B'), ZERO('C'),                                // 0 of 2
      { ...ZERO('EF'), group: 'info', blocking: false },   // information: never counted
    ],
  };
  it('counts answers in units: 2 of 6 answered, bar value, and the chip agrees', () => {
    render(<Harness initial={REVIEW} />);
    expect(screen.getByTestId('takeoff-review-progress-text').textContent).toBe('2 of 6 answered');
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('6');
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Needs review — 4 open');
  });
  it('pending and clear states show no progress row and no Next button', () => {
    render(<Harness initial={{ status: 'pending', items: [] }} />);
    expect(screen.queryByTestId('takeoff-review-progress')).toBeNull();
    cleanup();
    render(<Harness initial={{ status: 'clear', items: [ZERO('A', { resolution: res() })] }} />);
    expect(screen.queryByTestId('takeoff-review-progress')).toBeNull();
    expect(screen.queryByTestId('takeoff-review-next')).toBeNull();
  });
  it('Next unanswered focuses the first open card, then the next, expanding its group, and wraps', async () => {
    render(<Harness initial={{ status: 'needs_review', items: [ZERO('G'), ZERO('OS'), SCOPE('p')] }} />);
    const next = screen.getByTestId('takeoff-review-next');
    expect(screen.getByTestId('review-group-toggle-scope').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(next);
    await waitFor(() => expect(active()).toBe(card('count:G')));
    fireEvent.click(next);
    await waitFor(() => expect(active()).toBe(card('count:OS')));
    fireEvent.click(next);
    await waitFor(() => expect(active()).toBe(card('scope:p')));
    expect(screen.getByTestId('review-group-toggle-scope').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(next); // wraps around
    await waitFor(() => expect(active()).toBe(card('count:G')));
  });
});

describe('round 2A Task 6 — focus moves on when an answer folds away', () => {
  // post resolves to the next review: the same items with the given ids resolved.
  const resolveIds = (review: TakeoffReview, ids: string[]): TakeoffReview => ({
    status: review.items.some(i => !ids.includes(i.id) && !i.resolution && i.blocking !== false) ? 'needs_review' : 'clear',
    items: review.items.map(i => (ids.includes(i.id) ? { ...i, resolution: res({ action: 'count', qty: 1 }) } : i)),
  });
  const count = (id: string) => {
    fireEvent.change(within(card(id)).getByLabelText(new RegExp(`^Count for Type ${id.split(':')[1]} `)), { target: { value: '5' } });
    fireEvent.click(within(card(id)).getByText('Save count'));
  };

  it('answering count:G folds it into "resolved" and focuses the count:OS card', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [ZERO('G'), ZERO('OS')] };
    post.mockResolvedValue({ data: resolveIds(initial, ['count:G']) });
    render(<Harness initial={initial} />);
    count('count:G');
    await waitFor(() => expect(screen.queryByTestId('review-item-count:G')).toBeNull());
    expect(screen.getByTestId('review-resolved-count:G')).toBeTruthy();
    expect(screen.getByText('1 resolved')).toBeTruthy();
    await waitFor(() => expect(active()).toBe(card('count:OS')));
  });

  it('answering the last item of group 1 focuses the first card of group 2 and expands it', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [ZERO('G'), SCOPE('p')] };
    post.mockResolvedValue({ data: resolveIds(initial, ['count:G']) });
    render(<Harness initial={initial} />);
    expect(screen.getByTestId('review-group-toggle-scope').getAttribute('aria-expanded')).toBe('false');
    count('count:G');
    await waitFor(() => expect(active()).toBe(card('scope:p')));
    expect(screen.getByTestId('review-group-toggle-scope').getAttribute('aria-expanded')).toBe('true');
  });

  it('answering a legend member keeps the card and focuses the next unanswered member row', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [LEGEND([['MS', false], ['OS', false], ['PC', false]])] };
    const next: TakeoffReview = { status: 'needs_review', items: [LEGEND([['MS', true], ['OS', false], ['PC', false]])] };
    post.mockResolvedValue({ data: next });
    render(<Harness initial={initial} />);
    fireEvent.change(screen.getByTestId('groupmember-qty-legend-zero:X::MS'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('groupmember-count-legend-zero:X::MS'));
    await waitFor(() => expect(screen.getByTestId('review-groupmember-done-legend-zero:X::MS')).toBeTruthy());
    expect(screen.getByTestId('review-item-legend-zero:X')).toBeTruthy();
    await waitFor(() => expect(active()).toBe(screen.getByTestId('review-groupmember-legend-zero:X::OS')));
  });

  it('answering the last open item focuses the status chip, which reads "Takeoff review clear"', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [ZERO('G')] };
    post.mockResolvedValue({ data: resolveIds(initial, ['count:G']) });
    render(<Harness initial={initial} />);
    count('count:G');
    await waitFor(() => expect(active()).toBe(screen.getByTestId('takeoff-review-status')));
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Takeoff review clear');
  });

  it('a server error moves no focus and keeps the picker with its typed text', async () => {
    post.mockRejectedValue({ response: { data: { error: 'nope' } } });
    render(<Harness initial={{ status: 'needs_review', items: [ZERO('G'), ZERO('OS')] }} />);
    fireEvent.click(within(card('count:G')).getByText('Not on this job'));
    const input = within(card('count:G')).getByLabelText(/^Why /) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Not in this remodel scope' } });
    fireEvent.click(within(card('count:G')).getByRole('button', { name: 'Save reason' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((within(card('count:G')).getByRole('button', { name: 'Save reason' }) as HTMLButtonElement).disabled).toBe(false));
    expect(active()).not.toBe(card('count:OS'));
    expect(active()).not.toBe(screen.getByTestId('takeoff-review-status'));
    expect((within(card('count:G')).getByLabelText(/^Why /) as HTMLInputElement).value).toBe('Not in this remodel scope');
  });

  it('a bulk "Mark all 2 not on this job" (through the dialog) focuses the next item after the group', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [ZERO('L'), ZERO('OS'), SCOPE('p')] };
    post.mockResolvedValue({ data: resolveIds(initial, ['count:L', 'count:OS']) });
    render(<Harness initial={initial} />);
    fireEvent.change(screen.getByTestId('group-reason-zero'), { target: { value: 'Not in this remodel scope' } });
    fireEvent.click(screen.getByTestId('group-noj-zero'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Confirm'));
    await waitFor(() => expect(active()).toBe(card('scope:p')));
    expect(screen.getByTestId('review-group-toggle-scope').getAttribute('aria-expanded')).toBe('true');
  });

  it('Reopen does not move focus', async () => {
    const initial: TakeoffReview = { status: 'needs_review', items: [ZERO('G', { resolution: res() }), ZERO('OS')] };
    post.mockResolvedValue({ data: { status: 'needs_review', items: [ZERO('G'), ZERO('OS')] } });
    render(<Harness initial={initial} />);
    const before = active();
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('review-item-count:G')).toBeTruthy());
    expect(active()).toBe(before);
  });
});
