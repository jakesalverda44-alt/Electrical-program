import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDueDays, formatDue, withDueDays } from './dueDate';

describe('parseDueDays', () => {
  beforeEach(() => {
    // Freeze "today" at Jun 1, 2026 for deterministic day-diff math.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
  });
  afterEach(() => vi.useRealTimers());

  it('returns days until an upcoming date this year', () => {
    expect(parseDueDays('Jun 15')).toBe(14);
  });

  it('rolls a past month forward to next year', () => {
    // Jan 1 already passed in June → next Jan 1 is ~214 days out
    expect(parseDueDays('Jan 1')).toBeGreaterThan(180);
  });

  it('defaults to 14 for unparseable input', () => {
    expect(parseDueDays('')).toBe(14);
    expect(parseDueDays('whenever')).toBe(14);
  });

  it('accepts full month names', () => {
    expect(parseDueDays('June 15')).toBe(14);
  });
});

describe('formatDue', () => {
  it('converts ISO dates to "Mon D"', () => {
    expect(formatDue('2026-06-15')).toBe('Jun 15');
    expect(formatDue('2026-01-03')).toBe('Jan 3');
  });

  it('passes through legacy text', () => {
    expect(formatDue('Jul 4')).toBe('Jul 4');
  });

  it('returns TBD for empty input', () => {
    expect(formatDue('')).toBe('TBD');
    expect(formatDue(undefined)).toBe('TBD');
  });
});

describe('withDueDays', () => {
  it('attaches a numeric due_days field', () => {
    const row = withDueDays({ id: 'x', due: '' });
    expect(row).toHaveProperty('due_days');
    expect(typeof row.due_days).toBe('number');
  });
});
