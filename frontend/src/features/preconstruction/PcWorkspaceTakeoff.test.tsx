// @vitest-environment happy-dom
// Regression test for Finding 2 of the prebid-package fix wave: the takeoff parser
// retains an unresolved quantity cell (VERIFY / NONE IDENTIFIED / "TBD — verify") as
// qty: null instead of dropping the row. The Overview tab's "Quantity Takeoff on File"
// panel renders `{l.qty} {l.unit}` directly — with a bare `number` type that render
// used to print the literal string "null" next to the unit for those rows. It must
// never render "0" either, since that would misreport an unresolved quantity as a
// known zero quantity.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const TAKEOFF = {
  categories: [{ name: 'LIGHTING', itemCount: 1, totals: { EA: 1 } }],
  line_items: [
    { category: 'LIGHTING', description: 'Wall Pack Fixture', unit: 'EA', qty: null },
  ],
  item_count: 1,
  source_file: 'takeoff.xlsx',
};

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url.endsWith('/takeoff')) return Promise.resolve({ data: TAKEOFF });
    if (url.startsWith('/documents?linked_id=')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function renderOverviewTab() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'overview' as const };
  return render(
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={() => {}}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />,
  );
}

describe('PcWorkspace Overview tab — Quantity Takeoff on File', () => {
  it('renders an unresolved (null) quantity as an em-dash, never "null" or "0"', async () => {
    mockApi();
    const { container } = renderOverviewTab();

    await waitFor(() => expect(screen.getByText('LIGHTING')).toBeTruthy());
    fireEvent.click(screen.getByText('LIGHTING'));

    // "Wall Pack Fixture" sits as a bare text node beside the <b>qty unit</b> element
    // (same div, no wrapping element of its own), so an exact getByText match on the
    // full sentence works while an exact match on the description alone would not —
    // use a regex (partial match) rather than the exact description string.
    await waitFor(() => expect(screen.getByText(/Wall Pack Fixture/)).toBeTruthy());

    expect(container.textContent).toContain('— EA');
    expect(container.textContent).not.toContain('null EA');
    expect(container.textContent).not.toContain('0 EA');
  });
});
