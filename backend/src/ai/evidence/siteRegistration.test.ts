// Accuracy round A3 — the registration check (pure).
import { describe, it, expect } from 'vitest';
import { registerPointSets, type RegPoint } from './siteRegistration';

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
