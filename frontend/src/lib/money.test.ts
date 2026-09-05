import { describe, it, expect, afterEach } from 'vitest';
import { moneyFull, moneyShort, moneyPrecise, moneyDec, setCurrency } from './money';

afterEach(() => setCurrency('USD'));

describe('moneyPrecise', () => {
  it('omits cents for a whole-dollar amount', () => {
    expect(moneyPrecise(15430)).toBe('$15,430');
  });

  it('shows cents when the amount has them', () => {
    expect(moneyPrecise(675.5)).toBe('$675.50');
  });

  it('puts the sign outside the currency symbol for a negative amount', () => {
    expect(moneyPrecise(-200)).toBe('-$200');
  });

  it('respects the active currency setting', () => {
    setCurrency('EUR');
    expect(moneyPrecise(100)).toContain('100');
    expect(moneyPrecise(100)).not.toContain('$');
  });
});

describe('moneyDec', () => {
  it('always shows two decimals', () => {
    expect(moneyDec(1234)).toBe('$1,234.00');
    expect(moneyDec(1234.5)).toBe('$1,234.50');
  });

  it('puts the sign outside the currency symbol for a negative amount', () => {
    expect(moneyDec(-200)).toBe('-$200.00');
  });
});

describe('moneyFull / moneyShort (existing behavior, unaffected by Task 4)', () => {
  it('moneyFull rounds to whole dollars', () => {
    expect(moneyFull(1234.9)).toBe('$1,235');
  });

  it('moneyShort compacts large amounts', () => {
    expect(moneyShort(1_250_000)).toBe('$1.25M');
  });
});
