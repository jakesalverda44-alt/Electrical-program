// Real-run fix 5 — a consistency safeguard for high-count types on dense
// sheets. Pure.
//
// Two live Opus runs of the same Kissimmee drawings counted Type A 73 then
// 70 and Type B 52 then 45 on E-3. Every mark of the second run sits on a
// mark of the first (A within 5 pt, B within 25 pt): the runs did not
// disagree about WHERE fixtures are, the second one missed some. One pass
// can't tell a miss from a real count, so a type that counts high on one
// sheet (or that the counter flagged as hard to read) is counted a SECOND
// time on a tile grid shifted by half a tile — a symbol cut by a tile edge
// in one pass sits whole in the other — and the two passes are reconciled
// BY LOCATION:
//   * review fix B1 — the pass NEVER lowers a count without a human: pass
//     1's marks stay counted; re-found marks only raise confidence;
//   * a mark only pass 2 found is a SUGGESTED marker (a possible addition),
//     never counted until the estimator confirms it;
//   * pass-1 marks pass 2 did not re-find stay counted; under 85% re-found
//     a BLOCKING review item shows both counts and the disagreeing marks;
//   * the agreement rate (re-found / pass 1) is reported per type.
// Bounded: only those types, only on those sheets, only the shifted tiles
// that cover their marks.
import type { RectIn } from './viewports';

/** A type counted at least this many times on one sheet gets the second pass. */
export const CONSISTENCY_MIN_COUNT = 20;
/** Review fix B1 — agreement = first-pass marks the second pass re-found ÷
 *  first-pass marks. Under this (strictly), a BLOCKING review item shows
 *  both counts and the marks the passes disagree on. The count itself is
 *  never lowered: pass 1's marks stay counted either way. */
export const CONSISTENCY_AGREEMENT_THRESHOLD = 0.85;
/** Two passes' marks within this distance may be the same symbol (the
 *  default; the real radius is tied to the type's own mark spacing). */
export const AGREE_RADIUS_IN = 0.4;
/** The shifted tiles cover the dense types' marks plus this margin. */
export const DENSE_MARGIN_IN = 0.25;
/** Review fix S8 — per-run bounds: at most this many sheets get the pass,
 *  and a sheet needing more shifted tiles than this is left unchecked
 *  (noted), never run unbounded. */
export const MAX_CONSISTENCY_SHEETS = 3;
export const MAX_CONSISTENCY_TILES = 16;
/** Bump when the consistency pass's counter note changes (cache key). */
export const CONSISTENCY_PROMPT_VERSION = 'cs1';

export interface PassMark { typeKey: string; x: number; y: number; circuit?: string; tileIds?: string[] }

export interface ConsistencyEntry {
  sheetKey: string;
  sheetLabel: string;
  typeKey: string;
  why: 'high count' | 'density flagged';
  /** The count: pass 1's marks (never lowered by pass 2). */
  first: number;
  second: number;
  /** First-pass marks the second pass re-found. */
  agreed: number;
  /** First-pass marks the second pass did not re-find — still counted. */
  onlyFirst: number;
  /** Second-pass marks the first pass did not have — suggested only. */
  onlySecond: number;
  /** agreed / first: 1 = pass 2 re-found every counted mark. */
  agreement: number;
  /** agreement < CONSISTENCY_AGREEMENT_THRESHOLD: a blocking review item. */
  lowAgreement?: boolean;
}

export interface ConsistencySuggestion { typeKey: string; sheetKey: string; x: number; y: number; pass: 'first' | 'second' }

