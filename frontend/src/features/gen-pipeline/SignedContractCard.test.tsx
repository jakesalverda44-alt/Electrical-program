// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import SignedContractCard from './SignedContractCard';
import { Gen } from '../../types';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
  },
}));

const showToast = vi.fn();
vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => showToast,
}));

// The full nine-page document is irrelevant here and slow to render.
vi.mock('../builder/ProposalPreview', () => ({ default: () => <div data-testid="doc"/> }));
vi.mock('../../lib/signedContractPdf', () => ({
  buildContractPdf: vi.fn().mockResolvedValue(new Blob(['pdf'])),
  signedContractFilename: (c: string) => `Signed Proposal - ${c}.pdf`,
}));

const BASE = {
  id: 'gen-1',
  customer: 'Jane Homeowner',
  stage: 'signed',
  proposal_no: 'P-1',
  form_data: null,
  totals_data: null,
} as unknown as Gen;

beforeEach(() => {
  get.mockReset(); post.mockReset(); showToast.mockReset();
  get.mockResolvedValue({ data: [] });
});
afterEach(cleanup);

describe('card states', () => {
  it('renders nothing at all until the customer has signed', () => {
    const { container } = render(<SignedContractCard gen={{ ...BASE, signed_at: undefined }}/>);
    expect(container.firstChild).toBeNull();
  });

  it('offers Countersign, and flags the archive as missing, on a signed-but-unexecuted deal', async () => {
    render(<SignedContractCard gen={{ ...BASE, signed_at: '2026-08-04T12:00:00.000Z' }}/>);
    await waitFor(() => expect(screen.getByText(/awaiting your signature/)).toBeTruthy());
    expect(screen.getByText(/not archived/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Countersign' })).toBeTruthy();
  });

  it('drops the Countersign button and reads as executed once countersigned', async () => {
    get.mockResolvedValue({ data: [{ id: 'd1', name: 'Executed Contract - Jane Homeowner.pdf', category: 'contract' }] });
    render(<SignedContractCard gen={{
      ...BASE, signed_at: '2026-08-04T12:00:00.000Z', countersigned_at: '2026-08-05T12:00:00.000Z',
    }}/>);
    await waitFor(() => expect(screen.getByText(/Executed August 5, 2026/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Countersign' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });
});

describe('countersign confirmation', () => {
  const signed = { ...BASE, signed_at: '2026-08-04T12:00:00.000Z', group_id: 'grp-1' } as Gen;

  it('spells out the irreversible consequences before signing anything', async () => {
    render(<SignedContractCard gen={signed}/>);
    await waitFor(() => screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign' }));

    expect(screen.getByRole('heading', { name: /Countersign & award/ })).toBeTruthy();
    expect(screen.getByText(/book it as a won job/)).toBeTruthy();
    expect(screen.getByText(/create the project/)).toBeTruthy();
    // Nothing may be posted from merely opening the dialog.
    expect(post).not.toHaveBeenCalled();
  });

  it('names the sibling options that are about to be superseded', async () => {
    const siblings = [
      { id: 'gen-2', mfr: 'Kohler', kw: 20, proposal_no: 'P-2', stage: 'sent' },
      { id: 'gen-3', mfr: 'Generac', kw: 24, proposal_no: 'P-3', stage: 'building' },
    ] as unknown as Gen[];
    render(<SignedContractCard gen={signed} siblings={siblings}/>);
    await waitFor(() => screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign' }));

    expect(screen.getByText(/2 other options will be superseded/)).toBeTruthy();
    expect(screen.getByText(/P-2/)).toBeTruthy();
    expect(screen.getByText(/P-3/)).toBeTruthy();
  });

  it('does not threaten siblings that are already awarded or superseded', async () => {
    const siblings = [
      { id: 'gen-2', mfr: 'Kohler', kw: 20, proposal_no: 'P-2', stage: 'superseded' },
      { id: 'gen-3', mfr: 'Generac', kw: 24, proposal_no: 'P-3', stage: 'awarded' },
    ] as unknown as Gen[];
    render(<SignedContractCard gen={signed} siblings={siblings}/>);
    await waitFor(() => screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign' }));

    expect(screen.queryByText(/will be superseded/)).toBeNull();
  });

  it('posts the countersign only after the confirmation is accepted', async () => {
    post.mockResolvedValue({ data: { gen: { ...signed, countersigned_at: '2026-08-05T12:00:00.000Z' } } });
    render(<SignedContractCard gen={signed}/>);
    await waitFor(() => screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign & award' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalled();
      expect(String(post.mock.calls[0][0])).toBe('/gens/gen-1/countersign');
    });
  });

  it('sends the user to Settings when they have no signature saved', async () => {
    post.mockRejectedValue({ response: { status: 400, data: { error: 'No signature on file' } } });
    render(<SignedContractCard gen={signed}/>);
    await waitFor(() => screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Countersign & award' }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalled();
      expect(showToast.mock.calls[0][0].title).toMatch(/No signature/);
    });
  });
});
