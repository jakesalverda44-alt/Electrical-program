// Accuracy round A3 — registration check between two drawings of the SAME
// site poles (E-7's site lighting plan and PH0.1's photometric plan). Pure.
//
// Two point sets (displayed inches on their own sheets) of 3..7 marks are
// related by a SIMILARITY transform — a scale, a rotation (a multiple of 90°
// plus a small angle) and a translation. A mirror is never fitted: a sheet is
// never drawn flipped, so a mirrored set does not register.
//
// Method: every ordered pair of the larger set anchors the first two points
// of the smaller set (two point pairs fix a similarity); the rest are matched
// greedily to the nearest unused point within the residual limit; the
// matching is refitted by least squares and scored by its worst residual,
// measured on the SMALLER-scale drawing (a residual on the bigger drawing is
// divided by the scale). The best matching that pairs enough points wins.
//
// Accepted when the worst residual <= 0.5" of paper on the smaller-scale
// sheet, the rotation is within 10° of a multiple of 90°, and — when both
// sheets' viewport scales are known — the fitted scale matches their ratio
// within 10%.
//
// Fix round 1 (review B-1 / S3):
//   * the MIRRORED fit is computed too: when the mirror also fits within the
//     limit, the proper fit must be clearly better (residual < MIRROR_MARGIN
//     x the mirror's) or the pair is rejected as ambiguous;
//   * a collinear (or nearly collinear) set cannot fix a transform — every
//     two rows of evenly spaced poles register under some similarity — so it
//     is "not comparable" (comparable: false), never accepted;
//   * `requireScales` (Rule 2): both viewport scales must be known;
//   * `minPoints` (Rule 2): at least that many marks on EACH side;
//   * registerSameSheet: two sets on ONE sheet are duplicates only when they
//     coincide in place (the identity transform pairs them within the limit).

export interface RegPoint { x: number; y: number }

export interface Registration {
  accepted: boolean;
  /** Worst residual of the paired points, inches on the smaller-scale sheet. */
  residualIn: number;
  /** b ≈ scale · R(rotation) · a + t. */
  scale: number;
  rotationDeg: number;
  /** [index in a, index in b] per paired point. */
  pairs: Array<[number, number]>;
  reason: string;
  /** false when the sets cannot be compared at all (collinear / degenerate,
   *  or the mirror fits as well as the proper fit): not "the drawings
   *  disagree", just "no evidence either way". */
  comparable?: boolean;
  /** Proper-fit residual / mirrored-fit residual, when the mirror also fit. */
  mirrorMargin?: { proper: number; mirrored: number; ratio: number };
}

export const REG_MAX_RESIDUAL_IN = 0.5;
export const REG_MAX_POINTS = 7;
export const REG_MIN_POINTS = 3;
const MAX_ANGLE_OFF_DEG = 10;
const SCALE_TOLERANCE = 0.10;
/** The proper fit must beat a mirror that also fits by this factor. */
export const MIRROR_MARGIN = 0.5;
/** A set is degenerate when no point lies farther than this fraction of the
 *  set's diameter from the line through its two farthest points. */
export const DEGENERATE_FRACTION = 0.1;

/** Pure: true when the points are (nearly) collinear — or all coincide. */
export function isDegenerate(pts: RegPoint[]): boolean {
  if (pts.length < 3) return true;
  let bi = 0, bj = 1, bd = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    if (d > bd) { bd = d; bi = i; bj = j; }
  }
  if (bd < 1e-9) return true;
  const ax = pts[bj].x - pts[bi].x, ay = pts[bj].y - pts[bi].y;
  let off = 0;
  for (const p of pts) off = Math.max(off, Math.abs(ax * (p.y - pts[bi].y) - ay * (p.x - pts[bi].x)) / bd);
  return off < DEGENERATE_FRACTION * bd;
}

type C = { re: number; im: number };
const c = (p: RegPoint): C => ({ re: p.x, im: p.y });
const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: C, b: C): C => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const abs = (a: C) => Math.hypot(a.re, a.im);

/** Least-squares similarity b ≈ z·a + t over the paired points. */
function fit(a: C[], b: C[]): { z: C; t: C } | null {
  const n = a.length;
  const am = { re: a.reduce((s, p) => s + p.re, 0) / n, im: a.reduce((s, p) => s + p.im, 0) / n };
  const bm = { re: b.reduce((s, p) => s + p.re, 0) / n, im: b.reduce((s, p) => s + p.im, 0) / n };
  let num: C = { re: 0, im: 0 };
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = sub(a[i], am), y = sub(b[i], bm);
    num = add(num, mul({ re: x.re, im: -x.im }, y));
    den += x.re * x.re + x.im * x.im;
  }
  if (den <= 1e-12) return null;
  const z = { re: num.re / den, im: num.im / den };
  return { z, t: sub(bm, mul(z, am)) };
}

