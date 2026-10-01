// Task 10 — Bid Summary panel. Reads the latest recap (shared via the same
// data the Labor & Pricing step prices from, so both always show the same
// numbers) and renders it as the shell's right-hand (or collapsible/bottom,
// on smaller breakpoints) summary.
import React, { useState } from 'react';
import { moneyFull, moneyDec, moneyShort } from '../../lib/money';
import Icon from '../../components/Icon';
import { PricingRecap, AccubidBidResponse, ReviewFlag, ReviewFlagKind } from './types';

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
  /** Accuracy round D5 — jump to the "Needs a price/unit" lines. */
  onJumpToHolds?: () => void;
  /** Phase B, Task 8 — count of takeoff-sourced lines whose qty has not
   *  been confirmed on the plans (qty_source !== 'markup'). A cheap,
   *  lines-only proxy for "not yet verified on plans" — computed by the
   *  caller from estimatingBid.lines, no extra network round trip to the
   *  markups rollup. */
  linesNotVerifiedOnPlansCount?: number;
  onJumpToPlans?: () => void;
  /** Fix round 2 / R2-S4(a) — composeBidData's own `category::item` keys
   *  where the GC takeoff and the saved estimate disagree on how many rows
   *  share that key, so no markup-confirmed qty was safely overridable for
   *  ANY of them (the takeoff silently kept Agent 4's own echoed qty while
   *  the price used the marked one — the same disagreement B5 fixed for
   *  the unambiguous case). Undefined/empty when the proposal preview
   *  hasn't loaded yet or there's nothing to flag. */
  ambiguousQtyKeys?: string[];
  insights?: React.ReactNode;
  /** Price accuracy round C4 — the bid's pricing mode. In Accubid mode the
   *  totals are the Accubid recap (`accubid`), never Phase A's small tools /
   *  overhead / profit; the Phase A figures show only in Phase A mode. */
  pricingMode?: 'phase_a' | 'accubid';
  accubid?: AccubidBidResponse | null;
  /** Fix round S4 — the takeoff-review enforcement's own warnings. */
  reviewFlags?: ReviewFlag[];
  /** Fix round 1 / N7 — start the Insights panel pre-opened when the
   *  estimator arrived here from a legacy tab that conceptually IS insights
   *  (Costs/Intel — see steps.ts's legacyTabWantsInsights()), instead of
   *  always collapsed regardless of where they came from. Only consulted on
   *  the FIRST render (a plain useState initializer) — later prop changes
   *  don't re-collapse/reopen a panel the estimator has since toggled. */
  initialInsightsOpen?: boolean;
}

/** Fix round 2 — each takeoff-review warning kind, labeled. */
const REVIEW_FLAG_KINDS: Array<[ReviewFlagKind, string, string]> = [
  ['count_lowered', 'count lowered by a review answer', 'counts lowered by review answers'],
  ['possible_double', 'possible double count', 'possible double counts'],
  ['ambiguous', 'type on more than one line', 'types on more than one line'],
  ['conflict', 'review answer in conflict with a counted line', 'review answers in conflict with counted lines'],
];

/** Accuracy round D5 — the sidebar line for the held ($0) lines. */
export function holdsText(n: number): string {
  return `Total excludes ${n} held line${n === 1 ? '' : 's'} — needs a price/unit`;
}

