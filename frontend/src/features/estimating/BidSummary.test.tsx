// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BidSummary } from './BidSummary';
import { PricingRecap, EMPTY_RECAP, EMPTY_ACCUBID_RECAP, DEFAULT_ACCUBID_SETTINGS, AccubidBidResponse } from './types';

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

describe('BidSummary — price accuracy C4: the sidebar follows the pricing mode', () => {
  const acb = (): AccubidBidResponse => ({
    recap: { ...EMPTY_ACCUBID_RECAP, materialTotal: 3400, fieldLaborCost: 6100, equipmentTotal: 890, generalExpensesTotal: 270, primeCost: 10660, laborOverhead: 2318, totalOverhead: 2318, netCost: 12978, totalMarkup: 2400, salesMarkup: 0, sellingPrice: 15378 },
    settings: DEFAULT_ACCUBID_SETTINGS, totalHours: 111.2, quotes: [], alternates: [],
    costLines: [{ id: 'preview-equipment', kind: 'equipment', description: 'Equipment — default (added on save)', amount: 890, taxPct: 0, sort: 0, preview: true }],
  });

  it('Accubid mode: the Accubid recap, selling price as the total, never Phase A small tools / profit', () => {
    render(<BidSummary recap={recap({ grandTotal: 39026, smallTools: 500, profit: 4000 })} proposed={true} pricingMode="accubid" accubid={acb()} />);
    expect(screen.getByTestId('bs-grand-total').textContent).toBe('$15,378');
    expect(screen.getByTestId('bs-acb-material').textContent).toBe('$3,400');
    expect(screen.getByTestId('bs-acb-labor').textContent).toBe('$6,100');
    expect(screen.getByTestId('bs-acb-prime').textContent).toBe('$10,660');
    expect(screen.getByTestId('bs-acb-labor-oh').textContent).toBe('$2,318');
    expect(screen.getByTestId('bs-acb-net').textContent).toBe('$12,978');
    expect(screen.getByTestId('bs-acb-markup').textContent).toBe('$2,400');
    expect(screen.getByTestId('bs-acb-preview-defaults').textContent).toMatch(/default equipment line added on save/);
    expect(screen.queryByTestId('bs-small-tools')).toBeNull();
    expect(screen.queryByTestId('bs-profit')).toBeNull();
    expect(screen.getByText(/Field labor \(111\.2 hrs\)/)).toBeTruthy();
  });

  it('Accubid mode before the first price: "Calculating…", never the Phase A total', () => {
    render(<BidSummary recap={recap({ grandTotal: 39026 })} proposed={true} pricingMode="accubid" accubid={null} />);
    expect(screen.getByTestId('bs-accubid-loading')).toBeTruthy();
    expect(screen.getByTestId('bs-grand-total').textContent).toBe('—');
  });

  it('Accubid mode: the stale tag compares the SAVED amount with the Accubid selling price', () => {
    render(<BidSummary recap={recap({ grandTotal: 39026 })} proposed={false} pricingMode="accubid" accubid={acb()} savedGrandTotal={15378} />);
    expect(screen.queryByTestId('bs-stale-tag')).toBeNull();
  });

  it('Phase A mode keeps the Phase A figures', () => {
    render(<BidSummary recap={recap({ grandTotal: 10119, smallTools: 91 })} proposed={false} pricingMode="phase_a" accubid={acb()} />);
    expect(screen.getByTestId('bs-grand-total').textContent).toBe('$10,119');
    expect(screen.getByTestId('bs-small-tools')).toBeTruthy();
    expect(screen.queryByTestId('bs-accubid')).toBeNull();
  });
});

describe('BidSummary — fix round S4: takeoff-review warnings are visible', () => {
  it('shows the count, with every warning in the tooltip', () => {
    render(<BidSummary recap={recap()} proposed={true} reviewFlags={['Possible double count: "WP GFCI receptacle" may be the same as counted Type Duplex receptacle (1)']} />);
    const w = screen.getByTestId('bs-warning-review-flags');
    expect(w.textContent).toMatch(/1 takeoff-review warning/);
    expect(w.getAttribute('title')).toMatch(/WP GFCI receptacle/);
  });
});
