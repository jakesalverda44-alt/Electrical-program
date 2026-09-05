import { describe, it, expect, vi, afterEach } from 'vitest';
import { dayOf, fmtDate, fmtDateTime } from './date';

afterEach(() => vi.useRealTimers());

describe('dayOf', () => {
  it('parses a bare YYYY-MM-DD as local midnight, not UTC (no off-by-one day)', () => {
    const d = dayOf('2026-09-10');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(0);
  });

  it('parses a full timestamp as the real instant, not just its date digits', () => {
    // A time far from local midnight so the two parsing strategies would
    // disagree if `dayOf` naively re-anchored the date digits to local time.
    const d = dayOf('2026-09-10T15:30:00.000Z');
    expect(d.getTime()).toBe(new Date('2026-09-10T15:30:00.000Z').getTime());
  });
});

describe('fmtDate', () => {
  it('returns an empty string for a missing value', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
    expect(fmtDate('')).toBe('');
  });

  it("year: 'never' omits the year even across years", () => {
    expect(fmtDate('2020-01-15', { year: 'never' })).toBe('Jan 15');
  });

  it("year: 'always' always shows the year", () => {
    const thisYear = new Date().getFullYear();
    expect(fmtDate(`${thisYear}-01-15`, { year: 'always' })).toBe(`Jan 15, ${thisYear}`);
  });

  it("year: 'auto' (default) omits the year when it matches the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));
    expect(fmtDate('2026-09-10')).toBe('Sep 10');
  });

  it("year: 'auto' (default) shows the year when it differs from the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00'));
    expect(fmtDate('2020-09-10')).toBe('Sep 10, 2020');
  });
});

describe('fmtDateTime', () => {
  it('returns an empty string for a missing value', () => {
    expect(fmtDateTime(null)).toBe('');
  });

  it('includes month, day, and time', () => {
    const out = fmtDateTime('2026-09-10T14:05:00.000Z');
    expect(out).toMatch(/Sep 10/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});
