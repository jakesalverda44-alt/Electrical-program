import { describe, it, expect } from 'vitest';
import { parseDueDate, parseProjectName, parseGc, parseLocation, parseContact } from './intakeEmailIngest';

const NOW = new Date('2026-06-10T12:00:00Z');

describe('parseDueDate', () => {
  it('reads a cued numeric date with explicit year', () => {
    expect(parseDueDate('Bids due 6/20/2026 at 2pm', NOW)).toBe('2026-06-20');
  });

  it('reads a numeric date without a year, inferring the current year', () => {
    expect(parseDueDate('Please submit by 7/15', NOW)).toBe('2026-07-15');
  });

  it('rolls a past, year-less date forward to next year', () => {
    // 1/5 already passed in 2026 → assume 2027
    expect(parseDueDate('due 1/5', NOW)).toBe('2027-01-05');
  });

  it('reads a month-name date', () => {
    expect(parseDueDate('Proposals due June 20, 2026', NOW)).toBe('2026-06-20');
  });

  it('handles 2-digit years', () => {
    expect(parseDueDate('bid date 06-20-26', NOW)).toBe('2026-06-20');
  });

  it('returns null when no date is present', () => {
    expect(parseDueDate('Invitation to bid on the new clinic', NOW)).toBeNull();
  });

  it('prefers the date that follows a due cue', () => {
    // sent date 6/1 appears first, but the real due date is cued
    expect(parseDueDate('Sent 6/1. Bids due 6/25/2026.', NOW)).toBe('2026-06-25');
  });

  it('reads a structured "BID DUE DATE:" field (Kingdom)', () => {
    const body = 'DATE: June 16, 2026 ... PROJECT NAME: Alachua County ... BID DUE DATE: 07/17/2026 05:00 PM Eastern';
    expect(parseDueDate(body, NOW)).toBe('2026-07-17');
  });

  it('ignores the letter/send date when it is uncued (Kingdom)', () => {
    // The only cued date is 7/17; the leading "DATE: June 16, 2026" must NOT win.
    const body = 'INVITATION TO BID DATE: June 16, 2026 FROM: Ian Nichols BID DUE DATE: 07/17/2026';
    expect(parseDueDate(body, NOW)).toBe('2026-07-17');
  });

  it('does not mistake a phone number for a due date', () => {
    // 865-691-6818 must not be read as a date now that uncued numbers are rejected.
    expect(parseDueDate('Questions? Call Walker at (865) 691-6818.', NOW)).toBeNull();
  });

  it('returns null for an uncued bare date', () => {
    expect(parseDueDate('Kickoff meeting on 6/30/2026', NOW)).toBeNull();
  });
});

describe('parseGc', () => {
  it('pulls the GC from "from <GC> for <Project>" over the contact name (Kingdom)', () => {
    expect(parseGc(
      'Invitation to Bid from Kingdom Construction for Alachua County Land Conservation Admin Building',
      'Ian Nichols', 'ian@kingdomconstruction.org',
    )).toBe('Kingdom Construction');
  });

  it('uses the sender display name when the subject has no "from … for" (Summit)', () => {
    expect(parseGc('Invitation to Bid - Firestone - (Prototype)', 'Summit General Contractors', 'estimating@summitgc.net'))
      .toBe('Summit General Contractors');
  });

  it('falls back to the sender address when there is no display name', () => {
    expect(parseGc('Reminder to submit your Bid for 7-Eleven', null, 'noreply@procoretech.com'))
      .toBe('noreply@procoretech.com');
  });
});

describe('parseLocation', () => {
  it('pulls a trailing City, ST from the subject (Summit/Procore)', () => {
    expect(parseLocation('Invitation to Bid - AutoZone - St. Johns, FL', '')).toBe('St. Johns, FL');
    expect(parseLocation('Reminder to submit your Bid for 7-Eleven #42759 - Minneola, FL', '')).toBe('Minneola, FL');
  });

  it('reads a structured PROJECT LOCATION field and collapses a repeated address (Kingdom)', () => {
    const body = 'PROJECT NAME: Alachua County PROJECT LOCATION: 8191 NW 43rdST 8191 NW 43rdST, 32653 BID DUE DATE: 07/17/2026';
    expect(parseLocation('Invitation to Bid from Kingdom Construction for Alachua County', body)).toBe('8191 NW 43rdST, 32653');
  });

  it('returns null when there is no location (Summit prototype, address TBD)', () => {
    expect(parseLocation('Invitation to Bid - Firestone - (Prototype)', 'Bids Due 6/24/2026')).toBeNull();
  });

  it('does not treat a "Mental, Physical" subject as a City, ST', () => {
    expect(parseLocation('Pasco Sheriff - Mental, Physical, Emotional Health Center', '')).toBeNull();
  });
});

describe('parseContact', () => {
  it('uses the sender name when it is a person distinct from the GC (Kingdom)', () => {
    expect(parseContact('Ian Nichols', 'ian@kingdomconstruction.org', 'Kingdom Construction')).toBe('Ian Nichols');
  });

  it('falls back to the email when the only name is the GC company itself (Summit)', () => {
    expect(parseContact('Summit General Contractors', 'estimating@summitgc.net', 'Summit General Contractors'))
      .toBe('estimating@summitgc.net');
  });

  it('uses the email when there is no display name', () => {
    expect(parseContact(null, 'noreply@procoretech.com', 'Bay to Bay Properties')).toBe('noreply@procoretech.com');
  });
});

describe('parseProjectName', () => {
  it('strips an "Invitation to Bid:" prefix', () => {
    expect(parseProjectName('Invitation to Bid: Lakeside Medical Office')).toBe('Lakeside Medical Office');
  });

  it('strips ITB and a trailing due fragment', () => {
    expect(parseProjectName('ITB - Riverside Warehouse - Bids Due 6/20')).toBe('Riverside Warehouse');
  });

  it('strips a Re:/Fwd: prefix', () => {
    expect(parseProjectName('FW: Bid Invitation — Oak Street Retail')).toBe('Oak Street Retail');
  });

  it('falls back to the raw subject when nothing matches', () => {
    expect(parseProjectName('Downtown Parking Structure')).toBe('Downtown Parking Structure');
  });

  it('extracts the project from "from <GC> for <Project>" (Kingdom)', () => {
    expect(parseProjectName('Invitation to Bid from Kingdom Construction for Alachua County Land Conservation Admin Building'))
      .toBe('Alachua County Land Conservation Admin Building');
  });

  it('extracts the project from a "Reminder to submit your Bid for …" subject (Procore)', () => {
    expect(parseProjectName('Reminder to submit your Bid for 7-Eleven #42759 - Minneola, FL'))
      .toBe('7-Eleven #42759 - Minneola, FL');
  });

  it('keeps a hyphenated project after the invitation prefix (Summit)', () => {
    expect(parseProjectName('Invitation to Bid - Firestone - (Prototype)')).toBe('Firestone - (Prototype)');
  });
});
