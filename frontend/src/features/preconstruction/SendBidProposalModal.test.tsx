// @vitest-environment happy-dom
// Post-merge rework (2026-09-03) — the modal creates an Outlook draft
// (POST /bids/:id/draft-proposal) instead of sending. Prefills from the
// bid.contact when it looks like an email, prefills subject/body from the
// authority template, and reports which format got attached (pdf/docx) and
// whether the stage advanced (markSubmitted).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SendBidProposalModal from './SendBidProposalModal';
import { Bid } from '../../types';

afterEach(() => { cleanup(); post.mockClear(); });

const post = vi.fn();
vi.mock('../../api/client', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

const BASE_BID: Bid = {
  id: 'bid-1', name: 'Test Plaza', loc: '123 Main St, Orlando, FL', gc: 'Bay to Bay',
  due: '', due_days: 0, amount: 250000, sheets: 0, contact: '', stage: 'due',
  salesperson_name: 'Jake', proposal_token: 'tok-abc',
} as Bid;

describe('SendBidProposalModal', () => {
  it('titles itself "Draft Proposal Email"', () => {
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    expect(screen.getByText('Draft Proposal Email')).toBeTruthy();
  });

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

  it('"Mark bid as Submitted" defaults to checked', () => {
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    const checkbox = screen.getByText('Mark bid as Submitted').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('disables "Create Outlook Draft" until a recipient is entered', () => {
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    const btn = screen.getByRole('button', { name: /Create Outlook Draft/i });
    expect(btn.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com' } });
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('posts to /bids/:id/draft-proposal with parsed recipients, includeTakeoff and markSubmitted, and reports the result on success', async () => {
    post.mockResolvedValue({
      data: {
        bid: { ...BASE_BID, stage: 'submitted', proposal_sent_at: '2026-09-03T00:00:00Z' },
        wonJob: null, stageAdvanced: true, webLink: 'https://outlook.office.com/mail/deeplink/compose/abc', attached: 'pdf',
      },
    });
    const onSent = vi.fn();
    render(<SendBidProposalModal bid={BASE_BID} onSent={onSent} onClose={() => {}}/>);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com, ops@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Outlook Draft/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/bids/bid-1/draft-proposal');
    expect(body.to).toEqual(['gc@example.com', 'ops@example.com']);
    expect(body.includeTakeoff).toBe(false);
    expect(body.markSubmitted).toBe(true);

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSent.mock.calls[0][0].stageAdvanced).toBe(true);
    expect(onSent.mock.calls[0][0].attached).toBe('pdf');
    expect(await screen.findByText(/Draft Created/i)).toBeTruthy();
    expect(screen.getByText(/PDF attached/i)).toBeTruthy();
    expect(screen.getByText(/Stage advanced to Submitted/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open draft in Outlook/i }).getAttribute('href')).toBe('https://outlook.office.com/mail/deeplink/compose/abc');
  });

  it('sends markSubmitted:false when the checkbox is unchecked', async () => {
    post.mockResolvedValue({ data: { bid: BASE_BID, wonJob: null, stageAdvanced: false, webLink: '', attached: 'docx' } });
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com' } });
    fireEvent.click(screen.getByText('Mark bid as Submitted').closest('label')!.querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByRole('button', { name: /Create Outlook Draft/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].markSubmitted).toBe(false);
    expect(await screen.findByText(/Word attached — install LibreOffice for PDF/i)).toBeTruthy();
  });

  it('surfaces the backend error (e.g. the 409 for no filed proposal) without crashing', async () => {
    post.mockRejectedValue({ response: { data: { error: 'No filed proposal on file yet. Generate/download the proposal .docx first.' } } });
    render(<SendBidProposalModal bid={BASE_BID} onSent={() => {}} onClose={() => {}}/>);
    fireEvent.change(screen.getByPlaceholderText('bids@generalcontractor.com'), { target: { value: 'gc@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Outlook Draft/i }));
    expect(await screen.findByText(/No filed proposal on file yet/i)).toBeTruthy();
  });
});