const angleOff90 = (deg: number) => { const r = ((deg % 90) + 90) % 90; return Math.min(r, 90 - r); };

type Best = { pairs: Array<[number, number]>; z: C; resid: number };

/** Best similarity pairing of A (the smaller set) into B. */
function search(A: C[], B: C[], limit: number, need: number): Best | null {
  let best: Best | null = null;
  for (let i = 0; i < B.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (i === j) continue;
      const da = sub(A[1], A[0]);
      if (abs(da) < 1e-9) continue;
      const z0 = div(sub(B[j], B[i]), da);
      if (abs(z0) < 1e-6) continue;
      const t0 = sub(B[i], mul(z0, A[0]));
      const small = Math.min(1, 1 / abs(z0));
      const pairs: Array<[number, number]> = [[0, i], [1, j]];
      const used = new Set([i, j]);
      for (let k = 2; k < A.length; k++) {
        const q = add(mul(z0, A[k]), t0);
        let bi = -1, bd = Infinity;
        for (let m = 0; m < B.length; m++) {
          if (used.has(m)) continue;
          const d = abs(sub(B[m], q));
          if (d < bd) { bd = d; bi = m; }
        }
        // Greedy match only within twice the limit (the refit tightens it).
        if (bi >= 0 && bd * small <= 2 * limit) { pairs.push([k, bi]); used.add(bi); }
      }
      if (pairs.length < need) continue;
      const f = fit(pairs.map(p => A[p[0]]), pairs.map(p => B[p[1]]));
      if (!f) continue;
      // A pairing that needs a non-90°-multiple rotation is not a candidate (it
      // must not mask a proper pairing with a slightly larger residual).
      if (angleOff90((Math.atan2(f.z.im, f.z.re) * 180) / Math.PI) > MAX_ANGLE_OFF_DEG) continue;
      const s = abs(f.z);
      const resid = Math.max(...pairs.map(p => abs(sub(add(mul(f.z, A[p[0]]), f.t), B[p[1]])))) * Math.min(1, 1 / s);
      if (!best || pairs.length > best.pairs.length || (pairs.length === best.pairs.length && resid < best.resid)) best = { pairs, z: f.z, resid };
    }
  }
  return best;
}

/** Pure: register `a` onto `b`. null when either set is outside the allowed
 *  point count (no registration is attempted). `minPaired` is the fraction of
 *  the smaller set that must pair (1 = all of it). */
