// @vitest-environment happy-dom
// Task 9 (audit code #10) — the regression guard for the workspace split.
//
// The metric: type ONE keystroke into a takeoff line item's unit-cost input on
// the Pricing tab (the only editable number on a takeoff-derived table) and
// measure how much of the workspace React re-rendered.
//
// Two numbers, both taken from React itself:
//   1. Profiler commits — which component boundaries actually re-rendered. Each
//      child module below is mocked to wrap its real component in a
//      <Profiler> behind the same shallow-props memo the real one uses, so a
//      boundary that bails out never fires onRender.
//   2. Elements re-created — how many React elements the commit constructed,
//      counted by wrapping the JSX runtime. This is the number the audit
//      finding is really about: one keystroke used to rebuild the whole tab.
//
// Measured before the split (PcWorkspace.tsx, one 3,175-line component, same
// fixture): 1 boundary — there were no children to skip — and 234 elements.
// After: 3 boundaries (PricingTab, the edited row, the workspace root) and 90
// elements uninstrumented. See the Task 9 section of
// docs/superpowers/plans/2026-09-04-audit-batch4-report.md.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// vi.mock calls are hoisted, so everything they touch has to be hoisted too:
// `commits` is a property of globalThis and `profiled` is a function
// declaration, never a const.
type Commits = string[];
function commitLog(): Commits {
  const g = globalThis as unknown as { __pcCommits?: Commits };
  if (!g.__pcCommits) g.__pcCommits = [];
  return g.__pcCommits;
}

/** Wraps a child module's default export in a <Profiler>, memoized exactly as
 *  the real component is, so a bail-out stays a bail-out. */
function profiled(modulePath: string, id: string, idOf?: (props: Record<string, unknown>) => string) {
  return async () => {
    const actual = await vi.importActual<{ default: unknown }>(modulePath);
    const React = await vi.importActual<typeof import('react')>('react');
    const Wrapped = React.memo(function Instrumented(props: Record<string, unknown>) {
      return React.createElement(
        React.Profiler,
        { id: idOf ? idOf(props) : id, onRender: (pid: string) => { commitLog().push(pid); } },
        React.createElement(actual.default as React.ComponentType<Record<string, unknown>>, props),
      );
    });
    return { ...actual, default: Wrapped };
  };
}

vi.mock('./PcWorkspace/PricingTab', profiled('./PcWorkspace/PricingTab', 'PricingTab'));
vi.mock('./PcWorkspace/PricingRow', profiled('./PcWorkspace/PricingRow', 'PricingRow', p => `PricingRow:${String(p.itemKey)}`));
vi.mock('./PcWorkspace/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./PcWorkspace/ui');
  const React = await vi.importActual<typeof import('react')>('react');
  const wrap = (id: string, C: unknown) => React.memo(function Instrumented(props: Record<string, unknown>) {
    return React.createElement(
      React.Profiler,
      { id, onRender: (pid: string) => { commitLog().push(pid); } },
      React.createElement(C as React.ComponentType<Record<string, unknown>>, props),
    );
  });
  return { ...actual, StepTracker: wrap('StepTracker', actual.StepTracker), TabStrip: wrap('TabStrip', actual.TabStrip) };
});

// Counts every React element constructed while the flag is on.
const jsxCount = { n: 0, on: false };
vi.mock('react/jsx-dev-runtime', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react/jsx-dev-runtime');
  return {
    ...actual,
    jsxDEV: (...args: unknown[]) => {
      if (jsxCount.on) jsxCount.n++;
      return (actual.jsxDEV as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import React, { Profiler, useState } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid, BidEstimate } from '../../types';

afterEach(cleanup);
beforeEach(() => { commitLog().length = 0; });

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: vi.fn(),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

// 12 line items across 3 categories — enough that "the whole table re-rendered"
// and "one row re-rendered" are clearly different numbers.
const CATEGORIES = ['LIGHTING', 'BRANCH POWER', 'FIRE ALARM'];
const lineItems = Array.from({ length: 12 }, (_, i) => ({
  category: CATEGORIES[i % 3],
  item: `Item ${i + 1}`,
  qty: i + 1,
  unit: 'EA',
  unit_cost: 101 + i,
  total: (i + 1) * (101 + i),
  overridden: false,
}));

const estimate: BidEstimate = {
  bid_id: 'b1',
  overhead_pct: 10,
  profit_pct: 15,
  line_items: lineItems,
  subtotals: {}, total_direct: 0, total_overhead: 0, total_profit: 0, grand_total: 0,
  comp_count: 0, confidence: 'LOW',
};

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: estimate });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
}

