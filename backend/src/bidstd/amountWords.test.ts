import { describe, expect, it } from 'vitest';
import { amountInWords, dollarsInWords, formatPriceCents, priceToCents } from './amountWords';

describe('amountInWords (Cowork price line)', () => {
  it('the Kissimmee Cowork figure', () => {
    expect(amountInWords('$81,485.60')).toBe('Eighty-One Thousand Four Hundred Eighty-Five and 60/100 Dollars');
    expect(formatPriceCents('$81,485.60')).toBe('$81,485.60');
  });
  it('cents: none, one digit, two digits', () => {
    expect(amountInWords('86000')).toBe('Eighty-Six Thousand and 00/100 Dollars');
    expect(amountInWords('79112.2')).toBe('Seventy-Nine Thousand One Hundred Twelve and 20/100 Dollars');
    expect(amountInWords('0.05')).toBe('Zero and 05/100 Dollars');
    expect(formatPriceCents('86000')).toBe('$86,000.00');
  });
  it('hundreds, thousands, hundred-thousands, millions', () => {
    expect(dollarsInWords(100)).toBe('One Hundred');
    expect(dollarsInWords(1_000)).toBe('One Thousand');
    expect(dollarsInWords(1_019)).toBe('One Thousand Nineteen');
    expect(dollarsInWords(248_750)).toBe('Two Hundred Forty-Eight Thousand Seven Hundred Fifty');
    expect(dollarsInWords(900_000)).toBe('Nine Hundred Thousand');
    expect(dollarsInWords(1_000_001)).toBe('One Million One');
    expect(dollarsInWords(2_345_678)).toBe('Two Million Three Hundred Forty-Five Thousand Six Hundred Seventy-Eight');
  });
  it('rejects non-prices', () => {
    expect(priceToCents('TBD')).toBeNull();
    expect(amountInWords('12.345')).toBeNull();
    expect(amountInWords('')).toBeNull();
  });
});
