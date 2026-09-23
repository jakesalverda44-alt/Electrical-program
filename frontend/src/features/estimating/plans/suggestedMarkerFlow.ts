// Estimating Phase B, Task 7 (deferral closed) — pure glue between
// tagSuggest.ts's TagCandidate[] and markupHistory.ts's MarkupDraft[].
// Kept separate from PlansWorkspace.tsx (which owns the actual
// fetching/mutating) so the "candidate -> draft" conversion — including its
// dedup-against-existing-markers rule — is independently unit-testable.
import { TagCandidate } from './tagSuggest';
import { MarkupDraft, MarkupPoint } from './markupHistory';

/** How close two points have to be (in PDF points) to count as "the same
 *  spot" for dedup purposes — small enough that two genuinely distinct
 *  device tags a few inches apart never collide, large enough to absorb
 *  floating-point noise from repeated identical tokenization. */
const DEDUP_TOLERANCE_PT = 0.5;

function samePoint(a: MarkupPoint, b: MarkupPoint): boolean {
  return Math.abs(a.x - b.x) < DEDUP_TOLERANCE_PT && Math.abs(a.y - b.y) < DEDUP_TOLERANCE_PT;
}

/** Converts tag-search results into new "suggested" (status: 'suggested',
 *  never rolled up until confirmed — Decision 3 / markupMath.ts) count
 *  markers, for one sheet. Two dedup passes, both by point (not by tag —
 *  the same spot re-suggested under a different matched tag is still just
 *  one marker on the plan):
 *  1. Against `existing` — markers already on this exact sheet (confirmed
 *     OR still-suggested; re-running "Suggest markers" must never pile up
 *     duplicates at the same spot every time it's clicked).
 *  2. Within the candidate batch itself (a title-block-adjacent run
 *     matching two different tags at the very same center point, etc).
 *  `lineKeyForTag` resolves each candidate's matched tag to the line it
 *  belongs to — the caller decides that policy (a single fixed line_key for
 *  "Suggest markers for THIS line", or an ambiguity-aware lookup built by
 *  tagSuggest.ts's buildLineTagIndex for "Suggest markers for this sheet",
 *  which returns null — left for the estimator to assign — when a tag is
 *  claimed by more than one line, or by none). */
// Fix round 1 / S2 — "Confirm all on this sheet" used to blindly promote
// EVERY 'suggested' marker on the sheet to 'confirmed', with no check at
// all against markers the estimator had already hand-placed (and
// confirmed) nearby. The review's own scenario: hand-count 40 A1 troffers
// (40 confirmed count markers), run "Suggest markers" (40 MORE, dashed,
// assigned to the same line via tag matching, each sitting near — but
// past DEDUP_TOLERANCE_PT's tight 0.5pt, and further still once S1's
// geometry fix landed — its corresponding hand click), then "Confirm all":
// the line's rollup doubled to 80. A much LOOSER tolerance (roughly the
// width of a typical device symbol, not floating-point noise) and scoped
// to the SAME line (an unrelated confirmed marker on a different line
// nearby must never block this one) fixes it.
const CONFIRM_DEDUP_TOLERANCE_PT = 24;

export interface ConfirmAllResult {
  /** The full markers array with the applicable suggested -> confirmed
   *  transitions applied — pass straight to mutate(). */
  markers: MarkupDraft[];
  confirmedCount: number;
  /** Left as 'suggested' (never auto-confirmed OR auto-rejected — still
   *  visible, still awaiting the estimator's own explicit call) because a
   *  same-line CONFIRMED marker already existed within
   *  CONFIRM_DEDUP_TOLERANCE_PT. */
  skippedCount: number;
}

/** Promotes every 'suggested' marker on (documentId, pageIndex) to
 *  'confirmed', EXCEPT one within CONFIRM_DEDUP_TOLERANCE_PT of an
 *  ALREADY-confirmed marker on the SAME line — checked against the
 *  marker list as it stood BEFORE this action (never against a sibling
 *  suggested marker also being confirmed in this same pass, which would
 *  wrongly suppress two genuinely distinct, closely-spaced real fixtures
 *  from ever both landing). */
export function confirmAllOnSheet(markers: MarkupDraft[], documentId: string, pageIndex: number): ConfirmAllResult {
  const onSheet = markers.filter(m => m.documentId === documentId && m.pageIndex === pageIndex);
  const alreadyConfirmed = onSheet.filter(m => m.status === 'confirmed');

  const isNearSameLineConfirmed = (m: MarkupDraft): boolean => {
    if (!m.points[0]) return false;
    return alreadyConfirmed.some(c =>
      c.lineKey === m.lineKey && c.points[0]
      && Math.abs(c.points[0].x - m.points[0].x) < CONFIRM_DEDUP_TOLERANCE_PT
      && Math.abs(c.points[0].y - m.points[0].y) < CONFIRM_DEDUP_TOLERANCE_PT
    );
  };

  let confirmedCount = 0;
  let skippedCount = 0;
  const result = markers.map(m => {
    if (!(m.documentId === documentId && m.pageIndex === pageIndex && m.status === 'suggested')) return m;
    if (isNearSameLineConfirmed(m)) { skippedCount++; return m; }
    confirmedCount++;
    return { ...m, status: 'confirmed' as const };
  });

  return { markers: result, confirmedCount, skippedCount };
}

export function draftsFromTagCandidates(
  candidates: TagCandidate[],
  documentId: string,
  pageIndex: number,
  lineKeyForTag: (tag: string) => string | null,
  existing: MarkupDraft[],
  makeId: () => string
): MarkupDraft[] {
  const existingOnSheet = existing.filter(m => m.documentId === documentId && m.pageIndex === pageIndex);
  const out: MarkupDraft[] = [];
  for (const c of candidates) {
    const isDup = existingOnSheet.some(m => m.points[0] && samePoint(m.points[0], c.point))
      || out.some(d => samePoint(d.points[0], c.point));
    if (isDup) continue;
    out.push({
      id: makeId(),
      documentId,
      pageIndex,
      lineKey: lineKeyForTag(c.tag),
      kind: 'count',
      points: [c.point],
      drops: 0,
      dropFt: null,
      slackPct: null,
      status: 'suggested',
      label: c.tag,
    });
  }
  return out;
}
