// @vitest-environment happy-dom
// Review round 2 N4: `date_won` is a Postgres DATE column, which round-trips
// over the API as UTC midnight for that calendar day (e.g.
// "2026-06-01T00:00:00.000Z"), not a bare "2026-06-01". A raw
// `new Date(j.date_won)` re-parses that as a real instant — the PREVIOUS
// calendar day in any negative-UTC timezone (all of the US) — so a job won
// on the 1st of the month gets bucketed into the PREVIOUS month's total
// instead of its own.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import WonReports from './WonReports';
import { WonJob } from '../../types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wonJob: WonJob = {
  id: 'wj-1', salesperson_name: 'Jane Rep', customer: 'Acme Corp',
  proposal_id: 'p-1', proposal_type: 'Electrical', value: 5000,
  date_won: '2026-06-01T00:00:00.000Z',
};

describe('WonReports — monthly bucketing of a job won on the 1st (review round 2 N4)', () => {
  it('counts the job in June, not May, when "today" is in June', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // "today" = June 15, 2026 local
    render(<WonReports records={[wonJob]} salespeople={[]}/>);

    const chartPanel = screen.getByText(/Contract Value Won by Month/).closest('.panel') as HTMLElement;
    expect(chartPanel).toBeTruthy();
    const totals = Array.from(chartPanel.querySelectorAll('.num')).map(el => el.textContent);
    // Jan .. Jun (6 months) — with the bug, $5,000 lands in the May slot
    // (index 4) instead of June (index 5).
    expect(totals).toEqual(['—', '—', '—', '—', '—', '$5,000']);
  });
});