export function registerPointSets(
  aIn: RegPoint[],
  bIn: RegPoint[],
  opts: { inPerFtA?: number | null; inPerFtB?: number | null; minPaired?: number; maxResidualIn?: number; requireScales?: boolean; minPoints?: number } = {},
): Registration | null {
  const minPts = Math.max(REG_MIN_POINTS, opts.minPoints ?? REG_MIN_POINTS);
  if (aIn.length < minPts || bIn.length < minPts || aIn.length > REG_MAX_POINTS || bIn.length > REG_MAX_POINTS) return null;
  const swap = aIn.length > bIn.length;
  const A = (swap ? bIn : aIn).map(c), B = (swap ? aIn : bIn).map(c);
  const limit = opts.maxResidualIn ?? REG_MAX_RESIDUAL_IN;
  const need = Math.max(REG_MIN_POINTS, Math.ceil((opts.minPaired ?? 1) * A.length - 1e-9));
  const none = (reason: string, comparable?: boolean): Registration => ({ accepted: false, residualIn: Infinity, scale: 0, rotationDeg: 0, pairs: [], reason, ...(comparable === false ? { comparable } : {}) });
  if (isDegenerate(aIn) || isDegenerate(bIn)) return none('the marks are in a straight line (or on top of each other) — two rows of evenly spaced poles fit any layout, so the drawings cannot be compared', false);
  if (opts.requireScales && !(opts.inPerFtA && opts.inPerFtB)) return none("the sheets' viewport scales are not both known — a registration at a free scale is not evidence", false);
  const best = search(A, B, limit, need);
  if (!best) return none('no pairing of the marks fits one drawing onto the other');
  // The mirrored fit: a near-symmetric layout registers flipped as well as
  // turned; the proper fit must be clearly better, or the pairing is ambiguous.
  const mirrored = search(A.map(p => ({ re: -p.re, im: p.im })), B, limit, need);
  const scale = abs(best.z);
  const rotationDeg = (Math.atan2(best.z.im, best.z.re) * 180) / Math.PI;
  const pairs = best.pairs.map(([p, q]) => (swap ? [q, p] : [p, q]) as [number, number]).sort((x, y) => x[0] - y[0]);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const out = { residualIn: round(best.resid), scale: round(swap ? 1 / scale : scale), rotationDeg: round(swap ? -rotationDeg : rotationDeg), pairs };
  if (best.resid > limit) return { ...out, accepted: false, reason: `the marks do not line up: worst residual ${out.residualIn}" of paper (limit ${limit}")` };
  if (angleOff90(rotationDeg) > MAX_ANGLE_OFF_DEG) return { ...out, accepted: false, reason: `the fit needs a ${Math.round(rotationDeg)}° rotation — not a drawing turned by a multiple of 90°` };
  let mirrorMargin: Registration['mirrorMargin'];
  if (mirrored && mirrored.resid <= limit && mirrored.pairs.length >= best.pairs.length) {
    const ratio = best.resid / Math.max(mirrored.resid, 1e-9);
    mirrorMargin = { proper: round(best.resid), mirrored: round(mirrored.resid), ratio: round(ratio) };
    if (ratio >= MIRROR_MARGIN) return { ...out, accepted: false, comparable: false, mirrorMargin, reason: `a mirrored layout fits about as well (residual ${mirrorMargin.proper}" proper vs ${mirrorMargin.mirrored}" mirrored — the proper fit must be under ${MIRROR_MARGIN} x the mirror's), so which pole is which cannot be told` };
  }
  if (opts.inPerFtA && opts.inPerFtB) {
    const expected = opts.inPerFtB / opts.inPerFtA;
    if (Math.abs(out.scale / expected - 1) > SCALE_TOLERANCE) return { ...out, accepted: false, reason: `the fitted scale ${out.scale} does not match the sheets' scales (${Math.round(expected * 1000) / 1000})` };
  }
  return { ...out, accepted: true, ...(mirrorMargin ? { mirrorMargin } : {}), reason: `${pairs.length} marks line up within ${out.residualIn}" (scale ${out.scale}, rotation ${Math.round(rotationDeg * 10) / 10}°${mirrorMargin ? `; mirror residual ${mirrorMargin.mirrored}" — proper fit ${mirrorMargin.ratio} x the mirror's, margin ${MIRROR_MARGIN}` : '; no mirrored fit within the limit'})` };
}

/** Pure: two sets drawn on the SAME sheet are the same poles only when they
 *  coincide in place — the identity transform pairs the smaller set's marks
 *  with the other's within `maxResidualIn` of paper. Never scale/rotation. */
export function registerSameSheet(aIn: RegPoint[], bIn: RegPoint[], opts: { minPaired?: number; maxResidualIn?: number; minPoints?: number } = {}): Registration | null {
  const minPts = Math.max(1, opts.minPoints ?? REG_MIN_POINTS);
  if (aIn.length < minPts || bIn.length < minPts) return null;
  const limit = opts.maxResidualIn ?? REG_MAX_RESIDUAL_IN;
  const swap = aIn.length > bIn.length;
  const A = swap ? bIn : aIn, B = swap ? aIn : bIn;
  const used = new Set<number>();
  const pairs: Array<[number, number]> = [];
  let worst = 0;
  A.forEach((p, i) => {
    let bi = -1, bd = Infinity;
    B.forEach((q, m) => { if (used.has(m)) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; bi = m; } });
    if (bi >= 0 && bd <= limit) { used.add(bi); pairs.push([i, bi]); worst = Math.max(worst, bd); }
  });
  const need = Math.max(1, Math.ceil((opts.minPaired ?? 1) * A.length - 1e-9));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const out = { residualIn: round(worst), scale: 1, rotationDeg: 0, pairs: pairs.map(([p, q]) => (swap ? [q, p] : [p, q]) as [number, number]) };
  if (pairs.length < need) return { ...out, accepted: false, reason: `on the same sheet but not in the same places: only ${pairs.length} of ${A.length} marks sit within ${limit}" of a mark of the other set — different poles` };
  return { ...out, accepted: true, reason: `${pairs.length} marks coincide in place on the same sheet (within ${out.residualIn}")` };
}
