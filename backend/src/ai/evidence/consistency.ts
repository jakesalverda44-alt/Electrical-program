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
//   * a mark both passes found (nearest-first, one-to-one, within 0.4") is
//     counted;
//   * a mark only one pass found is a SUGGESTED marker with a review item,
//     never counted until the estimator confirms it;
//   * the agreement rate is reported per type.
// Bounded: only those types, only on those sheets, only the shifted tiles
// that cover their marks.
import type { RectIn } from './viewports';

/** A type counted at least this many times on one sheet gets the second pass. */
export const CONSISTENCY_MIN_COUNT = 20;
/** Under this agreement the two passes are no check on each other (one of
 *  them saw next to nothing): the first pass stands, flagged. */
export const CONSISTENCY_MIN_AGREEMENT = 0.5;
/** Two passes' marks within this distance are the same symbol. */
export const AGREE_RADIUS_IN = 0.4;
/** The shifted tiles cover the dense types' marks plus this margin. */
export const DENSE_MARGIN_IN = 0.25;

export interface PassMark { typeKey: string; x: number; y: number; circuit?: string; tileIds?: string[] }

export interface ConsistencyEntry {
  sheetKey: string;
  sheetLabel: string;
  typeKey: string;
  why: 'high count' | 'density flagged';
  first: number;
  second: number;
  agreed: number;
  onlyFirst: number;
  onlySecond: number;
  /** agreed / (agreed + onlyFirst + onlySecond): 1 = the passes agree mark for mark. */
  agreement: number;
  /** Under CONSISTENCY_MIN_AGREEMENT: the first pass's count stands,
   *  unconfirmed (a blocking review item), nothing suggested. */
  inconclusive?: boolean;
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

/** Nearest-first, one-to-one matching of two passes' marks of ONE type
 *  (PDF points). */
export function reconcilePasses<T extends PassMark>(first: T[], second: T[], radiusPt = AGREE_RADIUS_IN * 72): { agreed: T[]; onlyFirst: T[]; onlySecond: T[] } {
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  first.forEach((a, i) => second.forEach((b, j) => {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= radiusPt) pairs.push({ i, j, d });
  }));
  pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
  const ui = new Set<number>(), uj = new Set<number>();
  for (const p of pairs) {
    if (ui.has(p.i) || uj.has(p.j)) continue;
    ui.add(p.i); uj.add(p.j);
  }
  return {
    agreed: first.filter((_, i) => ui.has(i)),
    onlyFirst: first.filter((_, i) => !ui.has(i)),
    onlySecond: second.filter((_, j) => !uj.has(j)),
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
  const union = r.agreed.length + r.onlyFirst.length + r.onlySecond.length;
  return { sheetKey, sheetLabel, typeKey, why, first, second, agreed: r.agreed.length, onlyFirst: r.onlyFirst.length, onlySecond: r.onlySecond.length, agreement: union ? Math.round((r.agreed.length / union) * 1000) / 1000 : 1 };
}
