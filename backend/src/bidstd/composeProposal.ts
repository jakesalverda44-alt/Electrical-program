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
import { zeroQuantityProblems, irrelevantSpecSentences } from '../ai/outputHygiene';
import { enforceAccountTerms, lightingTermsBullet, type AccountTermsSnapshot, type ResolvedTerm } from './accountRules';
import { composeBidData, type ComposeBidRow, type SavedConfidenceItem } from './composeBidData';
import { enforceCountsOnTakeoff, countMismatchProblems } from './enforceCounts';
import { exclusionBulletsFor, excludedScopeFindings, nonElectricalFindings, overrideFor, normalizeLineKey, type ScopeItem, type NonElectricalOverride } from './scopeList';
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

export interface ComposeFailure { check: string; detail: string; category?: string; line?: string; /** The override flag that keeps/picks this line. */ flag?: string }

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
  // Fix round 2 / N-R2-3 — Section C is exactly 3 bullets, deterministically:
  // never a 422 loop that only another Agent 4 run could break.
  corrections.push(...fitSectionC(data));
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
  // R2-B2 — when several lines carry a type's identity, the estimator's pick
  // (override flag count_line:<KEY> on that exact line) decides.
  const picked = (key: string, category: string, line: string) =>
    overrideFor(normalizeLineKey(category, line), input.overrides, `count_line:${key}`) !== null;
  const countFix = enforceCountsOnTakeoff(data.takeoff, input.countResult, countSet, picked);
  data.takeoff = countFix.takeoff;
  corrections.push(...countFix.corrections);

  const lineFailures: ComposeFailure[] = [
    ...countFix.ambiguous.flatMap(a => a.lines.map(l => ({
      check: 'count_line_ambiguous',
      detail: `${a.name}: ${a.lines.length} takeoff lines carry this type — nothing was changed. Mark which one is the counted ${a.name} line: ${l.category} "${l.line}".`,
      category: l.category, line: l.line, flag: `count_line:${a.key}`,
    }))),
    ...countFix.conflicts.map(detail => ({ check: 'count_conflict', detail })),
    ...(countFix.ambiguous.length ? [] : countMismatchProblems(data.takeoff, input.countResult, countSet, picked).map(detail => ({ check: 'count_mismatch', detail }))),
    ...zeroQuantityProblems(data).map(detail => ({ check: 'zero_quantity', detail })),
    ...excludedScopeFindings(data, input.scopeItems, input.overrides).map(f => ({ check: 'excluded_scope', detail: f.detail, category: f.category, line: f.line })),
    // S-R2-6 — text naming a region that conflicts with the project location.
    ...irrelevantSpecSentences(gcScopeText(data), input.bidRow.loc ?? '').block
      .filter(x => overrideFor(normalizeLineKey('spec', x), input.overrides, 'spec') === null)
      .map(x => ({ check: 'irrelevant_spec', detail: `Names a region other than the project's location — owner-spec text for other stores/regions? Remove it, or keep it with a reason: "${x}"`, category: 'spec', line: x, flag: 'spec' })),
    ...nonElectricalFindings(data, input.overrides).filter(f => !f.overridden && f.block)
      .map(f => ({ check: 'non_electrical', detail: `${f.category}: "${f.line}" (${f.unit}) looks like ${f.reason}`, category: f.category, line: f.line })),
  ];
  return { data, jobNumberGenerated, ambiguousQtyKeys, corrections, lineFailures, dataProblems: validateBidData(data) };
}

const C_TITLE = /^\s*C\./;
const FIXTURE_TYPES_BULLET = /^\s*fixture types per schedule/i;

function bt(b: string | { b: string; t: string }): string {
  return typeof b === 'string' ? b : `${b.b}${b.t}`;
}

/** Section C = [lighting procurement, controls & testing, fixture types].
 *  More than 3: the middle bullets are merged into one. Fewer: the standard
 *  controls-and-testing bullet (and, with no fixture types, a schedule
 *  reference) fills the gap. Returns the corrections. */
export function fitSectionC(data: BidData): string[] {
  const c = data.sections.find(x => C_TITLE.test(x.title));
  if (!c || c.bullets.length === 3) return [];
  const before = c.bullets.map(bt);
  const types = c.bullets.find(b => FIXTURE_TYPES_BULLET.test(bt(b)));
  const rest = c.bullets.filter(b => b !== types);
  const join = (bs: Array<string | { b: string; t: string }>) => `${bs.map(b => bt(b).trim().replace(/[.;]\s*$/, '')).join('; ')}.`;
  if (c.bullets.length > 3) {
    const [first, ...middle] = rest;
    c.bullets = types ? [first, join(middle), types] : [first, join(middle.slice(0, -1)), middle[middle.length - 1]];
  } else {
    const out = [...rest];
    if (!out.some(b => /\b(control|testing|photocell|occupancy|sensor|contactor)\b/i.test(bt(b)))) {
      out.push('Lighting controls and functional testing per plans prior to final inspection.');
    }
    if (types) out.push(types);
    while (out.length < 3) out.push('Fixture types and mounting per the luminaire schedule.');
    c.bullets = out.slice(0, 3);
  }
  return [`Section C set to exactly 3 bullets (was ${before.length}): ${c.bullets.map(b => `"${bt(b)}"`).join(' / ')}.`];
}

/** The GC-facing scope text the spec check reads: section bullets and exclusions. */
export function gcScopeText(data: Pick<BidData, 'sections' | 'exclusions'>): string {
  return [
    ...data.sections.flatMap(x => x.bullets.map(bt)),
    ...data.exclusions.map(b => bt(b as string | { b: string; t: string })),
  ].join('\n');
}