// Mirrors App.tsx: `ws` lives above this component and comes back down as a
// prop, so every keystroke does re-render the workspace root.
function StatefulWrapper({ initialWs }: { initialWs: PcWorkspace }) {
  const [ws, setWs] = useState(initialWs);
  return (
    <Profiler id="root" onRender={pid => commitLog().push(pid)}>
      <PcWorkspaceView
        ws={ws}
        bid={bid}
        onUpdate={setWs}
        onBack={() => {}}
        onConverted={() => {}}
        onBidUpdated={() => {}}
        showToast={() => {}}
        embedded
      />
    </Profiler>
  );
}

describe('PcWorkspace — one keystroke in a unit-cost input', () => {
  it('re-renders the edited row only, and neither the step tracker nor the tab strip', async () => {
    mockApi();
    render(<StatefulWrapper initialWs={{ ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'pricing' as const }}/>);

    // Wait for the saved estimate to land and the table to render.
    await waitFor(() => expect(screen.getByDisplayValue('105')).toBeTruthy());
    await new Promise(r => setTimeout(r, 20));

    const target = screen.getByDisplayValue('105') as HTMLInputElement;
    commitLog().length = 0;
    jsxCount.n = 0;
    jsxCount.on = true;
    fireEvent.change(target, { target: { value: '77777' } });
    jsxCount.on = false;
    const commits = [...commitLog()];

    // eslint-disable-next-line no-console
    console.log(`[Task 9 profiler] boundaries committed: ${JSON.stringify(commits)} · elements re-created: ${jsxCount.n}`);

    expect(screen.getByDisplayValue('77777')).toBeTruthy();

    // The edited row — item 5 is the 2nd BRANCH POWER row (categories cycle) — is
    // the only PricingRow that re-rendered; the other 11 bail out.
    const rows = commits.filter(id => id.startsWith('PricingRow:'));
    expect(rows).toEqual(['PricingRow:BRANCH POWER||Item 5']);

    // The tab strip and the step tracker sit out every edit that is not a tab
    // switch or an autosave-state change.
    expect(commits).not.toContain('TabStrip');
    expect(commits).not.toContain('StepTracker');

    // PricingTab itself must re-render — its totals changed — and so must the
    // workspace root, because `ws` lives in App.tsx above it.
    expect(commits).toContain('PricingTab');
    expect(commits).toContain('root');

    // Upper bounds, not exact values: the guard is that this cannot drift back
    // toward "the whole tab re-rendered" (234 elements before the split, 90
    // after — the Profiler wrappers above use createElement, so they are not
    // counted and the instrumented number is the real one).
    expect(commits.length).toBeLessThanOrEqual(4);
    expect(jsxCount.n).toBeLessThanOrEqual(140);
  });

  it('does not re-render the pricing table when the autosave chip changes', async () => {
    mockApi();
    render(<StatefulWrapper initialWs={{ ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'pricing' as const }}/>);
    await waitFor(() => expect(screen.getByDisplayValue('105')).toBeTruthy());
    await new Promise(r => setTimeout(r, 20));
    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '77777' } });

    // The Batch 2 autosave fires 800ms after the last edit and flips the chip
    // idle → saving → saved. Before the split those two transitions re-rendered
    // the entire estimate table twice for every edit.
    commitLog().length = 0;
    await waitFor(() => expect(screen.getByTestId('pc-save-state').textContent).toBe('Saved'), { timeout: 3000 });
    const commits = [...commitLog()];

    expect(commits).toContain('TabStrip');
    expect(commits).not.toContain('PricingTab');
    expect(commits.filter(id => id.startsWith('PricingRow:'))).toEqual([]);
  });
});
