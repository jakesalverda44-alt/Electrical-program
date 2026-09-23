// Estimating Phase B, Task 5 — ftInParse.ts is pure; exhaustively tested.
import { describe, it, expect } from 'vitest';
import { parseFeetInches, formatFeetInches } from './ftInParse';

describe('parseFeetInches', () => {
  it(`12'6" -> 12.5 ft`, () => {
    expect(parseFeetInches(`12'6"`)).toBeCloseTo(12.5, 10);
  });

  it(`12'-6" (with a dash) -> 12.5 ft`, () => {
    expect(parseFeetInches(`12'-6"`)).toBeCloseTo(12.5, 10);
  });

  it(`12' 6" (with a space) -> 12.5 ft`, () => {
    expect(parseFeetInches(`12' 6"`)).toBeCloseTo(12.5, 10);
  });

  it(`12.5 (bare decimal) -> 12.5 ft`, () => {
    expect(parseFeetInches('12.5')).toBeCloseTo(12.5, 10);
  });

  it(`150' (bare feet with the mark) -> 150 ft`, () => {
    expect(parseFeetInches(`150'`)).toBeCloseTo(150, 10);
  });

  it(`12' (feet only, no inches) -> 12 ft`, () => {
    expect(parseFeetInches(`12'`)).toBeCloseTo(12, 10);
  });

  it(`6" (inches only) -> 0.5 ft`, () => {
    expect(parseFeetInches(`6"`)).toBeCloseTo(0.5, 10);
  });

  it('tolerates curly quote/apostrophe variants', () => {
    expect(parseFeetInches(`12’6”`)).toBeCloseTo(12.5, 10);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseFeetInches(`  12'6"  `)).toBeCloseTo(12.5, 10);
  });

  it('a fractional foot value works too', () => {
    expect(parseFeetInches('12.75')).toBeCloseTo(12.75, 10);
  });

  it('returns null for empty, absent, zero, negative, or garbage input', () => {
    expect(parseFeetInches('')).toBeNull();
    expect(parseFeetInches(null)).toBeNull();
    expect(parseFeetInches(undefined)).toBeNull();
    expect(parseFeetInches('0')).toBeNull();
    expect(parseFeetInches(`0'0"`)).toBeNull();
    expect(parseFeetInches('-5')).toBeNull();
    expect(parseFeetInches('abc')).toBeNull();
    expect(parseFeetInches(`'`)).toBeNull();
  });

  it('never returns a non-finite value for any input it does parse', () => {
    for (const s of [`12'6"`, '12.5', `150'`, `6"`]) {
      const v = parseFeetInches(s);
      if (v != null) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('formatFeetInches', () => {
  it('formats a whole-foot value with 0 inches', () => {
    expect(formatFeetInches(12)).toBe(`12'-0"`);
  });

  it('formats a fractional value, rounding to the nearest inch', () => {
    expect(formatFeetInches(12.5)).toBe(`12'-6"`);
  });

  it('rounds 12.99 feet up to 13\'-0", not 12\'-12"', () => {
    expect(formatFeetInches(12.99)).toBe(`13'-0"`);
  });

  it('round-trips through parseFeetInches for a clean feet-inches value', () => {
    const original = `12'-6"`;
    const parsed = parseFeetInches(original)!;
    expect(formatFeetInches(parsed)).toBe(original);
  });

  it('is empty for a negative or non-finite input', () => {
    expect(formatFeetInches(-1)).toBe('');
    expect(formatFeetInches(NaN)).toBe('');
    expect(formatFeetInches(Infinity)).toBe('');
  });

  it('handles 0 feet', () => {
    expect(formatFeetInches(0)).toBe(`0'-0"`);
  });
});
