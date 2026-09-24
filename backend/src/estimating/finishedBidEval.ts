// Evidence round 5.2 — "Finished bid": attach an answer key (a Chris BOM/
// breakdown import reference, or the bid's own confirmed counts) and store
// it as an eval case, in the SAME shape scripts/evalTakeoff.ts already reads
// (eval/takeoffEval.ts's ExpectedItem). Pure derivation here; the DB write
// (finishBidEvalCase) is the thin I/O half in routes/preconstruction.ts.
import type { CountResult, CountResultEvidence } from '../ai/countingStage';
import { enforcedCounts } from '../ai/reviewItems';
import type { ReviewItem } from '../ai/reviewItems';
import type { ExpectedItem } from '../eval/takeoffEval';

export interface DerivedExpectedItem extends ExpectedItem {
  /** Where the number came from: the estimator's confirmed count (no open
   *  review item, or its resolution), never a raw AI guess. */
  source: 'confirmed' | 'resolved';
}

/** Pure: the bid's FINAL, estimator-confirmed quantities — never an
 *  unresolved AI count. A type still open in review (no resolution, not yet
 *  status 'counted') contributes nothing: an eval case is only ever built
 *  from numbers the estimator has actually signed off on, one way or
 *  another. Host markers and merged types are skipped (their count belongs
 *  to another line, or is a multiplier, never a real answer of its own). */
export function deriveExpectedFromConfirmedCounts(countResult: CountResult, reviewItems: ReviewItem[]): DerivedExpectedItem[] {
  const enforced = enforcedCounts(countResult, reviewItems);
  const resolvedKeys = new Set(reviewItems.filter(i => i.resolution).map(i => i.typeKey).filter((k): k is string => !!k));
  const out: DerivedExpectedItem[] = [];
  for (const t of countResult.types) {
    if (t.host || t.status === 'merged') continue;
    const enforcedQty = enforced.byType.get(t.key);
    const qty = enforcedQty !== undefined ? enforcedQty : (t.status === 'counted' ? t.count : undefined);
    if (qty == null || qty <= 0) continue; // null = not on this job; undefined/0 = no real answer yet
    out.push({
      id: t.key, label: `Type ${t.type}${t.description ? ` — ${t.description}` : ''}`,
      expected: qty, types: [t.key],
      source: resolvedKeys.has(t.key) ? 'resolved' : 'confirmed',
    });
  }
  return out;
}

export interface FinishedBidEvalCase {
  bidId: string;
  runId: string | null;
  client: string | null;
  projectType: string | null;
  source: 'confirmed_counts' | 'bom_import';
  expected: DerivedExpectedItem[];
  /** What this was derived from — a document/run reference, never the
   *  actual AI usage/cost data (that lives on takeoff_results already). */
  inputsRef: { runId: string | null; inputsHash?: string | null; bomImportDocumentId?: string | null };
  evidenceSummary?: Pick<CountResultEvidence, 'model'> | null;
}
