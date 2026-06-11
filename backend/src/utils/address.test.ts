import { describe, it, expect } from 'vitest';
import { parseAddress, leadAddressToProposal } from './address';

describe('parseAddress', () => {
  it('splits a full Kohler-style address with country and full state name', () => {
    expect(parseAddress('636 North Golf Course Dr., CRYSTAL RIVER, Florida 34429, United States'))
      .toEqual({ street: '636 North Golf Course Dr.', city: 'Crystal River', state: 'FL', zip: '34429' });
  });

  it('handles a state abbreviation and no country', () => {
    expect(parseAddress('123 Main St, Leesburg, FL 34748'))
      .toEqual({ street: '123 Main St', city: 'Leesburg', state: 'FL', zip: '34748' });
  });

  it('keeps the 5-digit zip from a ZIP+4', () => {
    expect(parseAddress('5 Oak Ave, Eustis, FL 34748-6321').zip).toBe('34748');
  });

  it('handles street + state/zip with no city', () => {
    expect(parseAddress('500 Industrial Blvd, FL 32726'))
      .toEqual({ street: '500 Industrial Blvd', city: '', state: 'FL', zip: '32726' });
  });

  it('returns empty fields for blank input', () => {
    expect(parseAddress('')).toEqual({ street: '', city: '', state: '', zip: '' });
    expect(parseAddress(null)).toEqual({ street: '', city: '', state: '', zip: '' });
  });

  it('falls back to street when it cannot confidently split', () => {
    expect(parseAddress('Some freeform location')).toEqual({ street: 'Some freeform location', city: '', state: '', zip: '' });
  });
});

describe('leadAddressToProposal', () => {
  it('builds structured fields and a "City, ST" loc', () => {
    expect(leadAddressToProposal('636 North Golf Course Dr., CRYSTAL RIVER, Florida 34429, United States'))
      .toEqual({ address: '636 North Golf Course Dr.', city: 'Crystal River', state: 'FL', zip: '34429', loc: 'Crystal River, FL' });
  });

  it('falls back to the raw address when unparseable', () => {
    expect(leadAddressToProposal('Freeform place'))
      .toEqual({ address: 'Freeform place', city: '', state: '', zip: '', loc: 'Freeform place' });
  });
});
