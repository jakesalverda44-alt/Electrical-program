// Fix round 1 / S1 — pageGeometry.ts's screenPosition, checked against the
// review's own hand-verified numbers: MediaBox [100 200 712 992]
// (width=612, height=792, origin (100,200)), point (150,250) in PDF-space,
// at all four rotations. The review's own numbers were given at
// renderScale 2 (matching overlay.ts's matrix multiplied through by s);
// this module works at scale 1, so every expected value here is exactly
// half of the review's — same geometry, no scale factor to cancel.
import { describe, it, expect } from 'vitest';
import { screenPosition, displayedSize, normalizeRotation } from './pageGeometry';

const W = 612;
const H = 792;
const X0 = 100;
const Y0 = 200;
const PX = 150;
const PY = 250;

describe('screenPosition — origin- and rotation-aware, matches the review\'s hand-verified numbers', () => {
  it('rotation 0', () => {
    expect(screenPosition(PX, PY, X0, Y0, W, H, 0)).toEqual({ x: 50, y: 742 });
  });
  it('rotation 90', () => {
    expect(screenPosition(PX, PY, X0, Y0, W, H, 90)).toEqual({ x: 50, y: 50 });
  });
  it('rotation 180', () => {
    expect(screenPosition(PX, PY, X0, Y0, W, H, 180)).toEqual({ x: 562, y: 50 });
  });
  it('rotation 270', () => {
    expect(screenPosition(PX, PY, X0, Y0, W, H, 270)).toEqual({ x: 742, y: 562 });
  });

  it('a zero origin (the overwhelmingly common case) reduces to the un-adjusted rotation-only transform', () => {
    // The review's OWN already-verified zero-origin rotation-90 case:
    // matrix [0,2,2,0,0,0] at scale 2 applied to an arbitrary point (x,y)
    // gives (2y, 2x) — at scale 1, (y, x).
    expect(screenPosition(PX, PY, 0, 0, W, H, 90)).toEqual({ x: PY, y: PX });
  });

  it('normalizes an out-of-range or negative rotation to one of the four axis-aligned values', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(45)).toBe(0); // never a real page rotation, but must not throw/NaN
  });
});

describe('displayedSize — swaps width/height at 90/270', () => {
  it('0 and 180: unchanged', () => {
    expect(displayedSize(W, H, 0)).toEqual({ width: W, height: H });
    expect(displayedSize(W, H, 180)).toEqual({ width: W, height: H });
  });
  it('90 and 270: swapped', () => {
    expect(displayedSize(W, H, 90)).toEqual({ width: H, height: W });
    expect(displayedSize(W, H, 270)).toEqual({ width: H, height: W });
  });
});
