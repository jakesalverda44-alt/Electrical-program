// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import SurveyFromCalendarModal from './SurveyFromCalendarModal';

afterEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
});

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

const events = [
  {
    id: 'e1', subject: 'Smith Generator Consult', start: '2026-08-04T14:00:00', end: '2026-08-04T15:00:00',
    location: '123 Main St', isAllDay: false, attendees: [], linkedLeadId: null,
  },
  {
    id: 'e2', subject: 'Jones Follow-up', start: '2026-08-04T16:00:00', end: '2026-08-04T17:00:00',
    location: null, isAllDay: false, attendees: [], linkedLeadId: 'lead-9',
  },
];

describe('SurveyFromCalendarModal', () => {
  it('lists events and renders the "Survey started" badge only for linked ones', async () => {
    get.mockResolvedValue({ data: events });
    render(<SurveyFromCalendarModal onClose={vi.fn()} onLeadReady={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Smith Generator Consult')).toBeTruthy());
    expect(screen.getByText('Jones Follow-up')).toBeTruthy();

    // Exactly one row is linked, so exactly one badge should render.
    expect(screen.getAllByText('Survey started')).toHaveLength(1);
    expect(screen.getByText('Jones Follow-up').closest('button')?.textContent).toContain('Survey started');
    expect(screen.getByText('Smith Generator Consult').closest('button')?.textContent).not.toContain('Survey started');
  });

  it('shows the "No appointment — blank survey" footer button in the empty state', async () => {
    get.mockResolvedValue({ data: [] });
    render(<SurveyFromCalendarModal onClose={vi.fn()} onLeadReady={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/No upcoming appointments/i)).toBeTruthy());
    expect(screen.getByText('No appointment — blank survey')).toBeTruthy();
  });

  it('still shows the footer button when the calendar fails to load, so a Graph outage never blocks a survey', async () => {
    get.mockRejectedValue(new Error('network error'));
    render(<SurveyFromCalendarModal onClose={vi.fn()} onLeadReady={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Couldn't load the calendar. Start a blank survey instead.")).toBeTruthy());
    expect(screen.getByText('No appointment — blank survey')).toBeTruthy();
  });

  it('picking an event posts eventId and hands the returned lead to onLeadReady', async () => {
    get.mockResolvedValue({ data: events });
    const lead = { id: 'lead-1', name: 'Smith Generator Consult' };
    post.mockResolvedValue({ data: { lead, created: true } });
    const onLeadReady = vi.fn();
    render(<SurveyFromCalendarModal onClose={vi.fn()} onLeadReady={onLeadReady} />);

    await waitFor(() => expect(screen.getByText('Smith Generator Consult')).toBeTruthy());
    screen.getByText('Smith Generator Consult').closest('button')?.click();

    await waitFor(() => expect(post).toHaveBeenCalledWith('/leads/from-calendar-event', { eventId: 'e1' }));
    await waitFor(() => expect(onLeadReady).toHaveBeenCalledWith(lead));
  });

  it('the blank-survey button posts to /leads/blank-survey and hands the lead to onLeadReady', async () => {
    get.mockResolvedValue({ data: [] });
    const lead = { id: 'lead-2', name: 'Site Survey — 8/4' };
    post.mockResolvedValue({ data: lead });
    const onLeadReady = vi.fn();
    render(<SurveyFromCalendarModal onClose={vi.fn()} onLeadReady={onLeadReady} />);

    await waitFor(() => expect(screen.getByText('No appointment — blank survey')).toBeTruthy());
    screen.getByText('No appointment — blank survey').click();

    await waitFor(() => expect(post).toHaveBeenCalledWith('/leads/blank-survey'));
    await waitFor(() => expect(onLeadReady).toHaveBeenCalledWith(lead));
  });
});
