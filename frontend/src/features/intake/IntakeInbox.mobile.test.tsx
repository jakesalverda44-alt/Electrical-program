// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import IntakeInboxPage from './IntakeInboxPage';

afterEach(cleanup);

const item = {
  id: 'i1',
  name: 'Acme HQ Rewire',
  gc: 'BuildCo',
  loc: '123 Main St',
  contact: null,
  amount: null,
  sheets: null,
  sq_ft: null,
  due: null,
  notes: null,
  source: 'manual',
  status: 'pending' as const,
  decline_reason: null,
  created_by_name: 'Jake',
  created_at: new Date().toISOString(),
  read_at: new Date().toISOString(), // already read — avoids the mark-as-read POST side effect
  web_link: null,
  from_email: null,
  received_at: null,
  body_snippet: null,
  attachment_names: null,
  team_notified_at: null,
  team_notified_to: null,
};

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => vi.fn(),
}));

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/intake') return Promise.resolve({ data: [item] });
      if (url === '/intake/notify-defaults') return Promise.resolve({ data: { emails: [], mailConfigured: false } });
      return Promise.resolve({ data: null });
    }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const noop = () => {};

// Stand in for window.matchMedia (not implemented meaningfully by happy-dom) so
// useIsMobile can be driven deterministically per test.
function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('IntakeInboxPage responsive layout', () => {
  it('mobile: shows list only, then detail+Back on tap, then back to list', async () => {
    mockMatchMedia(true);
    render(<IntakeInboxPage onBidAccepted={noop} />);

    // List renders full-width; no detail pane (no Back control) until an item is tapped.
    await waitFor(() => expect(screen.getByText('Acme HQ Rewire')).toBeTruthy());
    expect(screen.getByText('Intake Inbox')).toBeTruthy();
    expect(screen.queryByText('Back')).toBeNull();

    fireEvent.click(screen.getByText('Acme HQ Rewire'));

    // Detail pane replaces the list — full-width with a Back control.
    await waitFor(() => expect(screen.getByText('Back')).toBeTruthy());
    expect(screen.queryByText('Intake Inbox')).toBeNull();

    const back = screen.getByText('Back').closest('button') as HTMLButtonElement;
    expect(back).toBeTruthy();
    // Tap target must be at least 44px tall per mobile guidelines.
    expect(parseInt(back.style.minHeight || '0', 10)).toBeGreaterThanOrEqual(44);

    fireEvent.click(back);

    // Back to the list; detail/Back control gone.
    await waitFor(() => expect(screen.getByText('Intake Inbox')).toBeTruthy());
    expect(screen.queryByText('Back')).toBeNull();
  });

  it('desktop: both panes render simultaneously', async () => {
    mockMatchMedia(false);
    render(<IntakeInboxPage onBidAccepted={noop} />);

    await waitFor(() => expect(screen.getByText('Acme HQ Rewire')).toBeTruthy());
    // List header and the empty-detail placeholder are both present at once.
    expect(screen.getByText('Intake Inbox')).toBeTruthy();
    expect(screen.getByText('Select an item to review')).toBeTruthy();
    expect(screen.queryByText('Back')).toBeNull();
  });
});
