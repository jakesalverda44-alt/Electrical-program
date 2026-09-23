// Estimating Phase B, Task 3 — pure markup geometry and per-line rollup
// math. No DB/I/O. Coordinates are always PDF user-space points (Decision
// 5), so every formula here is rotation-agnostic BY CONSTRUCTION: pdf.js
// (both this backend's sheets.ts and the frontend viewer) only ever applies
// rotation when building a VIEWPORT for rendering/hit-testing, never to a
// page's own text/content coordinate space — a markup's stored points never
// need a rotation correction applied to them.
import { EstUnit } from './pricing';
import { unitFamily } from './mapper';

export type MarkupKind = 'count' | 'linear';
export type MarkupStatus = 'confirmed' | 'suggested';

export interface MarkupPoint {
  x: number;
  y: number;
}

/** Thrown by computeRunLengthFt() when a linear run has no scale to measure
 *  against. Callers doing a per-line rollup catch this PER MARKUP (see
 *  rollupLines below) — one unscaled sheet must not blank out every other
 *  line's rollup. */
export class MissingScaleError extends Error {
  constructor() {
    super('This sheet has no confirmed scale — cannot measure a linear run');
    this.name = 'MissingScaleError';
  }
}

/** Straight-line polyline length, summed segment by segment, in whatever
 *  coordinate unit `points` is already in (PDF points, here). Zero for 0 or
 *  1 points (nothing to sum). */
