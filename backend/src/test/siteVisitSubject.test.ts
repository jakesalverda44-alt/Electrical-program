import { describe, it, expect } from 'vitest';
import { siteVisitSubject } from '../integrations/outlookCalendar';

// The subject is the only part of a site visit readable from Outlook's month view, so
// it carries who and where. Addresses arrive in whatever shape the lead source sent
// them, which is why the city is parsed rather than assumed.
describe('siteVisitSubject', () => {
  it('puts the city after the name', () => {
    expect(siteVisitSubject('Wendy Davis', '10895 Se 131st Lane, Ocklawaha, FL 32179'))
      .toBe('Site Visit – Wendy Davis – Ocklawaha');
  });

  it('handles the Kohler lead format, country and all', () => {
    expect(siteVisitSubject('Bob Weeks', '636 North Golf Course Dr., CRYSTAL RIVER, Florida 34429, United States'))
      .toBe('Site Visit – Bob Weeks – Crystal River');
  });

  it('falls back to just the name when there is no address', () => {
    expect(siteVisitSubject('Jane Homeowner', null)).toBe('Site Visit – Jane Homeowner');
    expect(siteVisitSubject('Jane Homeowner', '')).toBe('Site Visit – Jane Homeowner');
  });

  it('falls back rather than emitting a dangling separator when no city can be read', () => {
    // A street with no city segment — a half-built title reads worse than a short one.
    const subject = siteVisitSubject('Jane Homeowner', '123 Main St');
    expect(subject).toBe('Site Visit – Jane Homeowner');
    expect(subject.endsWith('–')).toBe(false);
  });

  it('does not mistake a state for a city', () => {
    expect(siteVisitSubject('Jane Homeowner', 'FL 32179')).toBe('Site Visit – Jane Homeowner');
  });
});