/** The (type, why) pairs of one sheet that get the second pass. */
export function consistencyTypes(placed: Array<{ typeKey: string }>, unreadable: Array<{ typeKey: string }>, isHost: (k: string) => boolean = () => false, minCount = CONSISTENCY_MIN_COUNT): Array<{ typeKey: string; why: ConsistencyEntry['why'] }> {
  const n = new Map<string, number>();
  for (const p of placed) n.set(p.typeKey, (n.get(p.typeKey) ?? 0) + 1);
  const out = new Map<string, ConsistencyEntry['why']>();
  for (const [k, c] of n) if (c >= minCount && !isHost(k)) out.set(k, 'high count');
  for (const u of unreadable) if (!out.has(u.typeKey) && (n.get(u.typeKey) ?? 0) > 0 && !isHost(u.typeKey)) out.set(u.typeKey, 'density flagged');
  return [...out.entries()].map(([typeKey, why]) => ({ typeKey, why })).sort((a, b) => a.typeKey.localeCompare(b.typeKey));
}

/** Review fix S8 — the matching radius, tied to how close this type's own
 *  marks sit: 0.75 × the median nearest-neighbour spacing, between 0.2" and
 *  0.5" (0.4" when there are too few marks to measure). */
export function agreeRadiusPt(marks: Array<{ x: number; y: number }>): number {
  if (marks.length < 3) return AGREE_RADIUS_IN * 72;
  const nn = marks.map((a, i) => Math.min(...marks.filter((_, j) => j !== i).map(b => Math.hypot(a.x - b.x, a.y - b.y)))).sort((a, b) => a - b);
  const median = nn[Math.floor(nn.length / 2)];
  return Math.min(0.5 * 72, Math.max(0.2 * 72, 0.75 * median));
}

/** Review fix S8 — a MAXIMUM one-to-one matching of two passes' marks of
 *  ONE type within the radius (augmenting paths, nearest candidates
 *  first), so a jittered mark never steals its neighbour's partner. */
export function reconcilePasses<T extends PassMark>(first: T[], second: T[], radiusPt = agreeRadiusPt(first)): { agreed: T[]; onlyFirst: T[]; onlySecond: T[] } {
  const adj: number[][] = first.map(a => second.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
    .filter(e => e.d <= radiusPt).sort((p, q) => p.d - q.d).map(e => e.j));
  const matchOfSecond = new Array<number>(second.length).fill(-1);
  const order = first.map((_, i) => i).sort((p, q) => adj[p].length - adj[q].length || p - q);
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (const j of adj[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (matchOfSecond[j] < 0 || tryAssign(matchOfSecond[j], seen)) { matchOfSecond[j] = i; return true; }
    }
    return false;
  };
  for (const i of order) tryAssign(i, new Array<boolean>(second.length).fill(false));
  const matchedFirst = new Set(matchOfSecond.filter(i => i >= 0));
  return {
    agreed: first.filter((_, i) => matchedFirst.has(i)),
    onlyFirst: first.filter((_, i) => !matchedFirst.has(i)),
    onlySecond: second.filter((_, j) => matchOfSecond[j] < 0),
  };
}

/** The displayed-inch rectangle covering some marks, with a margin. */
export function coverRect(pointsIn: Array<{ x: number; y: number }>, marginIn = DENSE_MARGIN_IN): RectIn | null {
  if (!pointsIn.length) return null;
  const xs = pointsIn.map(p => p.x), ys = pointsIn.map(p => p.y);
  const left = Math.min(...xs) - marginIn, top = Math.min(...ys) - marginIn;
  return { left, top, width: Math.max(...xs) + marginIn - left, height: Math.max(...ys) + marginIn - top };
}

export function entryOf(sheetKey: string, sheetLabel: string, typeKey: string, why: ConsistencyEntry['why'], r: { agreed: unknown[]; onlyFirst: unknown[]; onlySecond: unknown[] }): ConsistencyEntry {
  const first = r.agreed.length + r.onlyFirst.length, second = r.agreed.length + r.onlySecond.length;
  const agreement = first ? Math.round((r.agreed.length / first) * 1000) / 1000 : 1;
  return {
    sheetKey, sheetLabel, typeKey, why, first, second, agreed: r.agreed.length, onlyFirst: r.onlyFirst.length, onlySecond: r.onlySecond.length, agreement,
    ...(agreement < CONSISTENCY_AGREEMENT_THRESHOLD ? { lowAgreement: true } : {}),
  };
}