export function polylineLengthPt(points: MarkupPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

export interface RunLengthInput {
  points: MarkupPoint[];
  /** feet per PDF point (est_sheets.ft_per_pt) — null/undefined means the
   *  sheet has no confirmed scale yet. */
  ftPerPt: number | null | undefined;
  drops: number;
  dropFt: number;
  slackPct: number;
}

/** Plan formula (Decision 7): run LF = (polyline_feet + drops * drop_ft) *
 *  (1 + slack_pct / 100). Throws MissingScaleError when ftPerPt isn't a
 *  positive finite number — never silently returns 0 or NaN for an
 *  unscaled sheet, which would otherwise look like "measured, zero feet"
 *  instead of "can't be measured yet". */
export function computeRunLengthFt(input: RunLengthInput): number {
  if (!Number.isFinite(input.ftPerPt) || (input.ftPerPt as number) <= 0) {
    throw new MissingScaleError();
  }
  const ftPerPt = input.ftPerPt as number;
  const lengthPt = polylineLengthPt(input.points);
  const feet = lengthPt * ftPerPt;
  const drops = Number.isFinite(input.drops) && input.drops > 0 ? input.drops : 0;
  const dropFt = Number.isFinite(input.dropFt) && input.dropFt > 0 ? input.dropFt : 0;
  const slackPct = Number.isFinite(input.slackPct) ? input.slackPct : 0;
  const withDrops = feet + drops * dropFt;
  const withSlack = withDrops * (1 + slackPct / 100);
  return withSlack;
}

// ── Per-line rollup ──────────────────────────────────────────────────────

export interface RollupMarkupInput {
  id: string;
  documentId: string;
  pageIndex: number;
  lineKey: string | null;
  kind: MarkupKind;
  status: MarkupStatus;
  points: MarkupPoint[];
  drops: number;
  dropFt: number;
  slackPct: number;
}

export interface RollupLineInput {
  lineKey: string;
  /** The line's DISPLAY unit — what its qty is counted in (est_bid_lines.unit). */
  unit: EstUnit;
}

/** feet-per-point for a (documentId, pageIndex) sheet, or null/undefined if
 *  that sheet has no confirmed scale. */
export type SheetScaleLookup = (documentId: string, pageIndex: number) => number | null | undefined;

export interface SheetContribution {
  documentId: string;
  pageIndex: number;
  /** For a count line: number of confirmed count markers on this sheet. For
   *  a linear line: number of confirmed linear runs on this sheet. */
  markerCount: number;
}

export interface LineRollup {
  lineKey: string;
  /** null when there is nothing to roll up for this line (no confirmed,
   *  unit-compatible markups) — distinct from 0, which is a real measured
   *  zero (e.g. a single-point "linear" run, or a genuinely empty count). */
  markedQty: number | null;
  markerCount: number;
  sheets: SheetContribution[];
  /** Confirmed markups assigned to this line whose kind doesn't match the
   *  line's unit family (a 'count' markup on an LF line, or a 'linear'
   *  markup on an EA line) — never silently included; surfaced here so the
   *  caller can warn instead of guessing. */
  incompatibleCount: number;
  /** Confirmed 'linear' markups assigned to this line whose sheet has no
   *  confirmed scale yet — excluded from markedQty, surfaced so the caller
   *  can point the estimator at exactly which sheet needs calibrating. */
  missingScaleCount: number;
}

/** Rolls confirmed markups up into a marked quantity per line, in each
 *  line's own display unit. Suggested markups never count (Decision 3/
 *  Task 7) — filtered out before anything else. A markup with no line_key
 *  (unassigned) never rolls into anything. Unit-incompatible or
 *  unscaled-sheet markups are excluded from markedQty but counted in the
 *  result so the caller can surface why. */
export function rollupLines(lines: RollupLineInput[], markups: RollupMarkupInput[], sheetScale: SheetScaleLookup): LineRollup[] {
  const byLineKey = new Map<string, RollupMarkupInput[]>();
  for (const m of markups) {
    if (m.status !== 'confirmed') continue; // Decision 3 / Task 7: suggested markers never count
    if (!m.lineKey) continue; // unassigned
    const list = byLineKey.get(m.lineKey) ?? [];
    list.push(m);
    byLineKey.set(m.lineKey, list);
  }

  return lines.map(line => {
    const markupsForLine = byLineKey.get(line.lineKey) ?? [];
    const family = unitFamily(line.unit);

    let markedQty: number | null = null;
    let markerCount = 0;
    let incompatibleCount = 0;
    let missingScaleCount = 0;
    const sheetCounts = new Map<string, SheetContribution>();

    const addSheetHit = (documentId: string, pageIndex: number) => {
      const key = `${documentId}::${pageIndex}`;
      const existing = sheetCounts.get(key);
      if (existing) existing.markerCount += 1;
      else sheetCounts.set(key, { documentId, pageIndex, markerCount: 1 });
    };

    if (family === 'EA') {
      for (const m of markupsForLine) {
        if (m.kind !== 'count') { incompatibleCount++; continue; }
        markerCount++;
        addSheetHit(m.documentId, m.pageIndex);
      }
      if (markerCount > 0) markedQty = markerCount; // one marker = 1 EA
    } else if (family === 'LINEAR') {
      let feetSum = 0;
      let anyCounted = false;
      for (const m of markupsForLine) {
        if (m.kind !== 'linear') { incompatibleCount++; continue; }
        const ftPerPt = sheetScale(m.documentId, m.pageIndex);
        let runFt: number;
        try {
          runFt = computeRunLengthFt({ points: m.points, ftPerPt, drops: m.drops, dropFt: m.dropFt, slackPct: m.slackPct });
        } catch (err) {
          if (err instanceof MissingScaleError) { missingScaleCount++; continue; }
          throw err;
        }
        feetSum += runFt;
        markerCount++;
        anyCounted = true;
        addSheetHit(m.documentId, m.pageIndex);
      }
      if (anyCounted) {
        // Fix round 1 / B4 — `qty` on ANY linear line (LF, C, or M) is
        // always a RAW FEET count; the unit only ever picks a PRICING
        // divisor, applied later by pricing.ts (`qtyFactor = qty /
        // UNIT_DIVISOR[libraryUnit]`) and by mapper.ts's own comment ("the
        // same raw qty (feet) just gets divided by 1, 100 or 1000"). The
        // previous `feetSum / UNIT_DIVISOR[line.unit]` here pre-divided a
        // C/M line's rolled-up qty by 100 or 1000 BEFORE pricing divided
        // it again — a 1,234 ft run on a $60/C line priced as if it were
        // 12.34 ft ($7.40 instead of $740.40). See markupMath.test.ts for
        // the worked end-to-end priceBid proof (EA/LF/C/M).
        markedQty = feetSum;
      }
    } else {
      // OTHER (unrecognized) unit — never a valid rollup target; every
      // confirmed markup assigned to this line is "incompatible".
      incompatibleCount += markupsForLine.length;
    }

    return {
      lineKey: line.lineKey,
      markedQty,
      markerCount,
      sheets: Array.from(sheetCounts.values()),
      incompatibleCount,
      missingScaleCount,
    };
  });
}
