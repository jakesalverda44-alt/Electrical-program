// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AddLeadModal, { buildCombinedAddress } from './AddLeadModal';

afterEach(cleanup);

const post = vi.fn();
vi.mock('../../api/client', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

describe('buildCombinedAddress', () => {
  it('joins street, city, and "STATE ZIP" into the parser\'s well-formed comma format', () => {
    expect(buildCombinedAddress('123 Main St', 'Eustis', 'FL', '32726')).toBe('123 Main St, Eustis, FL 32726');
  });

  it('drops any part that was left blank rather than leaving stray commas', () => {
    expect(buildCombinedAddress('123 Main St', '', 'FL', '')).toBe('123 Main St, FL');
    expect(buildCombinedAddress('', '', '', '')).toBe('');
    expect(buildCombinedAddress('123 Main St', '', '', '')).toBe('123 Main St');
  });
});

describe('AddLeadModal address carryover', () => {
  it('sends the combined Street, City, ST ZIP address on save — the exact shape leadAddressToProposal parses correctly', async () => {
    post.mockResolvedValue({ data: { id: 'new-lead' } });
    const { getByPlaceholderText, getByText } = render(<AddLeadModal onClose={() => {}} onAdded={() => {}}/>);

    fireEvent.change(getByPlaceholderText('Customer name'), { target: { value: 'Jane Homeowner' } });
    fireEvent.change(getByPlaceholderText('123 Main St'), { target: { value: '123 Main St' } });
    fireEvent.change(getByPlaceholderText('City'), { target: { value: 'Eustis' } });
    fireEvent.change(getByPlaceholderText('ZIP'), { target: { value: '32726' } });

    fireEvent.click(getByText('Add Lead'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({
      name: 'Jane Homeowner',
      address: '123 Main St, Eustis, FL 32726',
    });
  });

  it('defaults State to FL, matching the FL-based business elsewhere in the builder', () => {
    const { getByDisplayValue } = render(<AddLeadModal onClose={() => {}} onAdded={() => {}}/>);
    expect((getByDisplayValue('FL') as HTMLInputElement).value).toBe('FL');
  });

  // Regression: leadCreateSchema's optional fields accept undefined but not null — a
  // blank email/phone/notes sent as null fails validation ("Invalid input") and the
  // lead never saves at all, address included (found live while QA-ing this fix: the
  // save silently failed with "email: Invalid input" the moment Email was left blank,
  // even though Address/City/State/Zip were all filled in correctly).
  it('omits blank email/phone/notes (undefined) instead of sending null, which the backend schema rejects', async () => {
    post.mockResolvedValue({ data: { id: 'new-lead' } });
    const { getByPlaceholderText, getByText } = render(<AddLeadModal onClose={() => {}} onAdded={() => {}}/>);
    fireEvent.change(getByPlaceholderText('Customer name'), { target: { value: 'No Extras' } });
    fireEvent.change(getByPlaceholderText('123 Main St'), { target: { value: '123 Main St' } });
    fireEvent.change(getByPlaceholderText('City'), { target: { value: 'Eustis' } });
    fireEvent.change(getByPlaceholderText('ZIP'), { target: { value: '32726' } });
    // Phone, Email, Notes deliberately left blank.

    fireEvent.click(getByText('Add Lead'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const payload = post.mock.calls[0][1];
    expect(payload.phone).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.notes).toBeUndefined();
    expect(payload.address).toBe('123 Main St, Eustis, FL 32726');
    // The real bug was a `null` value, which JSON.stringify keeps (unlike undefined,
    // which it drops) — assert against the actual wire payload, not just the JS value.
    expect(JSON.stringify(payload)).not.toContain('null');
  });
});
