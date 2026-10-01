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
