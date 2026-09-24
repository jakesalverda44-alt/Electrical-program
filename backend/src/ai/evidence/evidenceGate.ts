// Evidence round 4.1 — every GC-facing takeoff quantity carries evidence.
// Pure: what counts as evidence for an AI-derived type, and what counts as
// evidence for a line the estimator typed by hand. The DB-aware gate itself
// (reading count_result / est_bid_lines, and NEVER called for the pre-bid
// package) lives in estimating/takeoffReview.ts, the same way the existing
// takeoffGate / budgetPendingGate split works.
import type { TypeCountResult } from '../countMerge';

export type LineEvidenceKind = 'marker' | 'schedule' | 'typical' | 'gapfill' | 'photometric' | 'none';

type EvidenceType = Pick<TypeCountResult, 'sheets' | 'scheduleRows' | 'components' | 'photometricOnly' | 'gapFill'>;

/** What backs a type's count, in priority order. A type can have more than
 *  one kind of evidence (a drawn mark AND a typical top-up); this reports
 *  the strongest one, purely for display — the gate below only cares
 *  whether it's 'none'. */
export function lineEvidenceKind(t: EvidenceType): LineEvidenceKind {
  if ((t.scheduleRows?.length ?? 0) > 0) return 'schedule';
  if ((t.gapFill?.length ?? 0) > 0) return 'gapfill';
  if (t.sheets.some(s => s.used)) return t.photometricOnly ? 'photometric' : 'marker';
  if ((t.components?.typical ?? 0) > 0) return 'typical';
  return 'none';
}

export interface MissingEvidenceType { key: string; type: string; description: string }

/** GC-facing gate, part 1: every counted quantity greater than zero must
 *  carry SOME evidence. Host markers (multipliers, never a line of their
 *  own) and merged types (their count belongs to the type they merged
 *  into) are never checked here — the same skip enforcedCounts already
 *  applies when it builds the actual takeoff quantities. */
export function missingEvidenceTypes(types: TypeCountResult[]): MissingEvidenceType[] {
  return types
    .filter(t => !t.host && t.status !== 'merged' && t.status === 'counted' && t.count > 0)
    .filter(t => lineEvidenceKind(t) === 'none')
    .map(t => ({ key: t.key, type: t.type, description: t.description }));
}

export interface EvidenceLineLike {
  description: string;
  source: 'takeoff' | 'manual';
  qty_source?: 'takeoff' | 'manual' | 'markup';
  evidence_note?: string | null;
  excluded?: boolean;
}

const MIN_REASON_LEN = 10;

/** GC-facing gate, part 2: a manual line (typed straight into Labor &
 *  Pricing, never sourced from the takeoff) or a takeoff line the
 *  estimator hand-overrode the quantity on has, by definition, no AI
 *  evidence trail — a real reason text stands in for it. An excluded line
 *  never reaches a GC document, so it's never gated. */
export function manualLinesMissingReason(lines: EvidenceLineLike[]): EvidenceLineLike[] {
  return lines.filter(l => !l.excluded
    && (l.source === 'manual' || l.qty_source === 'manual')
    && !(typeof l.evidence_note === 'string' && l.evidence_note.trim().length >= MIN_REASON_LEN));
}
