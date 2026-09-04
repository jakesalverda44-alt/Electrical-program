// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import IntakeInboxPage from './IntakeInboxPage';

afterEach(cleanup);

const procoreItem = {
  id: 'i-procore',
  name: '7-Eleven #42901 (REBID) - Tampa, FL',
  // Already unwrapped by the backend (Task 3: displayGc) — the intake prefill should show
  // this clean legal name, not the junk-wrapped sender display name.
  gc: 'Bay to Bay Properties, LLC',
  loc: 'Tampa, FL',
  contact: null,
  amount: null,
  sheets: null,
  sq_ft: null,
  due: '2026-09-14',
  due_time: '3:00 PM',
  notes: 'Procore invitation — bid due Monday, September 14, 2026 at 3:00 PM. Documents: link present.',
  source: 'email',
  status: 'pending' as const,
  decline_reason: null,
  created_by_name: null,
  created_at: new Date().toISOString(),
  read_at: new Date().toISOString(),
  web_link: 'https://outlook.office.com/mail/id/procore-1',
  from_email: 'bay_to_bay_properties_notifications@procoretech.com',
  received_at: null,
  body_snippet: 'Bid Due: Monday, September 14, 2026 at 03:00 pm ...',
  attachment_names: null,
  team_notified_at: null,
  team_notified_to: null,
  links: {
    procore: 'https://app.procore.com/invitations/778899',
    documents: 'https://app.procore.com/documents/downloads/445566',
  },
};

const plainEmailItem = {
  ...procoreItem,
  id: 'i-plain-email',
  name: 'Kingdom Alachua County Admin Building',
  gc: 'Kingdom Construction',
  due_time: null,
  links: null,
};

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => vi.fn(),
  useOptionalShowToast: () => vi.fn(),
}));

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/intake') return Promise.resolve({ data: [procoreItem, plainEmailItem] });
      if (url === '/intake/notify-defaults') return Promise.resolve({ data: { emails: [], mailConfigured: false } });
      return Promise.resolve({ data: null });
    }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const noop = () => {};

describe('IntakeInboxPage detail-pane polish (Procore links, due time, GC prefill)', () => {
  it('renders Open in Procore and Download Documents buttons with correct hrefs', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);
    await waitFor(() => expect(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL')).toBeTruthy());
    fireEvent.click(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL'));

    await waitFor(() => expect(screen.getByText('Open in Procore')).toBeTruthy());
    const procoreLink = screen.getByText('Open in Procore').closest('a') as HTMLAnchorElement;
    expect(procoreLink.getAttribute('href')).toBe('https://app.procore.com/invitations/778899');
    expect(procoreLink.getAttribute('target')).toBe('_blank');
    expect(procoreLink.getAttribute('rel')).toBe('noopener noreferrer');

    const docsLink = screen.getByText('Download Documents').closest('a') as HTMLAnchorElement;
    expect(docsLink.getAttribute('href')).toBe('https://app.procore.com/documents/downloads/445566');
    expect(docsLink.getAttribute('target')).toBe('_blank');
    expect(docsLink.getAttribute('rel')).toBe('noopener noreferrer');

    // The plain "Open original email" link still renders alongside the new buttons.
    expect(screen.getByText('Open original email').closest('a')?.getAttribute('href'))
      .toBe('https://outlook.office.com/mail/id/procore-1');
  });

  it('shows the due time next to the due date label when present', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);
    await waitFor(() => expect(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL')).toBeTruthy());
    fireEvent.click(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL'));

    // Scope to the label right above the date input (rather than a page-wide text search —
    // the notes summary also contains "3:00 PM", so a global query would match both).
    await waitFor(() => expect(document.querySelector('input[type="date"]')).toBeTruthy());
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const dueLabel = dateInput.previousElementSibling as HTMLElement;
    expect(dueLabel.textContent).toContain('Due Date');
    expect(dueLabel.textContent).toContain('3:00 PM');
    // The due date input remains the editable field.
    expect(dateInput.value).toBe('2026-09-14');
  });

  it('prefills the GC field with the already-unwrapped legal name', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);
    await waitFor(() => expect(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL')).toBeTruthy());
    fireEvent.click(screen.getByText('7-Eleven #42901 (REBID) - Tampa, FL'));

    await waitFor(() => expect(screen.getByText('General Contractor')).toBeTruthy());
    const gcInput = screen.getByText('General Contractor').closest('div')?.querySelector('input') as HTMLInputElement;
    expect(gcInput.value).toBe('Bay to Bay Properties, LLC');
  });

  it('renders neither Procore link button nor a due-time suffix for an item with none', async () => {
    render(<IntakeInboxPage onBidAccepted={noop} />);
    await waitFor(() => expect(screen.getByText('Kingdom Alachua County Admin Building')).toBeTruthy());
    fireEvent.click(screen.getByText('Kingdom Alachua County Admin Building'));

    await waitFor(() => expect(screen.getByText('Open original email')).toBeTruthy());
    expect(screen.queryByText('Open in Procore')).toBeNull();
    expect(screen.queryByText('Download Documents')).toBeNull();

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const dueLabel = dateInput.previousElementSibling as HTMLElement;
    expect(dueLabel.textContent).toBe('Due Date');
  });
});
