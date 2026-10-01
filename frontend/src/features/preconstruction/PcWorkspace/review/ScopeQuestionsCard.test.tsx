// @vitest-environment happy-dom
// Fewer-questions round Task 4 — scope questions on the Scope step: the card
// posts EXACTLY the frozen 2A bodies (scopeAnswer / scopeBulkAccept), the
// Takeoff list leaves them out of its own progress and points at the Scope
// step, and the proposal stays blocked while one is open.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../../components/ConfirmDialog';

const post = vi.fn();
const get = vi.fn();
vi.mock('../../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/client')>('../../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: vi.fn() } };
});

import ScopeQuestionsCard from './ScopeQuestionsCard';
import TakeoffReviewPanel, { type ReviewItem, type TakeoffReview } from '../TakeoffReviewPanel';
import ProposalTab from '../ProposalTab';
import { CASES } from './payloadCases';
import { reviewProgress } from './reviewModel';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockResolvedValue({ data: {} }); post.mockResolvedValue({ data: { status: 'needs_review', items: [] } }); });

const onScope = (items: ReviewItem[]) => items.map(i => ({ ...i, step: 'scope' as const }));

describe('ScopeQuestionsCard — the same bodies as the Takeoff list', () => {
  it('scopeAnswer', async () => {
    render(<ScopeQuestionsCard bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} review={{ status: 'needs_review', items: onScope(CASES.scopeAnswer.items) }} />);
    fireEvent.click(within(screen.getByTestId('review-item-scope:power_poles')).getByRole('button', { name: 'GC' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/preconstruction/b1/review/resolve');
    expect(post.mock.calls[0][1]).toStrictEqual(CASES.scopeAnswer.expected);
  });
  it('scopeBulkAccept', async () => {
    render(<ScopeQuestionsCard bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} review={{ status: 'needs_review', items: onScope(CASES.scopeBulkAccept.items) }} />);
    fireEvent.click(screen.getByTestId('scope-questions-accept'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toStrictEqual(CASES.scopeBulkAccept.expected);
  });
  it('reopen of an answered one posts the frozen reopen body', async () => {
    const items = onScope(CASES.scopeAnswer.items).map(i => ({ ...i, resolution: { action: 'answer' as const, answer: 'GC', by: 'Jake', at: 't' } }));
    render(<ScopeQuestionsCard bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} review={{ status: 'clear', items }} />);
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toStrictEqual(['/preconstruction/b1/review/reopen', { itemId: 'scope:power_poles' }]);
  });
});

describe('the Takeoff list with questions on the Scope step', () => {
  const G = CASES.zeroCount.items[0];
  it('progress leaves the scope questions out; one row points at the Scope step', () => {
    const items = [G, ...onScope(CASES.scopeBulkAccept.items)];
    expect(reviewProgress(items, { excludeStep: 'scope' })).toEqual({ total: 1, answered: 0, open: 1 });
    expect(reviewProgress(items)).toEqual({ total: 3, answered: 0, open: 3 });
    const go = vi.fn();
    render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items }} onGoScopeStep={go} /></ConfirmProvider>);
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Needs review — 1 open');
    expect(screen.queryByTestId('review-item-scope:power_poles:furnish')).toBeNull();
    expect(screen.getByTestId('takeoff-review-scope-step').textContent).toContain('2 scope questions are on the Scope step — they still need answers before the proposal.');
    fireEvent.click(screen.getByTestId('takeoff-review-go-scope'));
    expect(go).toHaveBeenCalledTimes(1);
  });
  it('only scope questions open → "Takeoff questions done"', () => {
    render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: onScope(CASES.scopeAnswer.items) }} /></ConfirmProvider>);
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Takeoff questions done');
  });
});

describe('the proposal stays blocked while a scope question is open', () => {
  it('says where the open questions are', () => {
    const items: TakeoffReview['items'] = [CASES.zeroCount.items[0], ...onScope(CASES.scopeBulkAccept.items), { ...CASES.zeroCount.items[1], blocking: false }];
    const noop = () => undefined;
    const props = {
      bid: { id: 'b1', name: 'B', loc: '', gc: '', due: '', due_days: 0, amount: null, sheets: 0, contact: '', stage: 'due', salesperson_name: '' },
      aiResults: { review_status: 'needs_review', review_items: items, agent2_output: '{}' },
      propPrice: '1000', setPropPrice: noop, propNotes: '', setPropNotes: noop, agent4StartError: null, setAgent4StartError: noop, agent4Running: false,
      runAgent4Proposal: noop, downloadDocx: noop, docxBusy: false, downloadTakeoffXlsx: noop, xlsxBusy: false, sendProposalOpen: false, setSendProposalOpen: noop,
      onBidUpdated: noop, showToast: noop, generatePrebidPackage: noop, prebidBusy: false, prebidResult: null, downloadFiledDocument: noop,
      emailPrebidToChris: noop, chrisDraftBusy: false, chrisDraftLink: null, verifyFailures: null, proposalPreview: null, convertOpen: false, setConvertOpen: noop, handleConvert: noop,
    } as unknown as React.ComponentProps<typeof ProposalTab>;
    render(<ConfirmProvider><ProposalTab {...props} /></ConfirmProvider>);
    expect(screen.getByTestId('proposal-review-blocked').textContent).toContain('3 questions open — 1 on Takeoff, 2 on Scope');
  });
});
