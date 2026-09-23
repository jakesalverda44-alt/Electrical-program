// Takeoff accuracy fix round 1 (B6 / S17) — the ONE pure composition path
// every GC document goes through: Agent 4 (or draft) output -> account-terms
// enforcement -> scope-list exclusions -> composeBidData -> CKT rows out ->
// counted quantities enforced -> the checks that block a GC document.
// composeCurrentBidData (routes/preconstruction.ts) runs it on the stored
// rows; the structure test and scripts/renderProposalSample.ts run it on the
// Kissimmee reference, so the committed renders are what the app produces.
// Pure: no I/O.
import type { Agent4Output } from '../ai/agent4Message';
import type { CountResult } from '../ai/countingStage';
import { enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import { zeroQuantityProblems } from '../ai/outputHygiene';
import { enforceAccountTerms, lightingTermsBullet, type AccountTermsSnapshot, type ResolvedTerm } from './accountRules';
import { composeBidData, type ComposeBidRow, type SavedConfidenceItem } from './composeBidData';
import { enforceCountsOnTakeoff, countMismatchProblems } from './enforceCounts';
import { exclusionBulletsFor, excludedScopeProblems, nonElectricalFindings, type ScopeItem, type NonElectricalOverride } from './scopeList';
import { validateBidData, type BidData } from './bidData';

export interface ComposeProposalInput {
  agent4: Agent4Output;
  bidRow: ComposeBidRow;
  /** Formatted price ('' for the pre-bid draft). */
  price: string;
  savedLineItems?: SavedConfidenceItem[];
  accountSnap: AccountTermsSnapshot | null;
  accountResolved: ResolvedTerm[];
  scopeItems: ScopeItem[];
  overrides: NonElectricalOverride[];
  countResult: CountResult | null;
  reviewItems: ReviewItem[] | null;
}

export interface ComposeFailure { check: string; detail: string; category?: string; line?: string }

export interface ComposeProposalOutput {
  data: BidData;
  jobNumberGenerated: boolean;
  ambiguousQtyKeys: string[];
  /** Every deterministic change made to the AI's output (shown in the preview). */
  corrections: string[];
  /** Lines that can't go to the GC (count mismatch, zero qty, excluded, other trade). */
  lineFailures: ComposeFailure[];
  /** validateBidData's structural problems. */
  dataProblems: string[];
}

export function composeProposal(input: ComposeProposalInput): ComposeProposalOutput {
  const enforced = enforceAccountTerms(input.agent4, input.accountSnap, input.accountResolved);
  const corrections = [...enforced.corrections];
  // Task 11 — every Not-included item on the estimator's scope list is an
  // exclusion bullet (deterministic, once).
  const addExclusions = exclusionBulletsFor(input.scopeItems, enforced.output.exclusions ?? []);
  if (addExclusions.length) {
    enforced.output.exclusions = [...(enforced.output.exclusions ?? []), ...addExclusions];
    corrections.push(...addExclusions.map(b => `Exclusion added from the estimator's scope list: "${b}"`));
  }
  const { data, jobNumberGenerated, ambiguousQtyKeys } = composeBidData(input.bidRow, enforced.output, input.price, {
    savedLineItems: input.savedLineItems ?? [],
    lightingTermsBullet: lightingTermsBullet(input.accountResolved.find(t => t.term === 'lighting')),
  });
  // Task 13 — circuit rows ("CKT") are panel-schedule bookkeeping, not
  // takeoff items: they never reach the GC documents.
  for (const cat of data.takeoff) {
    const kept = cat.items.filter(it => !/^ckts?$/i.test(String(it.unit ?? '').trim()));
    for (const it of cat.items) if (!kept.includes(it)) corrections.push(`Circuit row removed from the takeoff: ${cat.name} "${it.item}${it.description ? ` — ${it.description}` : ''}" (${it.qty} CKT).`);
    cat.items = kept;
  }
  data.takeoff = data.takeoff.filter(cat => cat.items.length > 0);
  // Fix round 1 / B1 — counted and estimator-resolved quantities, enforced.
  const countSet = enforcedCounts(input.countResult, input.reviewItems);
  const countFix = enforceCountsOnTakeoff(data.takeoff, input.countResult, countSet);
  data.takeoff = countFix.takeoff;
  corrections.push(...countFix.corrections);

  const lineFailures: ComposeFailure[] = [
    ...countMismatchProblems(data.takeoff, input.countResult, countSet).map(detail => ({ check: 'count_mismatch', detail })),
    ...zeroQuantityProblems(data).map(detail => ({ check: 'zero_quantity', detail })),
    ...excludedScopeProblems(data, input.scopeItems).map(detail => ({ check: 'excluded_scope', detail })),
    ...nonElectricalFindings(data, input.overrides).filter(f => !f.overridden && f.block)
      .map(f => ({ check: 'non_electrical', detail: `${f.category}: "${f.line}" (${f.unit}) looks like ${f.reason}`, category: f.category, line: f.line })),
  ];
  return { data, jobNumberGenerated, ambiguousQtyKeys, corrections, lineFailures, dataProblems: validateBidData(data) };
}
