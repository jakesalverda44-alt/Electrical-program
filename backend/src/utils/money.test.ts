import { describe, expect, it } from 'vitest';
import { parseMoney } from './money';

describe('parseMoney', () => {
  it('strips a dollar sign and commas', () => {
    expect(parseMoney('$425,000')).toBe(425000);
  });

  it('parses a plain decimal string', () => {
    expect(parseMoney('425000.50')).toBe(425000.5);
  });

  it('strips surrounding whitespace', () => {
    expect(parseMoney('  $1,234.56  ')).toBe(1234.56);
  });

  it('returns null for non-numeric input', () => {
    expect(parseMoney('abc')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseMoney('')).toBeNull();
  });

  it('returns null for a negative amount', () => {
    expect(parseMoney('-5')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseMoney('0')).toBeNull();
  });

  it('returns null for a non-finite result (Infinity-shaped input)', () => {
    expect(parseMoney('Infinity')).toBeNull();
  });

  it('handles a dollar sign with internal whitespace', () => {
    expect(parseMoney('$ 425,000')).toBe(425000);
  });
});
