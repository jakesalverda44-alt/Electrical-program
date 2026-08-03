// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import LeadsPage from './LeadsPage';
import { Lead } from '../../types';

afterEach(cleanup);

const lead: Lead = {
  id: 'l1',
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '555-123-4567',
  address: '123 Main St',
  source: 'kohler',
  contact_method: 'phone',
  interest_level: 'hot',
  stage: 'new',
  created_at: new Date().toISOString(),
};

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/leads') return Promise.resolve({ data: [lead] });
      if (url === '/leads/action-queue') return Promise.resolve({ data: [] });
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

describe('LeadsPage responsive list', () => {
  it('renders mobile cards (tel: link, no 7-col grid header) when the viewport is narrow', async () => {
    mockMatchMedia(true);
    render(<LeadsPage onNav={noop} />);

    await waitFor(() => expect(screen.getByText('Jane Homeowner')).toBeTruthy());

    // tel: link present with stopPropagation-friendly click target
    const call = screen.getByText(/555-123-4567/) as HTMLAnchorElement;
    expect(call.closest('a')?.getAttribute('href')).toBe('tel:5551234567');

    // Desktop table header (7-column grid) must NOT be present
    expect(screen.queryByText('Follow-up')).toBeNull();
  });

  it('renders the desktop grid header when the viewport is wide', async () => {
    mockMatchMedia(false);
    render(<LeadsPage onNav={noop} />);

    await waitFor(() => expect(screen.getByText('Jane Homeowner')).toBeTruthy());

    // Desktop table header row (7-column grid header cell text, unambiguous unlike
    // "Phone" which also appears on the contact-method filter button)
    expect(screen.getByText('Follow-up')).toBeTruthy();
    expect(screen.getByText('Stage')).toBeTruthy();
  });
});
