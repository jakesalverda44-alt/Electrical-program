import { describe, it, expect } from 'vitest';
import { mapCalendarEventToLead, walkUpLeadName, untitledEventLeadName, CalendarEventSource } from './calendarLeadMap';

const caller = { id: 'user-1', name: 'Jake Salverda' };

// Minimal valid event shape — individual tests override only what they're testing.
const baseEvent: CalendarEventSource = {
  subject: 'Site Visit',
  location: '100 Main St',
  attendees: [],
  bodyText: null,
  start: '2026-08-10T14:00:00Z',
};

describe('mapCalendarEventToLead', () => {
  it('skips internal-domain attendees and picks the first external one', () => {
    const result = mapCalendarEventToLead({
      ...baseEvent,
      attendees: [
        { name: 'Jake S', email: 'JakeS@accuratepowerandtechnology.com' },
        { name: 'Ops Team', email: 'ops@accuratepowerandtechnology.com' },
        { name: 'Jane Customer', email: 'jane@gmail.com' },
        { name: 'Late Attendee', email: 'late@gmail.com' },
      ],
    }, 'evt-1', caller);

    expect(result.email).toBe('jane@gmail.com');
    expect(result.notes).toContain('Jane Customer');
    expect(result.notes).not.toContain('Late Attendee');
    expect(result.notes).not.toContain('Ops Team');
  });

  it('treats a name-only attendee (no email) as external, not internal', () => {
    const result = mapCalendarEventToLead({
      ...baseEvent,
      attendees: [
        { name: 'Jake S', email: 'JakeS@accuratepowerandtechnology.com' },
        { name: 'Walk-in Contact', email: '' },
      ],
    }, 'evt-1b', caller);

    // No email on the external attendee — mapped to null (not ''), consistent with
    // how the rest of the app treats an absent email.
    expect(result.email).toBeNull();
    expect(result.notes).toContain('Walk-in Contact');
  });

  it('appends bodyText after the attendee line', () => {
    const result = mapCalendarEventToLead({
      ...baseEvent,
      attendees: [{ name: 'Jane Customer', email: 'jane@gmail.com' }],
      bodyText: 'Gate code 1234',
    }, 'evt-2', caller);

    expect(result.notes).toBe('Contact: Jane Customer\nGate code 1234');
  });

  it('falls back to Untitled appointment — {date} when the subject is blank', () => {
    const result = mapCalendarEventToLead({ ...baseEvent, subject: '' }, 'evt-3', caller);
    expect(result.name).toMatch(/^Untitled appointment — /);
  });

  it('falls back to Untitled appointment — {date} when the subject is only whitespace', () => {
    const result = mapCalendarEventToLead({ ...baseEvent, subject: '   ' }, 'evt-3b', caller);
    expect(result.name).toMatch(/^Untitled appointment — /);
  });

  it('maps missing location, missing body, no attendees, and a blank subject without throwing', () => {
    expect(() => mapCalendarEventToLead({
      subject: '',
      location: null,
      attendees: [],
      bodyText: null,
      start: null, // all-day / no-time-yet events can carry a null start
    }, 'evt-4', caller)).not.toThrow();

    const result = mapCalendarEventToLead({
      subject: '', location: null, attendees: [], bodyText: null, start: null,
    }, 'evt-4', caller);
    expect(result.address).toBeNull();
    expect(result.notes).toBeNull();
    expect(result.email).toBeNull();
    expect(result.site_visit_at).toBeNull();
  });

  it('maps an all-day event (midnight UTC start) without throwing', () => {
    expect(() => mapCalendarEventToLead({
      ...baseEvent, start: '2026-08-10T00:00:00Z',
    }, 'evt-5', caller)).not.toThrow();
  });

  it('sets the fixed stage/source/salesperson/outlook_event_id fields', () => {
    const result = mapCalendarEventToLead(baseEvent, 'evt-6', caller);
    expect(result.stage).toBe('site-scheduled');
    expect(result.source).toBe('other');
    expect(result.salesperson_id).toBe(caller.id);
    expect(result.salesperson_name).toBe(caller.name);
    expect(result.outlook_event_id).toBe('evt-6');
    expect(result.address).toBe('100 Main St');
    expect(result.site_visit_at).toBe('2026-08-10T14:00:00Z');
  });
});

// Neither name may start with "Site Survey": the wizard header renders
// "Site Survey — {lead name}", so such a name doubles up once the survey is open.
describe('fallback lead names', () => {
  it('names a no-appointment survey after the walk-up and the day', () => {
    expect(walkUpLeadName(new Date('2026-08-03T12:00:00Z'))).toBe('Walk-up — Aug 3, 2026');
  });

  it('names a subject-less appointment after the day', () => {
    expect(untitledEventLeadName(new Date('2026-08-03T12:00:00Z'))).toBe('Untitled appointment — Aug 3, 2026');
  });

  it('keeps both clear of the wizard header prefix', () => {
    const at = new Date('2026-08-03T12:00:00Z');
    expect(walkUpLeadName(at)).not.toMatch(/^Site Survey/);
    expect(untitledEventLeadName(at)).not.toMatch(/^Site Survey/);
  });
});
