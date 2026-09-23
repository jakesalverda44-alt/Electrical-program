// Estimating Phase B, Task 5 — frontend mirror of the backend's
// scaleParse.test.ts, proving the two sides parse the plan's exact example
// list identically.
import { describe, it, expect } from 'vitest';
import { parseScaleLabel, ftPerPtFromLabel } from './scaleParse';

const PT_PER_INCH = 72;

describe('parseScaleLabel — architectural scales', () => {
  it(`1/8" = 1'-0"`, () => {
    const parsed = parseScaleLabel(`1/8" = 1'-0"`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });

  it(`1/4"=1'`, () => {
    const parsed = parseScaleLabel(`1/4"=1'`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.25 * PT_PER_INCH), 10);
  });

  it(`3/32" = 1'-0"`, () => {
    const parsed = parseScaleLabel(`3/32" = 1'-0"`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / ((3 / 32) * PT_PER_INCH), 10);
  });

  it(`1" = 20'`, () => {
    const parsed = parseScaleLabel(`1" = 20'`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(20 / PT_PER_INCH, 10);
  });

  it('tolerates curly quote/apostrophe variants', () => {
    const parsed = parseScaleLabel(`1/8” = 1’-0”`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });

  it('accepts a leading "SCALE:" label', () => {
    const a = parseScaleLabel(`SCALE: 1/8" = 1'-0"`);
    expect(a).not.toBeNull();
  });
});

describe('parseScaleLabel — ratio and NTS', () => {
  it('1:100', () => {
    const parsed = parseScaleLabel('1:100');
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(100 / 12 / PT_PER_INCH, 10);
  });

  it('NTS -> null (no scale suggestion)', () => {
    expect(parseScaleLabel('NTS')).toBeNull();
    expect(parseScaleLabel('N.T.S.')).toBeNull();
  });
});

describe('parseScaleLabel — garbage input', () => {
  it('returns null for empty/absent/unrelated text', () => {
    expect(parseScaleLabel('')).toBeNull();
    expect(parseScaleLabel(null)).toBeNull();
    expect(parseScaleLabel(undefined)).toBeNull();
    expect(parseScaleLabel('LIGHTING PLAN')).toBeNull();
    expect(parseScaleLabel('E1.1')).toBeNull();
  });

  it('never returns a non-finite or non-positive ftPerPt', () => {
    for (const s of [`0" = 0'`, `1/8" = 0'-0"`, `abc" = def'`, `1:-5`, `1/0" = 1'-0"`]) {
      const parsed = parseScaleLabel(s);
      if (parsed) {
        expect(Number.isFinite(parsed.ftPerPt)).toBe(true);
        expect(parsed.ftPerPt).toBeGreaterThan(0);
      }
    }
  });
});

describe('ftPerPtFromLabel', () => {
  it('is the one-click "Use 1/8\\" = 1\'-0\\"" convenience — same result as parseScaleLabel().ftPerPt', () => {
    expect(ftPerPtFromLabel(`1/8" = 1'-0"`)).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });

  it('is null for an unparseable label', () => {
    expect(ftPerPtFromLabel('NTS')).toBeNull();
    expect(ftPerPtFromLabel('garbage')).toBeNull();
  });
});
