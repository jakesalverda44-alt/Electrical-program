// Evidence round 4.4 — gap-fill: pure parsing/geometry for the targeted
// re-search. Gap-fill NEVER counts anything by itself — everything here
// produces SUGGESTED marks; only cropCheck.ts's "accept" (or the estimator,
// via a review item) turns one into a counted mark.
import { parseAIJSON } from '../json';
import { displayedToPdf, screenPosition } from '../../estimating/pageGeometry';
import type { RectIn, SheetGeom } from './viewports';

/** Absolute ceiling regardless of caller — a job's own cap (B2: the
 *  reconciled shortfall) is always passed explicitly and is normally much
 *  smaller than this. */
export const MAX_GAPFILL_CANDIDATES = 8;

export interface GapFillCandidate {
  /** Displayed inches on the sheet (top-left origin). */
  xIn: number;
  yIn: number;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

function clean(s: unknown, max = 200): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Pure: the gap-fill model's strict JSON -> validated candidates, mapped
 *  from fractions of the search-area image to displayed inches on the
 *  sheet via `rect`. Malformed entries are dropped, never guessed into
 *  shape; a reply with no usable `marks` array returns null (the caller
 *  treats it the same as "no evidence read"). */
export function parseGapFillReply(text: string, rect: RectIn, maxCandidates = MAX_GAPFILL_CANDIDATES): GapFillCandidate[] | null {
  const parsed = parseAIJSON(text);
  const raw = parsed && Array.isArray(parsed.marks) ? (parsed.marks as unknown[]) : null;
  if (!raw) return null;
  const cap = Math.max(0, Math.min(MAX_GAPFILL_CANDIDATES, maxCandidates));
  const out: GapFillCandidate[] = [];
  for (const m of raw.slice(0, cap)) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const nx = Number(r.x), ny = Number(r.y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
    const confRaw = clean(r.confidence, 10).toLowerCase();
    const confidence: GapFillCandidate['confidence'] = confRaw === 'high' ? 'high' : confRaw === 'low' ? 'low' : 'medium';
    out.push({ xIn: rect.left + nx * rect.width, yIn: rect.top + ny * rect.height, confidence, note: clean(r.note) });
  }
  return out;
}

/** Displayed inches -> PDF user-space points. */
export function candidateToPdfPoint(c: Pick<GapFillCandidate, 'xIn' | 'yIn'>, g: SheetGeom): { x: number; y: number } {
  const p = displayedToPdf(c.xIn * 72, c.yIn * 72, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
}

/** PDF user-space point -> displayed inches (for measuring against a
 *  candidate, which is already in displayed inches). */
function pdfToDisplayedIn(x: number, y: number, g: SheetGeom): { x: number; y: number } {
  const p = screenPosition(x, y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  return { x: p.x / 72, y: p.y / 72 };
}

/** "Excluding existing marks" (the plan's own wording): a candidate within
 *  this radius of an already-counted mark of the SAME type is the same
 *  symbol reported twice, not a miss. 0.35" is generous next to the
 *  counter's own overlap-dedup radius (60 pt ~ 0.83", tuned for TILE-edge
 *  duplicates over a much larger area; gap-fill candidates are a single
 *  crop, so a tighter radius is enough and avoids swallowing two real,
 *  closely-spaced fixtures). */
export const GAPFILL_DEDUP_RADIUS_IN = 0.35;

export function dedupeAgainstExisting(
  candidates: GapFillCandidate[],
  existing: Array<{ x: number; y: number }>,
  g: SheetGeom,
  radiusIn = GAPFILL_DEDUP_RADIUS_IN,
): GapFillCandidate[] {
  const existingIn = existing.map(e => pdfToDisplayedIn(e.x, e.y, g));
  return candidates.filter(c => !existingIn.some(e => Math.hypot(e.x - c.xIn, e.y - c.yIn) <= radiusIn));
}
