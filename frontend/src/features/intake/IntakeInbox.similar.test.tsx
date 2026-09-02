// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import IntakeInboxPage from './IntakeInboxPage';

afterEach(cleanup);

const rebidItem = {
  id: 'i-rebid',
  name: '7-Eleven #42901 (REBID) - Tampa, FL',
  gc: 'Bay to Bay Properties, LLC',
  loc: 'Tampa, FL',
  contact: null,
  amount: null,
  sheets: null,
  sq_ft: null,
  due: null,
  notes: null,
  source: 'email',
  status: 'pending' as const,
  decline_reason: null,
  created_by_name: null,
  created_at: new Date().toISOString(),
  read_at: new Date().toISOString(),
  web_link: null,
  from_email: 'bay_to_bay_properties_notifications@procoretech.com',
  received_at: null,
  body_snippet: null,
  attachment_names: null,
  team_notified_at: null,
  team_notified_to: null,
  similar: [
    { kind: 'bid' as const, id: 'bid-original', name: '7-Eleven #42901 - Tampa, FL', stage: 'submitted' },
    { kind: 'intake' as const, id: 'i-other-pending', name: '7-Eleven #42901 - Tampa, FL (dup email)' },
  ],
};

const plainItem = {
  ...rebidItem,
  id: 'i-plain',
  name: 'Standalone Project With No Hints',
  similar: [],
};

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => vi.fn(),
}));

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/intake') return Promise.resolve({ data: [rebidItem, plainItem] });
      if (url === '/intake/notify-defaults') return Promise.resolve({ data: { emails: [], mailConfigured: false } });
      return Promise.resolve({ data: null });
    }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const noop = () => {};

describe('IntakeInboxPage duplicate/REBID chips', () => {
  it('shows a "possible rebid" chip linking to the bid and a "possible duplicate" chip for a pending item', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);

    await waitFor(() => expect(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL')).toBeTruthy());
    fireEvent.click(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL'));

    await waitFor(() => expect(screen.getByText(/Possible rebid of/)).toBeTruthy());
    expect(screen.getByText(/\(bid — submitted\)/)).toBeTruthy();
    const link = screen.getByText('“7-Eleven #42901 - Tampa, FL”').closest('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/bid/bid-original');

    expect(screen.getByText(/Possible duplicate of/)).toBeTruthy();
    expect(screen.getByText(/\(pending intake\)/)).toBeTruthy();
  });

  it('renders no chip row when an item has no similar hints', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);

    await waitFor(() => expect(screen.getByText('Standalone Project With No Hints')).toBeTruthy());
    fireEvent.click(screen.getByText('Standalone Project With No Hints'));

    await waitFor(() => expect(screen.getByText('Bid Name *')).toBeTruthy());
    expect(screen.queryByText(/Possible rebid of/)).toBeNull();
    expect(screen.queryByText(/Possible duplicate of/)).toBeNull();
  });
});
