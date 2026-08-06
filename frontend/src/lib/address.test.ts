import { describe, it, expect } from 'vitest';
import { parseAddress } from './address';

// Mirrors backend/src/utils/address.test.ts — this file must stay behaviorally
// identical to its backend counterpart (see the "Keep in sync" comment in address.ts).
describe('parseAddress', () => {
  it('splits a full Kohler-style address with country and full state name', () => {
    expect(parseAddress('636 North Golf Course Dr., CRYSTAL RIVER, Florida 34429, United States'))
      .toEqual({ street: '636 North Golf Course Dr.', city: 'Crystal River', state: 'FL', zip: '34429' });
  });

  it('falls back to street when it cannot confidently split', () => {
    expect(parseAddress('Some freeform location')).toEqual({ street: 'Some freeform location', city: '', state: '', zip: '' });
  });

  // Regression: a comma-free address that happens to contain a zip used to fall through
  // with street left blank, silently dropping the whole address in BuilderPage's
  // genToForm() re-parse (triggered when a converted lead's proposal is opened).
  it('keeps the whole string as street when a zip is embedded with no comma to split on', () => {
    expect(parseAddress('123 Main St Eustis FL 32726'))
      .toEqual({ street: '123 Main St Eustis FL 32726', city: '', state: '', zip: '32726' });
  });
});
