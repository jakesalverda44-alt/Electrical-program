// @vitest-environment happy-dom
// Regression test for Finding 2 of the prebid-package fix wave: the takeoff parser
// retains an unresolved quantity cell as qty: null instead of dropping the row. The
// Takeoff-by-Category drill-down here renders `{l.qty} {l.unit}` directly — with a
// bare `number` type that used to print the literal string "null" next to the unit
// for those rows. It must never render "0" either, since that would misreport an
// unresolved quantity as a known zero quantity.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import BidCompare from './BidCompare';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../../api/client', () => ({
  default: { get: (...a: unknown[]) => get(...a) },
}));

const COMPARABLES = [
  { id: 'c1', name: 'Comp Job', gc: 'GC Co', stage: 'awarded', brand: null, project_type: 'retail',
    sq_ft: 5000, amount: '100000', has_takeoff: true, has_breakdown: false, labor_hours: null,
    awarded_at: '2024-01-01' },
];

const SUBJECT_JOB = {
  id: 'subj', name: 'This Bid', gc: '', stage: 'due', brand: null, project_type: 'retail',
  sq_ft: 5000, amount: '90000', categories: [{ name: 'LIGHTING', itemCount: 1, totals: { EA: 1 } }],
  material_total: null, labor_total: null, equipment_total: null, quotes_total: null,
  labor_hours: null, journeyman_hours: null, apprentice_hours: null,
  avg_labor_rate: null, avg_crew_size: null, labor_risk_ratio: null,
};

const COMP_JOB = {
  ...SUBJECT_JOB, id: 'c1', name: 'Comp Job', stage: 'awarded',
};

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url.endsWith('/comparables')) return Promise.resolve({ data: { comparables: COMPARABLES } });
    if (url.includes('/compare')) return Promise.resolve({ data: { jobs: [SUBJECT_JOB, COMP_JOB], categoryNames: ['LIGHTING'] } });
    if (url.endsWith('/subj/takeoff')) {
      return Promise.resolve({ data: { line_items: [{ category: 'LIGHTING', description: 'Recessed Can', unit: 'EA', qty: null }] } });
    }
    if (url.endsWith('/c1/takeoff')) {
      return Promise.resolve({ data: { line_items: [{ category: 'LIGHTING', description: 'Wall Sconce', unit: 'EA', qty: 4 }] } });
    }
    return Promise.resolve({ data: null });
  });
}

describe('BidCompare — Takeoff by Category drill-down', () => {
  it('renders an unresolved (null) quantity as an em-dash, never "null" or "0", while a resolved qty still renders its number', async () => {
    mockApi();
    const { container } = render(<BidCompare bidId="subj"/>);

    await waitFor(() => expect(screen.getByText('LIGHTING')).toBeTruthy());
    fireEvent.click(screen.getByText('LIGHTING'));

    // The description sits as a bare text node beside the <b>qty unit</b> element (same
    // div, no wrapping element of its own around just the description), so exact
    // getByText matches on the description alone won't hit any element — use a regex
    // (partial match) instead.
    await waitFor(() => expect(screen.getByText(/Recessed Can/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Wall Sconce/)).toBeTruthy());

    expect(container.textContent).toContain('— EA');
    expect(container.textContent).toContain('4 EA');
    expect(container.textContent).not.toContain('null EA');
    expect(container.textContent).not.toContain('0 EA');
  });
});