function pctLabel(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** UI cleanup round 1 — the headline total, shared by the full panel and the
 *  collapsed strip so the two can never disagree. */
export function bidSummaryHeadline(a: {
  recap: PricingRecap; pricingMode?: 'phase_a' | 'accubid'; accubid?: AccubidBidResponse | null;
  proposed: boolean; dirty?: boolean; savedGrandTotal?: number | null;
}): { label: 'Selling price' | 'Total'; total: number | null; note: string | null } {
  const accubidMode = a.pricingMode === 'accubid';
  const total = accubidMode ? (a.accubid?.recap.sellingPrice ?? null) : a.recap.totals.grandTotal;
  const stale = !a.dirty && !a.proposed && a.savedGrandTotal != null && total != null
    && Math.abs(total - a.savedGrandTotal) > 0.005;
  const note = a.proposed ? 'Unsaved proposal' : a.dirty ? 'Unsaved changes' : stale ? 'Estimate changed since last save' : null;
  return { label: accubidMode ? 'Selling price' : 'Total', total, note };
}

/** UI cleanup round 1 — every warning row of the `bs-warnings` section as
 *  plain data (same order, same conditions, same text), so the collapsed strip
 *  can show the count and list them. BidSummary.test.tsx's parity test keeps
 *  this in step with the rendered rows. `id` is the row's testid suffix. */
export function bidSummaryWarnings(a: {
  warnings: PricingRecap['warnings']; linesNotVerifiedOnPlansCount?: number;
  ambiguousQtyKeys?: string[]; reviewFlags?: ReviewFlag[];
}): Array<{ id: string; text: string; muted: boolean }> {
  const { warnings: w, linesNotVerifiedOnPlansCount: nv, ambiguousQtyKeys: amb, reviewFlags } = a;
  const rows: Array<{ id: string; text: string; muted: boolean }> = [];
  const add = (id: string, text: string, muted = false) => rows.push({ id, text, muted });
  if (nv) add('not-verified-on-plans', `${nv} line${nv === 1 ? '' : 's'} not verified on plans`);
  if (w.unmatchedCount > 0) add('unmatched', `${w.unmatchedCount} unmatched line${w.unmatchedCount === 1 ? '' : 's'}`);
  if (w.fuzzyMatchCount > 0) add('fuzzy', `${w.fuzzyMatchCount} fuzzy match${w.fuzzyMatchCount === 1 ? '' : 'es'} — check match`);
  for (const [kind, one, many] of REVIEW_FLAG_KINDS) {
    const of = (reviewFlags ?? []).filter(f => f.kind === kind);
    if (of.length) add(`review-${kind}`, `${of.length} ${of.length === 1 ? one : many} — check the takeoff review`);
  }
  if (w.confirmMatchCount) add('confirm-match', `${w.confirmMatchCount} match${w.confirmMatchCount === 1 ? '' : 'es'} to confirm — not priced yet`);
  if (w.holds?.length) add('holds', holdsText(w.holds.length));
  if (w.verifyCount > 0) add('verify', `${w.verifyCount} VERIFY quantit${w.verifyCount === 1 ? 'y' : 'ies'}`);
  if (w.zeroMaterialMatchedCount > 0) add('zero-material', `$0 material on ${w.zeroMaterialMatchedCount} matched line${w.zeroMaterialMatchedCount === 1 ? '' : 's'}`);
  if (w.unverifiedMaterialShare > 0) add('unverified', `${pctLabel(w.unverifiedMaterialShare)} of material is unverified pricing`);
  if (w.excludedCount > 0) add('excluded', `${w.excludedCount} line${w.excludedCount === 1 ? '' : 's'} excluded`, true);
  if (amb?.length) add('ambiguous-qty', `${amb.length} item${amb.length === 1 ? '' : 's'} where the GC takeoff qty may not match the saved estimate`);
  return rows;
}

export interface BidSummaryStripProps {
  recap: PricingRecap; proposed: boolean; dirty?: boolean; savedGrandTotal?: number | null;
  pricingMode?: 'phase_a' | 'accubid'; accubid?: AccubidBidResponse | null; reviewFlags?: ReviewFlag[];
  linesNotVerifiedOnPlansCount?: number; ambiguousQtyKeys?: string[];
}

/** UI cleanup round 1 — the collapsed right sidebar's content: total, unsaved
 *  note and warning count. Purely presentational (spans + one Icon) because it
 *  sits inside a <button>. The warning tooltip lists every row, muted included. */
export function BidSummaryStrip(props: BidSummaryStripProps) {
  const h = bidSummaryHeadline(props);
  const rows = bidSummaryWarnings({ warnings: props.recap.warnings, linesNotVerifiedOnPlansCount: props.linesNotVerifiedOnPlansCount, ambiguousQtyKeys: props.ambiguousQtyKeys, reviewFlags: props.reviewFlags });
  const warn = rows.filter(r => !r.muted);
  const full = h.total != null ? moneyFull(h.total) : undefined;
  return (
    <span className="bs-strip" data-testid="bs-strip">
      <span className="est-sr-only">Show bid summary. </span>
      <span className="bs-strip-label">{h.label}</span>
      <span className="bs-strip-total" data-testid="bs-strip-total" aria-hidden="true" title={full}>{h.total != null ? moneyShort(h.total) : '—'}</span>
      <span className="est-sr-only">{h.total != null ? moneyFull(h.total) : 'not priced yet'}</span>
      {h.note && <span className="bs-strip-note" data-testid="bs-strip-note" title={h.note}>●<span className="est-sr-only">{h.note}</span></span>}
      {warn.length > 0 && (
        <span className="bs-strip-warn" data-testid="bs-strip-warnings" title={rows.map(r => r.text).join('\n')}>
          <Icon name="alert" size={12} stroke={2}/>{warn.length}
          <span className="est-sr-only"> warning{warn.length === 1 ? '' : 's'}: {warn.map(r => r.text).join('; ')}</span>
        </span>
      )}
    </span>
  );
}

export function BidSummary({
  recap, proposed, dirty, savedGrandTotal, comparables, onJumpToUnmatched, onJumpToVerify, onJumpToHolds,
  linesNotVerifiedOnPlansCount, onJumpToPlans, ambiguousQtyKeys, insights, initialInsightsOpen, pricingMode, accubid, reviewFlags,
}: BidSummaryProps) {
  const accubidMode = pricingMode === 'accubid';
  const [insightsOpen, setInsightsOpen] = useState(!!initialInsightsOpen);
  const { totals, warnings } = recap;
  const materialAllIn = totals.materialSubtotal + totals.consumables + totals.materialTax;
  // Fix round 2 / SF3 — a cause OTHER than the estimator's own unsaved edits
  // (dirty covers those already): a library edit or calibration apply since
  // the last save recomputes this SAME saved bid's recap differently. Only
  // meaningful once there IS a saved total and nothing else already
  // explains the number on screen.
  const headline = bidSummaryHeadline({ recap, pricingMode, accubid, proposed, dirty, savedGrandTotal });
  const shownTotal = headline.total;
  const staleEstimate = headline.note === 'Estimate changed since last save';

  const compsPerSf = (comparables ?? [])
    .filter((c): c is { amount: number; sqFt: number } => c.amount != null && c.sqFt != null && c.sqFt > 0)
    .map(c => c.amount / c.sqFt);
  const compsMin = compsPerSf.length ? Math.min(...compsPerSf) : null;
  const compsMax = compsPerSf.length ? Math.max(...compsPerSf) : null;

  return (
    <div data-testid="bid-summary">
      {accubidMode ? (
        <AccubidSummaryRows accubid={accubid ?? null} />
      ) : (
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
      )}

      <div className="bs-total">
        <span className="bs-total-label">
          {headline.label}
          {/* Fix round 1 / S1 — "proposed" (an unsaved server suggestion) and
              "dirty" (genuine unsaved estimator edits) are distinct states
              with distinct tags; a bid can be one, the other, both, or
              neither (a saved bid with no pending edits shows no tag). */}
          {proposed && <span className="bs-unsaved-tag" data-testid="bs-unsaved-tag">Unsaved proposal</span>}
          {!proposed && dirty && <span className="bs-unsaved-tag" data-testid="bs-dirty-tag">Unsaved changes</span>}
          {staleEstimate && <span className="bs-unsaved-tag" data-testid="bs-stale-tag">Estimate changed since last save</span>}
        </span>
        <span className="bs-total-value" data-testid="bs-grand-total">{shownTotal != null ? moneyFull(shownTotal) : '—'}</span>
      </div>

      <div className="bs-section">
        <div className="bs-row">
          <span>$/SF</span>
          <span className="bs-row-value" data-testid="bs-sell-per-sf">
            {accubidMode
              ? (totals.sellPerSf != null && totals.grandTotal > 0 && shownTotal != null ? moneyDec(totals.sellPerSf * (shownTotal / totals.grandTotal)) : '—')
              : (totals.sellPerSf != null ? moneyDec(totals.sellPerSf) : '—')}
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
        || warnings.excludedCount > 0 || warnings.unverifiedMaterialShare > 0 || warnings.fuzzyMatchCount > 0 || !!warnings.confirmMatchCount || !!warnings.holds?.length
        || !!linesNotVerifiedOnPlansCount || !!ambiguousQtyKeys?.length || !!reviewFlags?.length) && (
        <div className="bs-section" data-testid="bs-warnings">
          {!!linesNotVerifiedOnPlansCount && (
            <button type="button" className="bs-warning" data-testid="bs-warning-not-verified-on-plans" onClick={onJumpToPlans}>
              {linesNotVerifiedOnPlansCount} line{linesNotVerifiedOnPlansCount === 1 ? '' : 's'} not verified on plans
            </button>
          )}
          {warnings.unmatchedCount > 0 && (
            <button type="button" className="bs-warning" data-testid="bs-warning-unmatched" onClick={onJumpToUnmatched}>
              {warnings.unmatchedCount} unmatched line{warnings.unmatchedCount === 1 ? '' : 's'}
            </button>
          )}
          {/* Fix round 2 / SF1 — a fuzzy match isn't wrong, just worth a
              second look; counted separately from "unmatched" (which means
              no match at all) so the two aren't confused. */}
          {warnings.fuzzyMatchCount > 0 && (
            <button type="button" className="bs-warning" data-testid="bs-warning-fuzzy" onClick={onJumpToUnmatched}>
              {warnings.fuzzyMatchCount} fuzzy match{warnings.fuzzyMatchCount === 1 ? '' : 'es'} — check match
            </button>
          )}
          {REVIEW_FLAG_KINDS.map(([kind, one, many]) => {
            const of = (reviewFlags ?? []).filter(f => f.kind === kind);
            if (!of.length) return null;
            return (
              <div key={kind} className="bs-warning" data-testid={`bs-warning-review-${kind}`} style={{ cursor: 'default' }} title={of.map(f => f.message).join('\n')}>
                {of.length} {of.length === 1 ? one : many} — check the takeoff review
              </div>
            );
          })}
          {!!warnings.confirmMatchCount && (
            <button type="button" className="bs-warning" data-testid="bs-warning-confirm-match" onClick={onJumpToUnmatched}>
              {warnings.confirmMatchCount} match{warnings.confirmMatchCount === 1 ? '' : 'es'} to confirm — not priced yet
            </button>
          )}
          {/* Accuracy round D5 — never a silent $0: the held lines are counted
              and the total says it leaves them out. */}
          {!!warnings.holds?.length && (
            <button type="button" className="bs-warning" data-testid="bs-warning-holds" onClick={onJumpToHolds ?? onJumpToUnmatched}
              title={warnings.holds.map(h => h.description).join('\n')}>
              {holdsText(warnings.holds.length)}
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
          {/* Fix round 2 / R2-S4(a) — no jump target: reconciling this means
              reviewing which of the duplicate category+item rows the marked
              qty belongs to, not a single screen to navigate to. */}
          {!!ambiguousQtyKeys?.length && (
            <div className="bs-warning" data-testid="bs-warning-ambiguous-qty" style={{ cursor: 'default' }} title={ambiguousQtyKeys.join(', ')}>
              {ambiguousQtyKeys.length} item{ambiguousQtyKeys.length === 1 ? '' : 's'} where the GC takeoff qty may not match the saved estimate
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

/** Price accuracy round C4 — the Accubid recap rows (the same breakdown the
 *  Labor & Pricing step's "Selling price breakdown" shows), on the current
 *  lines — proposed or saved, unsaved edits included. */
function AccubidSummaryRows({ accubid }: { accubid: AccubidBidResponse | null }) {
  if (!accubid) {
    return (
      <div className="bs-section" data-testid="bs-accubid-loading">
        <div className="bs-row"><span>Accubid recap</span><span className="bs-row-value">Calculating…</span></div>
      </div>
    );
  }
  const r = accubid.recap;
  const previewDefaults = (accubid.costLines ?? []).filter(c => c.preview);
  const row = (label: string, value: number, testId: string) => (
    <div className="bs-row"><span>{label}</span><span className="bs-row-value" data-testid={testId}>{moneyFull(value)}</span></div>
  );
  return (
    <div className="bs-section" data-testid="bs-accubid">
      {row('Material (incl. tax)', r.materialTotal, 'bs-acb-material')}
      {row(`Field labor (${accubid.totalHours.toFixed(1)} hrs)`, r.fieldLaborCost, 'bs-acb-labor')}
      {r.equipmentTotal > 0 && row('Equipment', r.equipmentTotal, 'bs-acb-equipment')}
      {r.generalExpensesTotal > 0 && row('General expenses', r.generalExpensesTotal, 'bs-acb-ge')}
      {(r.quotesNetTotal + r.quotesTaxTotal) > 0 && row('Quotes', r.quotesNetTotal + r.quotesTaxTotal, 'bs-acb-quotes')}
      {row('Prime cost', r.primeCost, 'bs-acb-prime')}
      {row('Labor overhead', r.laborOverhead, 'bs-acb-labor-oh')}
      {r.totalOverhead - r.laborOverhead > 0.005 && row('Other overhead', r.totalOverhead - r.laborOverhead, 'bs-acb-other-oh')}
      {row('Net cost', r.netCost, 'bs-acb-net')}
      {row('Markup', r.totalMarkup + r.salesMarkup, 'bs-acb-markup')}
      {previewDefaults.length > 0 && (
        <div className="bs-row" style={{ fontSize: 11, color: 'var(--text3)' }} data-testid="bs-acb-preview-defaults">
          <span>Includes the default {previewDefaults.map(c => (c.kind === 'equipment' ? 'equipment' : 'general expenses')).join(' and ')} line{previewDefaults.length === 1 ? '' : 's'} added on save</span>
        </div>
      )}
    </div>
  );
}
