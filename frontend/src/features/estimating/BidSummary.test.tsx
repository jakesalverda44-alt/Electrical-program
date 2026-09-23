// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BidSummary } from './BidSummary';
import { PricingRecap, EMPTY_RECAP } from './types';

afterEach(cleanup);

function recap(overrides: Partial<PricingRecap['totals']> = {}, warnings: Partial<PricingRecap['warnings']> = {}): PricingRecap {
  return {
    lines: [],
    categories: [],
    totals: { ...EMPTY_RECAP.totals, ...overrides },
    warnings: { ...EMPTY_RECAP.warnings, ...warnings },
  };
}

describe('BidSummary — values render from the recap fixture', () => {
  it('renders material/labor/small-tools/overhead/profit/total/sell-per-sf/crew-weeks', () => {
    const r = recap({
      materialSubtotal: 4460, consumables: 89.2, materialTax: 318.44,
      laborHours: 76.01, laborCost: 3040.4, smallTools: 91.21,
      overhead: 799.93, profit: 1319.88, grandTotal: 10119.06, sellPerSf: 2.02, crewWeeks: 0.6334,
    });
    render(<BidSummary recap={r} proposed={false} />);
    expect(screen.getByTestId('bs-material').textContent).toBe('$4,868'); // 4460+89.2+318.44 rounded
    expect(screen.getByTestId('bs-labor').textContent).toBe('$3,040');
    expect(screen.getByTestId('bs-small-tools').textContent).toBe('$91');
    expect(screen.getByTestId('bs-overhead').textContent).toBe('$800');
    expect(screen.getByTestId('bs-profit').textContent).toBe('$1,320');
    expect(screen.getByTestId('bs-grand-total').textContent).toBe('$10,119');
    expect(screen.getByTestId('bs-sell-per-sf').textContent).toBe('$2.02');
    expect(screen.getByTestId('bs-crew-weeks').textContent).toBe('0.6');
  });

  it('shows an "Unsaved" tag on the total when the recap is a proposed (unsaved) mapping', () => {
    render(<BidSummary recap={recap()} proposed={true} />);
    expect(screen.getByTestId('bs-unsaved-tag')).toBeTruthy();
  });

  it('shows no unsaved tag once the estimate is saved', () => {
    render(<BidSummary recap={recap()} proposed={false} />);
    expect(screen.queryByTestId('bs-unsaved-tag')).toBeNull();
  });

  it('shows an em-dash for $/SF when the bid has no known square footage', () => {
    render(<BidSummary recap={recap({ sellPerSf: null })} proposed={false} />);
    expect(screen.getByTestId('bs-sell-per-sf').textContent).toBe('—');
  });
});

describe('BidSummary — fix round 2 / SF3: "Estimate changed since last save"', () => {
  it('shows the stale tag when the live recap total differs from what was actually saved', () => {
    render(<BidSummary recap={recap({ grandTotal: 11000 })} proposed={false} dirty={false} savedGrandTotal={10000} />);
    expect(screen.getByTestId('bs-stale-tag')).toBeTruthy();
    // Mutually exclusive with the other two states — nothing else explains this number.
    expect(screen.queryByTestId('bs-unsaved-tag')).toBeNull();
    expect(screen.queryByTestId('bs-dirty-tag')).toBeNull();
  });

  it('does not show the stale tag when the live total matches what was saved', () => {
    render(<BidSummary recap={recap({ grandTotal: 10000 })} proposed={false} dirty={false} savedGrandTotal={10000} />);
    expect(screen.queryByTestId('bs-stale-tag')).toBeNull();
  });

  it('does not show the stale tag for a bid that has never been saved (savedGrandTotal null)', () => {
    render(<BidSummary recap={recap({ grandTotal: 11000 })} proposed={false} dirty={false} savedGrandTotal={null} />);
    expect(screen.queryByTestId('bs-stale-tag')).toBeNull();
  });

  it('defers to the dirty/unsaved-proposal tags instead of double-flagging while the estimator has unsaved edits', () => {
    render(<BidSummary recap={recap({ grandTotal: 11000 })} proposed={false} dirty={true} savedGrandTotal={10000} />);
    expect(screen.getByTestId('bs-dirty-tag')).toBeTruthy();
    expect(screen.queryByTestId('bs-stale-tag')).toBeNull();
  });
});

