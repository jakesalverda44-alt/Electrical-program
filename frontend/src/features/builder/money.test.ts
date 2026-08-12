import { describe, it, expect } from 'vitest';
import { roundCents } from './money';

describe('roundCents', () => {
  it('keeps cents rather than rounding to the dollar', () => {
    expect(roundCents(47.285)).toBe(47.29);
    expect(roundCents(675.5)).toBe(675.5);
  });

  it('clears binary floating-point dust', () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(1043.0000000000002)).toBe(1043);
  });

  it('rounds a credit and a charge of the same size to the same magnitude', () => {
    expect(roundCents(-47.285)).toBe(-47.29);
    expect(roundCents(-47.285)).toBe(-roundCents(47.285));
  });

  it('treats a non-finite amount as zero', () => {
    expect(roundCents(NaN)).toBe(0);
    expect(roundCents(Infinity)).toBe(0);
  });
});
