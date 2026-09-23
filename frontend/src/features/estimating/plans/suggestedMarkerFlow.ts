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
