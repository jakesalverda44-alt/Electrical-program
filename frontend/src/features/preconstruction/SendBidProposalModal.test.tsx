// @vitest-environment happy-dom
// Phase 4 Task 1.6 — modal render test: prefills from bid.contact when it
// looks like an email, prefills subject/body from the authority template,
// and posts to the send-proposal route with the entered recipients.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SendBidProposalModal from './SendBidProposalModal';
import { Bid } from '../../types';

afterEach(cleanup);

const post = vi.fn();
vi.mock('../../api/client', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

const BASE_BID: Bid = {
  id: 'bid-1', name: 'Test Plaza', loc: '123 Main St, Orlando, FL', gc: 'Bay to Bay',
  due: '', due_days: 0, amount: 250000, sheets: 0, contact: '', stage: 'due',
  salesperson_name: 'Jake', proposal_token: 'tok-abc',
} as Bid;

describe('SendBidProposalModal', () => {
  it('prefills the To field from bid.contact when it looks like an email', () => {
    render(<SendBidProposalModal bid={{ ...BASE_BID, contact: 'bids@gc.com' }} onSent={() => {}} onClose={() => {}}/>);
    expect((screen.getByPlaceholderText('bids@generalcontractor.com') as HTMLInputElement).value).toBe('bids@gc.com');
  });

  it('leaves To blank when bid.contact is not an email (e.g. a phone number or name)', () => {
    render(<SendBidProposalModal bid={{ ...BASE_BID, contact: 'John Smith, 555-1234' }} onSent={() => {}} onClose={() => {}}/>);
    expect((screen.getByPlaceholderText('bids@generalcontractor.com') as HTMLInputElement).value).toBe('');
  });

  it('prefills the subject and body from the authority template', () => {
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    const subjectInputs = screen.getAllByDisplayValue(/Test Plaza – 123 Main St, Orlando, FL \| Electrical Proposal/);
    expect(subjectInputs.length).toBe(1);
    expect(screen.getByText(/Please find attached our electrical proposal/i)).toBeTruthy();
  });

  it('disables Send until a recipient is entered', () => {
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    const sendBtn = screen.getByRole('button', { name: /Send Proposal/i });
    expect(sendBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com' } });
    expect(sendBtn.hasAttribute('disabled')).toBe(false);
  });

  it('posts to /bids/:id/send-proposal with parsed recipients and includeTakeoff, and reports the result on success', async () => {
    post.mockResolvedValue({ data: { bid: { ...BASE_BID, stage: 'submitted', proposal_sent_at: '2026-09-03T00:00:00Z' }, wonJob: null, stageAdvanced: true, link: 'https://x/bp/tok-abc' } });
    const onSent = vi.fn();
    render(<SendBidProposalModal bid={BASE_BID} onSent={onSent} onClose={() => {}}/>);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com, ops@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Proposal/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/bids/bid-1/send-proposal');
    expect(body.to).toEqual(['gc@example.com', 'ops@example.com']);
    expect(body.includeTakeoff).toBe(false);

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSent.mock.calls[0][0].stageAdvanced).toBe(true);
    expect(await screen.findByText(/Proposal Sent/i)).toBeTruthy();
    expect(screen.getByText(/Stage advanced to Submitted/i)).toBeTruthy();
  });

  it('surfaces the backend error (e.g. the 409 for no filed proposal) without crashing', async () => {
    post.mockRejectedValue({ response: { data: { error: 'No filed proposal on file yet. Generate/download the proposal .docx first.' } } });
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Proposal/i }));
    expect(await screen.findByText(/No filed proposal on file yet/i)).toBeTruthy();
  });
});
