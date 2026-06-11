import { describe, it, expect } from 'vitest';
import { flTaxRate } from './flSalesTax';

describe('flTaxRate', () => {
  it('returns 6% for Citrus County (no surtax)', () => {
    expect(flTaxRate({ city: 'Crystal River' })).toBe(6);
    expect(flTaxRate({ city: 'Inverness' })).toBe(6);
  });

  it('adds the county surtax to the 6% state base', () => {
    expect(flTaxRate({ city: 'Leesburg' })).toBe(7);     // Lake 1%
    expect(flTaxRate({ city: 'Ocala' })).toBe(7.5);      // Marion 1.5%
    expect(flTaxRate({ city: 'Brooksville' })).toBe(6.5); // Hernando 0.5%
  });

  it('is case- and whitespace-insensitive on city', () => {
    expect(flTaxRate({ city: '  crystal river ' })).toBe(6);
  });

  it('falls back to ZIP when the city is unknown', () => {
    expect(flTaxRate({ city: '', zip: '34471' })).toBe(7.5);   // Ocala / Marion
    expect(flTaxRate({ zip: '34429' })).toBe(6);               // Crystal River / Citrus
  });

  it('returns null when the county cannot be determined', () => {
    expect(flTaxRate({ city: 'Atlanta', zip: '30301' })).toBeNull();
    expect(flTaxRate({})).toBeNull();
  });
});
