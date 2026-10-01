// Accuracy round A3 — the registration check (pure).
import { describe, it, expect } from 'vitest';
import { registerPointSets, registerSameSheet, isDegenerate, MIRROR_MARGIN, type RegPoint } from './siteRegistration';

// An asymmetric 4-pole layout (inches on the E sheet).
const E: RegPoint[] = [{ x: 2, y: 3 }, { x: 6, y: 3.5 }, { x: 5, y: 8 }, { x: 9.5, y: 6 }];
const map = (pts: RegPoint[], s: number, deg: number, tx: number, ty: number) => {
  const r = (deg * Math.PI) / 180;
  return pts.map(p => ({ x: s * (p.x * Math.cos(r) - p.y * Math.sin(r)) + tx, y: s * (p.x * Math.sin(r) + p.y * Math.cos(r)) + ty }));
};

describe('A3 — registration of two drawings of the same site poles', () => {
  it('a permutation of the same poles at another scale registers, pairing each pole with its twin', () => {
    const P = map(E, 0.64, 0, 1, 2);
    const shuffled = [P[2], P[0], P[3], P[1]];
    const r = registerPointSets(E, shuffled)!;
    expect(r.accepted).toBe(true);
    expect(r.pairs).toEqual([[0, 1], [1, 3], [2, 0], [3, 2]]);
    expect(r.scale).toBeCloseTo(0.64, 2);
    expect(r.residualIn).toBeLessThan(0.01);
  });

  it('a sheet turned 90° registers', () => {
    const r = registerPointSets(E, map(E, 1.2, 90, 20, -3))!;
    expect(r.accepted).toBe(true);
    expect(Math.round(r.rotationDeg)).toBe(90);
  });

  it('a MIRROR never registers (no sheet is drawn flipped)', () => {
    const mirrored = map(E, 0.8, 0, 0, 0).map(p => ({ x: -p.x, y: p.y }));
    const r = registerPointSets(E, mirrored)!;
    expect(r.accepted).toBe(false);
  });

  it('placement noise under 0.5" of paper registers; a layout that does not match does not', () => {
    const noisy = map(E, 0.64, 2, 1, 2).map((p, i) => ({ x: p.x + [0.1, -0.12, 0.08, -0.05][i], y: p.y + [-0.06, 0.1, 0.11, -0.09][i] }));
    expect(registerPointSets(E, noisy)!.accepted).toBe(true);
    const other = [{ x: 1, y: 1 }, { x: 1.2, y: 6 }, { x: 7, y: 1.5 }, { x: 4, y: 4 }];
    expect(registerPointSets(E, other)!.accepted).toBe(false);
  });

  it('the residual is measured on the smaller-scale drawing; a scale that contradicts the sheets\' scales is rejected', () => {
    const P = map(E, 0.5, 0, 0, 0);
    expect(registerPointSets(E, P, { inPerFtA: 1 / 8, inPerFtB: 1 / 16 })!.accepted).toBe(true);
    const bad = registerPointSets(E, P, { inPerFtA: 1 / 8, inPerFtB: 1 / 8 })!;
    expect(bad.accepted).toBe(false);
    expect(bad.reason).toMatch(/scale/);
  });

  it('fewer than 3 marks on a side: no registration at all (null)', () => {
    expect(registerPointSets(E.slice(0, 2), E)).toBeNull();
    expect(registerPointSets(E, E.slice(0, 2))).toBeNull();
  });

  it('unequal sets: the smaller set pairs into the larger (Rule 2 needs >= 60%)', () => {
    const P = map(E, 0.7, 0, 3, 1).slice(0, 3);
    const r = registerPointSets(E, P, { minPaired: 0.6 })!;
    expect(r.accepted).toBe(true);
    expect(r.pairs.length).toBe(3);
  });
});

// ---- Fix round 1 (review B-1 / S3) ----
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const randSet = (rand: () => number, n: number, spread: number): RegPoint[] => Array.from({ length: n }, () => ({ x: rand() * spread, y: rand() * spread }));

describe('fix round 1 — degenerate sets', () => {
  it('collinear points are degenerate: two evenly spaced rows never register', () => {
    const rowA = [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 7, y: 2 }];
    const rowB = [{ x: 3, y: 9 }, { x: 5, y: 9 }, { x: 7, y: 9 }];
    expect(isDegenerate(rowA)).toBe(true);
    const r = registerPointSets(rowA, rowB)!;
    expect(r.accepted).toBe(false);
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/straight line/);
    expect(isDegenerate(E)).toBe(false);
  });
});

