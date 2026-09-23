// Estimating Phase B, Task 2/5 — scaleParse.ts is pure; exhaustive table
// tests per the plan's explicit list plus garbage input.
import { describe, it, expect } from 'vitest';
import { parseScaleLabel, findScaleLabel } from './scaleParse';

const PT_PER_INCH = 72;

describe('parseScaleLabel — architectural scales', () => {
  it('1/8" = 1\'-0" — the plan\'s canonical example', () => {
    const parsed = parseScaleLabel(`1/8" = 1'-0"`);
    expect(parsed).not.toBeNull();
    // 1/8 inch on paper = 1 real foot -> 1 real foot per (1/8 * 72) points.
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
    // Sanity: at 1/8" = 1', one real foot draws as 1/8 inch = 9pt on paper.
    expect(1 / parsed!.ftPerPt).toBeCloseTo(9, 6);
  });

  it(`1/4"=1' — no spaces, no inches remainder`, () => {
    const parsed = parseScaleLabel(`1/4"=1'`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.25 * PT_PER_INCH), 10);
  });

  it(`3/32" = 1'-0"`, () => {
    const parsed = parseScaleLabel(`3/32" = 1'-0"`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / ((3 / 32) * PT_PER_INCH), 10);
  });

  it(`1" = 20' — whole-inch paper token, common civil/site scale`, () => {
    const parsed = parseScaleLabel(`1" = 20'`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(20 / PT_PER_INCH, 10);
  });

  it('tolerates a feet-and-inches remainder', () => {
    const parsed = parseScaleLabel(`1/2" = 1'-6"`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1.5 / (0.5 * PT_PER_INCH), 10);
  });

  it('is case- and whitespace-tolerant, and accepts a leading "SCALE:" label', () => {
    const a = parseScaleLabel(`SCALE: 1/8" = 1'-0"`);
    const b = parseScaleLabel(`  1/8"   =   1'-0"  `);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.ftPerPt).toBeCloseTo(b!.ftPerPt, 10);
  });

  it('tolerates curly quote/apostrophe variants a StandardEncoding PDF text extraction can produce', () => {
    // U+2019 (right single quote) and U+201D (right double quote) in place
    // of the plain ASCII apostrophe/quote — see the module comment.
    const parsed = parseScaleLabel(`1/8” = 1’-0”`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });
});

describe('parseScaleLabel — ratio and NTS', () => {
  it('1:100', () => {
    const parsed = parseScaleLabel('1:100');
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(100 / 12 / PT_PER_INCH, 10);
  });

  it('NTS (and variants) parse to null — "not to scale" has no suggestion', () => {
    expect(parseScaleLabel('NTS')).toBeNull();
    expect(parseScaleLabel('nts')).toBeNull();
    expect(parseScaleLabel('N.T.S.')).toBeNull();
  });
});

describe('parseScaleLabel — garbage input', () => {
  it('returns null for empty/absent input', () => {
    expect(parseScaleLabel('')).toBeNull();
    expect(parseScaleLabel(null)).toBeNull();
    expect(parseScaleLabel(undefined)).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(parseScaleLabel('LIGHTING PLAN')).toBeNull();
    expect(parseScaleLabel('E1.1')).toBeNull();
    expect(parseScaleLabel('DRAWN BY: JS')).toBeNull();
  });

  it('returns null for a malformed fraction (zero denominator) rather than Infinity/NaN', () => {
    const parsed = parseScaleLabel(`1/0" = 1'-0"`);
    expect(parsed).toBeNull();
  });

  it('returns null for a zero or negative ratio', () => {
    expect(parseScaleLabel('1:0')).toBeNull();
  });

  it('never returns a non-finite or non-positive ftPerPt for any input', () => {
    const inputs = [`0" = 0'`, `1/8" = 0'-0"`, `abc" = def'`, `1:-5`, `" = '`];
    for (const s of inputs) {
      const parsed = parseScaleLabel(s);
      if (parsed) {
        expect(Number.isFinite(parsed.ftPerPt)).toBe(true);
        expect(parsed.ftPerPt).toBeGreaterThan(0);
      }
    }
  });
});

describe('findScaleLabel — locating a scale expression inside a block of page text', () => {
  it('finds a SCALE-prefixed label among other title-block lines', () => {
    const pageText = [
      'ACCURATE POWER & TECHNOLOGY',
      'E1.1',
      'LIGHTING PLAN',
      'SCALE: 1/8" = 1\'-0"',
      'DRAWN BY: JS',
    ].join('\n');
    const parsed = findScaleLabel(pageText);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });

  it('trims trailing title-block text that runs on past the scale expression on the same line', () => {
    const parsed = findScaleLabel(`SCALE: 1/8" = 1'-0"   LIGHTING PLAN`);
    expect(parsed).not.toBeNull();
    expect(parsed!.ftPerPt).toBeCloseTo(1 / (0.125 * PT_PER_INCH), 10);
  });

  it('returns null when no scale-shaped text is present anywhere', () => {
    const pageText = ['E1.1', 'LIGHTING PLAN', 'DRAWN BY: JS'].join('\n');
    expect(findScaleLabel(pageText)).toBeNull();
  });

  it('returns null for empty page text', () => {
    expect(findScaleLabel('')).toBeNull();
  });
});
