// Estimating Phase B, Task 5 — frontend mirror of the backend's
// scaleParse.test.ts, proving the two sides parse the plan's exact example
// list identically.
import { describe, it, expect } from 'vitest';
import {
  parseScaleLabel, ftPerPtFromLabel, effectiveTitleBlockFtPerPt,
  STANDARD_SCALES, standardFtPerPt, pickedScaleLabel, standardScaleById, matchStandardScale, scalesDisagree,
} from './scaleParse';

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

// Fix round 2 / R2-B2 — the ONE function the popover's "Use <label>", the
// standalone banner Confirm, and the popover's own 2% disagreement check
// all go through, so a half-size document's raw title-block parse
// (est_sheets.suggested_ft_per_pt, never pre-multiplied — see sheets.ts's
// own setHalfSize) reads the same effective scale everywhere.
describe('effectiveTitleBlockFtPerPt', () => {
  it('doubles the raw value when half_size is true', () => {
    expect(effectiveTitleBlockFtPerPt(0.1111, true)).toBeCloseTo(0.2222, 10);
  });

  it('returns the raw value unchanged when half_size is false', () => {
    expect(effectiveTitleBlockFtPerPt(0.1111, false)).toBeCloseTo(0.1111, 10);
  });

  it('is null when the raw value is null, regardless of half_size', () => {
    expect(effectiveTitleBlockFtPerPt(null, true)).toBeNull();
    expect(effectiveTitleBlockFtPerPt(null, false)).toBeNull();
  });
});

describe('standard scale list ("Pick a scale")', () => {
  const EXPECTED: Array<[string, number]> = [
    [`1/32" = 1'-0"`, 32], [`1/16" = 1'-0"`, 16], [`3/32" = 1'-0"`, 32 / 3], [`1/8" = 1'-0"`, 8], [`3/16" = 1'-0"`, 16 / 3],
    [`1/4" = 1'-0"`, 4], [`3/8" = 1'-0"`, 8 / 3], [`1/2" = 1'-0"`, 2], [`3/4" = 1'-0"`, 4 / 3], [`1" = 1'-0"`, 1],
    [`1-1/2" = 1'-0"`, 2 / 3], [`3" = 1'-0"`, 1 / 3],
    [`1" = 10'`, 10], [`1" = 20'`, 20], [`1" = 30'`, 30], [`1" = 40'`, 40], [`1" = 50'`, 50], [`1" = 60'`, 60], [`1" = 100'`, 100],
  ];
  it('lists exactly the 12 architectural + 7 engineering scales, in order', () => {
    expect(STANDARD_SCALES.map(s => s.label)).toEqual(EXPECTED.map(e => e[0]));
    expect(STANDARD_SCALES.filter(s => s.group === 'Architectural')).toHaveLength(12);
    expect(STANDARD_SCALES.filter(s => s.group === 'Engineering')).toHaveLength(7);
  });
  it.each(EXPECTED)('%s -> %f ft of building per inch of paper', (label, ftPerIn) => {
    const s = STANDARD_SCALES.find(x => x.label === label)!;
    expect(standardFtPerPt(s, false)).toBeCloseTo(ftPerIn / 72, 9);
    // half-size is applied exactly once (x2), never twice
    expect(standardFtPerPt(s, true)).toBeCloseTo(2 * ftPerIn / 72, 9);
  });
  it('agrees with parseScaleLabel wherever the label is parseable', () => {
    for (const s of STANDARD_SCALES) {
      const parsed = ftPerPtFromLabel(s.label);
      if (parsed != null) expect(standardFtPerPt(s, false)).toBeCloseTo(parsed, 9);
    }
  });
  it('pickedScaleLabel marks the label as picked', () => {
    expect(pickedScaleLabel(standardScaleById('arch-1/4')!)).toBe(`1/4" = 1'-0" (picked)`);
  });
  it('matchStandardScale finds the standard scale for a raw ft/pt (and none for an odd one)', () => {
    expect(matchStandardScale(1 / (0.25 * 72))?.id).toBe('arch-1/4');
    expect(matchStandardScale(20 / 72)?.id).toBe('eng-20');
    expect(matchStandardScale(0.0777)).toBeNull();
    expect(matchStandardScale(null)).toBeNull();
  });
  it('scalesDisagree uses a percentage tolerance', () => {
    expect(scalesDisagree(0.0556, 0.0556)).toBe(false);
    expect(scalesDisagree(0.0556, 0.111)).toBe(true);
    expect(scalesDisagree(null, 0.1)).toBe(false);
  });
});
