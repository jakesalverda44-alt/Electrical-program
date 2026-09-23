// Task 10 — Bid Summary panel. Reads the latest recap (shared via the same
// data the Labor & Pricing step prices from, so both always show the same
// numbers) and renders it as the shell's right-hand (or collapsible/bottom,
// on smaller breakpoints) summary.
import React, { useState } from 'react';
import { moneyFull, moneyDec } from '../../lib/money';
import { PricingRecap } from './types';

export interface ComparableForSummary {
  amount: number | null;
  sqFt: number | null;
}

export interface BidSummaryProps {
  recap: PricingRecap;
  proposed: boolean;
  /** Fix round 1 / S1 — genuine unsaved edits, distinct from `proposed`
   *  (an unsaved SERVER suggestion the estimator hasn't touched yet). */
  dirty?: boolean;
  /** Fix round 2 / SF3 — what's actually persisted in bid_estimates.grand_total.
   *  Compared against recap.totals.grandTotal to catch drift from a library
   *  edit or calibration apply since the last save — a cause other than the
   *  estimator's own in-progress edits (already covered by `dirty`), so
   *  nothing ever silently differs from bids.amount with no indicator at all. */
  savedGrandTotal?: number | null;
  comparables?: ComparableForSummary[];
  onJumpToUnmatched?: () => void;
  onJumpToVerify?: () => void;
  insights?: React.ReactNode;
  /** Fix round 1 / N7 — start the Insights panel pre-opened when the
   *  estimator arrived here from a legacy tab that conceptually IS insights
   *  (Costs/Intel — see steps.ts's legacyTabWantsInsights()), instead of
   *  always collapsed regardless of where they came from. Only consulted on
   *  the FIRST render (a plain useState initializer) — later prop changes
   *  don't re-collapse/reopen a panel the estimator has since toggled. */
  initialInsightsOpen?: boolean;
}