describe('BidSummary — warnings', () => {
  it('renders no warnings section when everything is clean', () => {
    render(<BidSummary recap={recap()} proposed={false} />);
    expect(screen.queryByTestId('bs-warnings')).toBeNull();
  });

  // Phase B, Task 8 — "N lines not verified on plans".
  it('shows the not-verified-on-plans warning when linesNotVerifiedOnPlansCount is set, and calls onJumpToPlans', () => {
    const onJumpToPlans = vi.fn();
    render(<BidSummary recap={recap()} proposed={false} linesNotVerifiedOnPlansCount={5} onJumpToPlans={onJumpToPlans} />);
    const btn = screen.getByTestId('bs-warning-not-verified-on-plans');
    expect(btn.textContent).toBe('5 lines not verified on plans');
    fireEvent.click(btn);
    expect(onJumpToPlans).toHaveBeenCalled();
  });

  it('uses singular phrasing for exactly 1 line', () => {
    render(<BidSummary recap={recap()} proposed={false} linesNotVerifiedOnPlansCount={1} />);
    expect(screen.getByTestId('bs-warning-not-verified-on-plans').textContent).toBe('1 line not verified on plans');
  });

  it('renders no not-verified-on-plans warning when the count is 0 or omitted', () => {
    render(<BidSummary recap={recap()} proposed={false} linesNotVerifiedOnPlansCount={0} />);
    expect(screen.queryByTestId('bs-warning-not-verified-on-plans')).toBeNull();
    expect(screen.queryByTestId('bs-warnings')).toBeNull(); // and it alone doesn't open the section
  });

  // Fix round 2 / R2-S4(a) — composeBidData.ts's own ambiguousQtyKeys,
  // surfaced here for the first time (it used to only ever reach server
  // logs). No jump target — see the component's own comment on why.
  describe('ambiguousQtyKeys (Fix round 2 / R2-S4(a))', () => {
    it('shows the ambiguous-qty warning, naming the count, when ambiguousQtyKeys is non-empty', () => {
      render(<BidSummary recap={recap()} proposed={false} ambiguousQtyKeys={['Branch Power::3.1']} />);
      const w = screen.getByTestId('bs-warning-ambiguous-qty');
      expect(w.textContent).toBe('1 item where the GC takeoff qty may not match the saved estimate');
    });

    it('uses plural phrasing for more than one key, and opens the warnings section', () => {
      render(<BidSummary recap={recap()} proposed={false} ambiguousQtyKeys={['Branch Power::3.1', 'Underground Feeders::5.1']} />);
      expect(screen.getByTestId('bs-warning-ambiguous-qty').textContent)
        .toBe('2 items where the GC takeoff qty may not match the saved estimate');
      expect(screen.getByTestId('bs-warnings')).toBeTruthy();
    });

    it('renders no ambiguous-qty warning when the array is empty or omitted', () => {
      render(<BidSummary recap={recap()} proposed={false} ambiguousQtyKeys={[]} />);
      expect(screen.queryByTestId('bs-warning-ambiguous-qty')).toBeNull();
      expect(screen.queryByTestId('bs-warnings')).toBeNull();

      cleanup();
      render(<BidSummary recap={recap()} proposed={false} />);
      expect(screen.queryByTestId('bs-warning-ambiguous-qty')).toBeNull();
    });
  });

  it('clicking the unmatched-lines warning calls onJumpToUnmatched', () => {
    const onJumpToUnmatched = vi.fn();
    render(<BidSummary recap={recap({}, { unmatchedCount: 2 })} proposed={false} onJumpToUnmatched={onJumpToUnmatched} />);
    const btn = screen.getByTestId('bs-warning-unmatched');
    expect(btn.textContent).toContain('2 unmatched lines');
    fireEvent.click(btn);
    expect(onJumpToUnmatched).toHaveBeenCalled();
  });

  it('R2-SF1: shows and counts fuzzy matches separately from unmatched lines', () => {
    const onJumpToUnmatched = vi.fn();
    render(<BidSummary recap={recap({}, { fuzzyMatchCount: 3 })} proposed={false} onJumpToUnmatched={onJumpToUnmatched} />);
    const btn = screen.getByTestId('bs-warning-fuzzy');
    expect(btn.textContent).toContain('3 fuzzy matches');
    fireEvent.click(btn);
    expect(onJumpToUnmatched).toHaveBeenCalled();
  });

  it('clicking the VERIFY-quantities warning calls onJumpToVerify', () => {
    const onJumpToVerify = vi.fn();
    render(<BidSummary recap={recap({}, { verifyCount: 1 })} proposed={false} onJumpToVerify={onJumpToVerify} />);
    const btn = screen.getByTestId('bs-warning-verify');
    expect(btn.textContent).toContain('1 VERIFY quantity');
    fireEvent.click(btn);
    expect(onJumpToVerify).toHaveBeenCalled();
  });

  it('shows the unverified-material-share and excluded-count warnings as informational (not clickable actions)', () => {
    render(<BidSummary recap={recap({}, { unverifiedMaterialShare: 0.13, excludedCount: 3 })} proposed={false} />);
    expect(screen.getByTestId('bs-warning-unverified').textContent).toContain('13% of material is unverified pricing');
    expect(screen.getByTestId('bs-warning-excluded').textContent).toContain('3 lines excluded');
  });
});

describe('BidSummary — $/SF vs comparables bar', () => {
  it('places the marker proportionally between the comps min and max', () => {
    render(
      <BidSummary
        recap={recap({ sellPerSf: 3 })}
        proposed={false}
        comparables={[{ amount: 200_000, sqFt: 100_000 }, { amount: 400_000, sqFt: 100_000 }]} // $2/SF and $4/SF
      />
    );
    // sellPerSf=3 is exactly halfway between comps min ($2) and max ($4).
    const marker = screen.getByTestId('bs-comps-bar-marker');
    expect(marker.style.left).toBe('50%');
  });

  it('renders no comps bar when there are no comparables with known sq ft', () => {
    render(<BidSummary recap={recap({ sellPerSf: 3 })} proposed={false} comparables={[]} />);
    expect(screen.queryByTestId('bs-comps-bar-wrap')).toBeNull();
  });
});

describe('BidSummary — Insights', () => {
  it('is collapsed by default and expands on click', () => {
    render(<BidSummary recap={recap()} proposed={false} insights={<div data-testid="costs-content">Costs</div>} />);
    expect(screen.queryByTestId('bs-insights-body')).toBeNull();
    fireEvent.click(screen.getByTestId('bs-insights-toggle'));
    expect(screen.getByTestId('costs-content')).toBeTruthy();
  });

  it('renders no Insights toggle at all when nothing is passed', () => {
    render(<BidSummary recap={recap()} proposed={false} />);
    expect(screen.queryByTestId('bs-insights-toggle')).toBeNull();
  });
});
