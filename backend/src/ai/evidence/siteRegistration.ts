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
}

export const REG_MAX_RESIDUAL_IN = 0.5;
export const REG_MAX_POINTS = 7;
export const REG_MIN_POINTS = 3;
const MAX_ANGLE_OFF_DEG = 10;
const SCALE_TOLERANCE = 0.10;

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

/** Pure: register `a` (the smaller or equal set) onto `b`. null when either
 *  set is outside 3..7 marks (no registration is attempted). `minPaired` is
 *  the fraction of the smaller set that must pair (1 = all of it). */
export function registerPointSets(
  aIn: RegPoint[],
  bIn: RegPoint[],
  opts: { inPerFtA?: number | null; inPerFtB?: number | null; minPaired?: number; maxResidualIn?: number } = {},
): Registration | null {
  if (aIn.length < REG_MIN_POINTS || bIn.length < REG_MIN_POINTS || aIn.length > REG_MAX_POINTS || bIn.length > REG_MAX_POINTS) return null;
  const swap = aIn.length > bIn.length;
  const A = (swap ? bIn : aIn).map(c), B = (swap ? aIn : bIn).map(c);
  const limit = opts.maxResidualIn ?? REG_MAX_RESIDUAL_IN;
  const need = Math.max(REG_MIN_POINTS, Math.ceil((opts.minPaired ?? 1) * A.length - 1e-9));
  let best: { pairs: Array<[number, number]>; z: C; resid: number } | null = null;
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
      const s = abs(f.z);
      const resid = Math.max(...pairs.map(p => abs(sub(add(mul(f.z, A[p[0]]), f.t), B[p[1]])))) * Math.min(1, 1 / s);
      if (!best || pairs.length > best.pairs.length || (pairs.length === best.pairs.length && resid < best.resid)) best = { pairs, z: f.z, resid };
    }
  }
  if (!best) return { accepted: false, residualIn: Infinity, scale: 0, rotationDeg: 0, pairs: [], reason: 'no pairing of the marks fits one drawing onto the other' };
  const scale = abs(best.z);
  const rotationDeg = (Math.atan2(best.z.im, best.z.re) * 180) / Math.PI;
  const pairs = best.pairs.map(([p, q]) => (swap ? [q, p] : [p, q]) as [number, number]).sort((x, y) => x[0] - y[0]);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const out = { residualIn: round(best.resid), scale: round(swap ? 1 / scale : scale), rotationDeg: round(swap ? -rotationDeg : rotationDeg), pairs };
  if (best.resid > limit) return { ...out, accepted: false, reason: `the marks do not line up: worst residual ${out.residualIn}" of paper (limit ${limit}")` };
  if (angleOff90(rotationDeg) > MAX_ANGLE_OFF_DEG) return { ...out, accepted: false, reason: `the fit needs a ${Math.round(rotationDeg)}° rotation — not a drawing turned by a multiple of 90°` };
  if (opts.inPerFtA && opts.inPerFtB) {
    const expected = opts.inPerFtB / opts.inPerFtA;
    if (Math.abs(out.scale / expected - 1) > SCALE_TOLERANCE) return { ...out, accepted: false, reason: `the fitted scale ${out.scale} does not match the sheets' scales (${Math.round(expected * 1000) / 1000})` };
  }
  return { ...out, accepted: true, reason: `${pairs.length} marks line up within ${out.residualIn}" (scale ${out.scale}, rotation ${Math.round(rotationDeg * 10) / 10}°)` };
}
