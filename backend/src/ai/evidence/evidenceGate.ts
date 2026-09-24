// Evidence round 4.1 — every GC-facing takeoff quantity carries evidence.
// Pure: what counts as evidence for an AI-derived type, and what counts as
// evidence for a line the estimator typed by hand. The DB-aware gate itself
// (reading count_result / est_bid_lines, and NEVER called for the pre-bid
// package) lives in estimating/takeoffReview.ts, the same way the existing
// takeoffGate / budgetPendingGate split works.
//
// Fix round (review a479103):
//   * S14 — a type the estimator RESOLVED (any review-item resolution:
//     "not on this job", a typed count, confirmed markers) has the
//     estimator's own word for it — that resolution IS the evidence, even
//     when the AI side never found a mark. `missingEvidenceTypes` now takes
//     the resolved keys and skips them.
//   * B2 — a gap-fill "accept" is never, by itself, a line's evidence any
//     more (it only ever produces a suggested marker + a review item); the
//     'gapfill' evidence kind is gone. Once the estimator confirms that
//     marker (through the ordinary Plans-view flow) it is a real 'marker',
//     same as any other confirmed count.
//   * S6 — a reason must be a REAL one (isRealReason: 10+ characters, with
//     actual letters in it — not `'..........'`), not just long enough.
import type { TypeCountResult } from '../countMerge';
import { isRealReason } from '../reviewItems';

export type LineEvidenceKind = 'marker' | 'schedule' | 'typical' | 'photometric' | 'resolved' | 'none';

type EvidenceType = Pick<TypeCountResult, 'sheets' | 'scheduleRows' | 'components' | 'photometricOnly'>;

/** What backs a type's count, in priority order. A type can have more than
 *  one kind of evidence (a drawn mark AND a typical top-up); this reports
 *  the strongest one, purely for display — the gate below only cares
 *  whether it's 'none'. */
export function lineEvidenceKind(t: EvidenceType): LineEvidenceKind {
  if ((t.scheduleRows?.length ?? 0) > 0) return 'schedule';
  if (t.sheets.some(s => s.used)) return t.photometricOnly ? 'photometric' : 'marker';
  if ((t.components?.typical ?? 0) > 0) return 'typical';
  return 'none';
}

export interface MissingEvidenceType { key: string; type: string; description: string }

/** GC-facing gate, part 1: every counted quantity greater than zero must
 *  carry SOME evidence. Host markers (multipliers, never a line of their
 *  own) and merged types (their count belongs to the type they merged
 *  into) are never checked here — the same skip enforcedCounts already
 *  applies when it builds the actual takeoff quantities. S14 — a type with
 *  a review-item RESOLUTION (any action) is never checked either: the
 *  estimator has already put their own word behind that number, which is
 *  exactly what this gate exists to require. */
export function missingEvidenceTypes(types: TypeCountResult[], resolvedKeys: ReadonlySet<string> = new Set()): MissingEvidenceType[] {
  return types
    .filter(t => !t.host && t.status !== 'merged' && t.status === 'counted' && t.count > 0)
    .filter(t => !resolvedKeys.has(t.key))
    .filter(t => lineEvidenceKind(t) === 'none')
    .map(t => ({ key: t.key, type: t.type, description: t.description }));
}

export interface EvidenceLineLike {
  /** Fix round (N5) — the caller's own stable id for this line (its
   *  line_key), used to build a stable review-item id instead of the
   *  description (two lines can share a description). */
  lineKey?: string;
  description: string;
  source: 'takeoff' | 'manual';
  qty_source?: 'takeoff' | 'manual' | 'markup';
  evidence_note?: string | null;
  excluded?: boolean;
}

/** GC-facing gate, part 2: a manual line (typed straight into Labor &
 *  Pricing, never sourced from the takeoff) or a takeoff line the
 *  estimator hand-overrode the quantity on has, by definition, no AI
 *  evidence trail — a real reason text stands in for it. An excluded line
 *  never reaches a GC document, so it's never gated. S6 — the reason must
 *  pass `isRealReason` (10+ chars, real letters), not just be long enough. */
export function manualLinesMissingReason(lines: EvidenceLineLike[]): EvidenceLineLike[] {
  return lines.filter(l => !l.excluded
    && (l.source === 'manual' || l.qty_source === 'manual')
    && !isRealReason(l.evidence_note ?? ''));
}
