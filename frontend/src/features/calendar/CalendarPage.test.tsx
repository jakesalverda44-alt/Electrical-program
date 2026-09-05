// @vitest-environment happy-dom
// Review round 2 N4: `date_won` is a Postgres DATE column, which round-trips
// over the API as UTC midnight for that calendar day (e.g.
// "2026-06-01T00:00:00.000Z"), not as a bare "2026-06-01". A raw
// `new Date(j.date_won)` re-parses that as a real instant, which is the
// PREVIOUS calendar day in any negative-UTC timezone (all of the US) — a job
// won on the 1st of the month lands on May 31 instead of June 1, and since
// May is outside the displayed month, the event silently disappears from the
// calendar entirely rather than merely landing on the wrong square.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CalendarPage from './CalendarPage';
import { WonJob } from '../../types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wonJob: WonJob = {
  id: 'wj-1', salesperson_name: 'Jane Rep', customer: 'Acme Corp',
  proposal_id: 'p-1', proposal_type: 'Electrical', value: 12000,
  date_won: '2026-06-01T00:00:00.000Z',
};

describe('CalendarPage — won-job DATE off-by-one (review round 2 N4)', () => {
  it('places a job won on the 1st of the month on the calendar, in the correct month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // "today" = June 15, 2026 local
    render(<CalendarPage bids={[]} gens={[]} wonJobs={[wonJob]}/>);
    // The calendar defaults to the current month (June 2026), which is
    // exactly where this job belongs. With the bug, `new Date()` re-anchors
    // "2026-06-01T00:00:00.000Z" to May 31 in a negative-UTC timezone, which
    // falls outside the displayed June grid and the event never renders.
    expect(screen.getByText('June 2026')).toBeTruthy();
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText('1 Jobs Won')).toBeTruthy();
  });
});