function pctLabel(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function BidSummary({ recap, proposed, dirty, savedGrandTotal, comparables, onJumpToUnmatched, onJumpToVerify, insights, initialInsightsOpen }: BidSummaryProps) {
  const [insightsOpen, setInsightsOpen] = useState(!!initialInsightsOpen);
  const { totals, warnings } = recap;
  const materialAllIn = totals.materialSubtotal + totals.consumables + totals.materialTax;
  // Fix round 2 / SF3 — a cause OTHER than the estimator's own unsaved edits
  // (dirty covers those already): a library edit or calibration apply since
  // the last save recomputes this SAME saved bid's recap differently. Only
  // meaningful once there IS a saved total and nothing else already
  // explains the number on screen.
  const staleEstimate = !dirty && !proposed && savedGrandTotal != null
    && Math.abs(totals.grandTotal - savedGrandTotal) > 0.005;

  const compsPerSf = (comparables ?? [])
    .filter((c): c is { amount: number; sqFt: number } => c.amount != null && c.sqFt != null && c.sqFt > 0)
    .map(c => c.amount / c.sqFt);
  const compsMin = compsPerSf.length ? Math.min(...compsPerSf) : null;
  const compsMax = compsPerSf.length ? Math.max(...compsPerSf) : null;

  return (
    <div data-testid="bid-summary">
      <div className="bs-section">
        <div className="bs-row">
          <span>Material (incl. tax/consumables)</span>
          <span className="bs-row-value" data-testid="bs-material">{moneyFull(materialAllIn)}</span>
        </div>
        <div className="bs-row">
          <span>Labor ({totals.laborHours.toFixed(1)} hrs)</span>
          <span className="bs-row-value" data-testid="bs-labor">{moneyFull(totals.laborCost)}</span>
        </div>
        <div className="bs-row">
          <span>Small tools</span>
          <span className="bs-row-value" data-testid="bs-small-tools">{moneyFull(totals.smallTools)}</span>
        </div>
        <div className="bs-row">
          <span>Overhead</span>
          <span className="bs-row-value" data-testid="bs-overhead">{moneyFull(totals.overhead)}</span>
        </div>
        <div className="bs-row">
          <span>Profit</span>
          <span className="bs-row-value" data-testid="bs-profit">{moneyFull(totals.profit)}</span>
        </div>
      </div>

      <div className="bs-total">
        <span className="bs-total-label">
          Total
          {/* Fix round 1 / S1 — "proposed" (an unsaved server suggestion) and
              "dirty" (genuine unsaved estimator edits) are distinct states
              with distinct tags; a bid can be one, the other, both, or
              neither (a saved bid with no pending edits shows no tag). */}
          {proposed && <span className="bs-unsaved-tag" data-testid="bs-unsaved-tag">Unsaved proposal</span>}
          {!proposed && dirty && <span className="bs-unsaved-tag" data-testid="bs-dirty-tag">Unsaved changes</span>}
          {staleEstimate && <span className="bs-unsaved-tag" data-testid="bs-stale-tag">Estimate changed since last save</span>}
        </span>
        <span className="bs-total-value" data-testid="bs-grand-total">{moneyFull(totals.grandTotal)}</span>
      </div>

      <div className="bs-section">
        <div className="bs-row">
          <span>$/SF</span>
          <span className="bs-row-value" data-testid="bs-sell-per-sf">
            {totals.sellPerSf != null ? moneyDec(totals.sellPerSf) : '—'}
          </span>
        </div>
        <div className="bs-row">
          <span>Crew-weeks</span>
          <span className="bs-row-value" data-testid="bs-crew-weeks">{totals.crewWeeks.toFixed(1)}</span>
        </div>

        {totals.sellPerSf != null && compsMin != null && compsMax != null && (
          <div data-testid="bs-comps-bar-wrap">
            <div className="bs-row"><span>$/SF vs comparables</span></div>
            <div className="bs-comps-bar" data-testid="bs-comps-bar">
              {/* Fix round 1 / N2 — a single comparable (or several identical
                  ones) makes compsMin === compsMax; the old `compsMax >
                  compsMin` guard then skipped the marker entirely, silently
                  hiding the estimator's only comparable data point instead
                  of just not being able to place it on a range. Fall back to
                  0/50/100% depending on whether our own $/SF is below, at,
                  or above that single value. */}
              <div
                className="bs-comps-bar-marker"
                data-testid="bs-comps-bar-marker"
                style={{
                  left: `${compsMax > compsMin
                    ? Math.max(0, Math.min(100, ((totals.sellPerSf - compsMin) / (compsMax - compsMin)) * 100))
                    : (totals.sellPerSf < compsMin ? 0 : totals.sellPerSf > compsMax ? 100 : 50)
                  }%`,
                }}
              />
            </div>
            <div className="bs-row" style={{ fontSize: 11 }}>
              <span>{moneyDec(compsMin)}</span>
              <span>{moneyDec(compsMax)}</span>
            </div>
          </div>
        )}
      </div>

      {(warnings.unmatchedCount > 0 || warnings.verifyCount > 0 || warnings.zeroMaterialMatchedCount > 0
        || warnings.excludedCount > 0 || warnings.unverifiedMaterialShare > 0) && (
        <div className="bs-section" data-testid="bs-warnings">
          {warnings.unmatchedCount > 0 && (
            <button type="button" className="bs-warning" data-testid="bs-warning-unmatched" onClick={onJumpToUnmatched}>
              {warnings.unmatchedCount} unmatched line{warnings.unmatchedCount === 1 ? '' : 's'}
            </button>
          )}
          {warnings.verifyCount > 0 && (
            <button type="button" className="bs-warning" data-testid="bs-warning-verify" onClick={onJumpToVerify}>
              {warnings.verifyCount} VERIFY quantit{warnings.verifyCount === 1 ? 'y' : 'ies'}
            </button>
          )}
          {warnings.zeroMaterialMatchedCount > 0 && (
            <div className="bs-warning" data-testid="bs-warning-zero-material" style={{ cursor: 'default' }}>
              $0 material on {warnings.zeroMaterialMatchedCount} matched line{warnings.zeroMaterialMatchedCount === 1 ? '' : 's'}
            </div>
          )}
          {warnings.unverifiedMaterialShare > 0 && (
            <div className="bs-warning" data-testid="bs-warning-unverified" style={{ cursor: 'default' }}>
              {pctLabel(warnings.unverifiedMaterialShare)} of material is unverified pricing
            </div>
          )}
          {warnings.excludedCount > 0 && (
            <div className="bs-warning" data-testid="bs-warning-excluded" style={{ cursor: 'default', color: 'var(--text3)' }}>
              {warnings.excludedCount} line{warnings.excludedCount === 1 ? '' : 's'} excluded
            </div>
          )}
        </div>
      )}

      {insights && (
        <div>
          <button
            type="button"
            className="bs-insights-toggle"
            data-testid="bs-insights-toggle"
            aria-expanded={insightsOpen}
            onClick={() => setInsightsOpen(v => !v)}
          >
            {insightsOpen ? '▾' : '▸'} Insights
          </button>
          {insightsOpen && <div data-testid="bs-insights-body">{insights}</div>}
        </div>
      )}
    </div>
  );
}
