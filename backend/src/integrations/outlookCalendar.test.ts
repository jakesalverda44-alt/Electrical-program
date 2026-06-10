import { describe, it, expect } from 'vitest';
import { toCalendarDay, nextCalendarDay } from './outlookCalendar';

describe('toCalendarDay', () => {
  it('uses an ISO date verbatim (no timezone shift)', () => {
    // The bug: round-tripping "2026-06-20" through a TZ conversion could land on the 19th.
    expect(toCalendarDay('2026-06-20')).toBe('2026-06-20');
    expect(toCalendarDay('2026-01-01')).toBe('2026-01-01');
  });

  it('accepts an ISO datetime by taking the date part', () => {
    expect(toCalendarDay('2026-06-20T14:00:00.000Z')).toBe('2026-06-20');
  });

  it('returns null for empty/garbage', () => {
    expect(toCalendarDay('not a date')).toBeNull();
    expect(toCalendarDay('')).toBeNull();
  });
});

describe('nextCalendarDay', () => {
  it('advances one day', () => {
    expect(nextCalendarDay('2026-06-20')).toBe('2026-06-21');
  });
  it('rolls over month and year boundaries', () => {
    expect(nextCalendarDay('2026-06-30')).toBe('2026-07-01');
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01');
  });
});