describe('fix round 1 — the mirror is fitted too (S3)', () => {
  it('a near-isosceles triangle mirrored is rejected as ambiguous (the twin pairing would be swapped)', () => {
    const tri = [{ x: 0, y: 0 }, { x: 8, y: 0.05 }, { x: 4.05, y: 7 }];
    const mirrored = map(tri, 0.64, 0, 2, 1).map(p => ({ x: -p.x, y: p.y }));
    const r = registerPointSets(tri, mirrored)!;
    expect(r.accepted).toBe(false);
    expect(r.mirrorMargin).toBeTruthy();
    expect(r.reason).toMatch(/mirrored layout fits about as well/);
  });

  it('an asymmetric proper set states the margin it won by (no mirrored fit within the limit)', () => {
    const r = registerPointSets(E, map(E, 0.64, 0, 1, 2))!;
    expect(r.accepted).toBe(true);
    expect(r.reason).toMatch(/mirror/);
  });

  it('Monte Carlo (400 trials each): mirrored sets and random layouts are rejected at ~0 under the Rule 2 settings (4-5 marks, scales known)', () => {
    const rand = rng(7);
    let mirrorAccepted = 0, randomAccepted = 0;
    const trials = 400;
    for (let t = 0; t < trials; t++) {
      const n = 4 + (t % 2);
      const a = randSet(rand, n, 8);
      const mirrored = map(a, 0.64, 0, 3, 3).map(p => ({ x: -p.x, y: p.y }));
      if (registerPointSets(a, mirrored, { inPerFtA: 0.125, inPerFtB: 0.08, requireScales: true, minPoints: 4, minPaired: 0.8 })?.accepted) mirrorAccepted++;
      const other = randSet(rand, n, 8);
      if (registerPointSets(a, other, { inPerFtA: 0.125, inPerFtB: 0.08, requireScales: true, minPoints: 4, minPaired: 0.8 })?.accepted) randomAccepted++;
    }
    expect(mirrorAccepted / trials).toBeLessThanOrEqual(0.005);
    expect(randomAccepted / trials).toBeLessThanOrEqual(0.01);
  });

  it('Monte Carlo (Rule 1 settings, 3 marks, 8" spread): mirrored triangles are never accepted; random layouts well under the old 9%', () => {
    const rand = rng(11);
    let mirrorAccepted = 0, randomAccepted = 0;
    const trials = 400;
    for (let t = 0; t < trials; t++) {
      const a = randSet(rand, 3, 8);
      const mirrored = map(a, 0.64, 0, 3, 3).map(p => ({ x: -p.x, y: p.y }));
      if (registerPointSets(a, mirrored)?.accepted) mirrorAccepted++;
      if (registerPointSets(a, randSet(rand, 3, 8))?.accepted) randomAccepted++;
    }
    expect(mirrorAccepted / trials).toBeLessThanOrEqual(0.005);
    expect(randomAccepted / trials).toBeLessThan(0.09);
    expect(MIRROR_MARGIN).toBe(0.5);
  });
});

describe('fix round 1 — Rule 2 settings', () => {
  it('requireScales: unknown viewport scales are not evidence', () => {
    const r = registerPointSets(E, map(E, 0.64, 0, 1, 2), { requireScales: true, minPoints: 4 })!;
    expect(r.accepted).toBe(false);
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/scales are not both known/);
    expect(registerPointSets(E, map(E, 0.64, 0, 1, 2), { requireScales: true, minPoints: 4, inPerFtA: 0.125, inPerFtB: 0.08 })!.accepted).toBe(true);
  });
  it('minPoints 4: three marks a side are never attempted (null)', () => {
    expect(registerPointSets(E.slice(0, 3), E.slice(0, 3), { minPoints: 4 })).toBeNull();
  });
  it('same sheet: identity only — a shifted copy, rows, or a rotated copy are different poles', () => {
    const same = registerSameSheet(E, E.map(p => ({ x: p.x + 0.1, y: p.y - 0.1 })), { minPoints: 4 })!;
    expect(same.accepted).toBe(true);
    const row1 = [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 7, y: 2 }, { x: 10, y: 2 }];
    const row2 = row1.map(p => ({ x: p.x, y: 30 }));
    expect(registerSameSheet(row1, row2, { minPoints: 4 })!.accepted).toBe(false);
    expect(registerSameSheet(E, map(E, 1, 90, 20, -3), { minPoints: 4 })!.accepted).toBe(false);
  });
});
