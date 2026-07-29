import { describe, it, expect } from 'vitest';
import { normalizeCompanyName, extractCandidates, matchCustomer } from './customerMatch';

describe('normalizeCompanyName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeCompanyName('  Bay   To   Bay  ')).toBe('bay to bay');
  });

  it('strips a single trailing corporate suffix', () => {
    expect(normalizeCompanyName('Bay to Bay Construction')).toBe('bay to bay');
  });

  it('strips punctuation-bearing suffixes like "LLC" and "L.L.C."', () => {
    expect(normalizeCompanyName('Bay to Bay Properties, LLC')).toBe('bay to bay properties');
    expect(normalizeCompanyName('Bay to Bay Properties, L.L.C.')).toBe('bay to bay properties');
  });

  it('strips suffixes iteratively (multiple trailing suffixes)', () => {
    expect(normalizeCompanyName('X Construction LLC')).toBe('x');
    expect(normalizeCompanyName('Acme Contracting Group, Inc.')).toBe('acme');
  });

  it('strips remaining punctuation', () => {
    expect(normalizeCompanyName("Sonny's Car Wash & Co.")).toBe('sonnys car wash');
  });

  it('does not strip a suffix that is only a substring of the last word', () => {
    // "Cisco" ends in "co" but is not the standalone suffix token "Co"
    expect(normalizeCompanyName('Cisco')).toBe('cisco');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeCompanyName('')).toBe('');
    expect(normalizeCompanyName('   ')).toBe('');
  });
});

describe('extractCandidates', () => {
  it('returns the full string when there is no parenthetical', () => {
    expect(extractCandidates('Bay to Bay Construction')).toEqual(['Bay to Bay Construction']);
  });

  it('ignores a parenthetical with fewer than 2 words', () => {
    expect(extractCandidates('Turner Construction (FL)')).toEqual(['Turner Construction (FL)']);
  });

  it('adds a multi-word parenthetical as a second candidate when the outer text is meaningful', () => {
    expect(extractCandidates('Turner Construction (Tampa Division)')).toEqual([
      'Turner Construction (Tampa Division)',
      'Tampa Division',
    ]);
  });

  it('puts the parenthetical first and drops the outer text when it is generic junk', () => {
    expect(extractCandidates('Estimating Department (Bay to Bay Properties, LLC)')).toEqual([
      'Bay to Bay Properties, LLC',
    ]);
  });

  it('treats a purely junk outer with no other words as junk too', () => {
    expect(extractCandidates('Bid (Turner Construction Company)')).toEqual([
      'Turner Construction Company',
    ]);
  });

  it('handles empty input', () => {
    expect(extractCandidates('')).toEqual([]);
  });
});

describe('matchCustomer', () => {
  it('matches via exact normalized comparison after suffix stripping', () => {
    const existing = [{ id: '1', name: 'Bay to Bay Construction' }];
    expect(matchCustomer('bay to bay', existing)).toEqual({ id: '1', name: 'Bay to Bay Construction' });
  });

  it('matches the parenthetical candidate through a junk outer wrapper', () => {
    const existing = [{ id: '1', name: 'Bay to Bay Properties, LLC' }];
    expect(matchCustomer('Estimating Department (Bay to Bay Properties, LLC)', existing)).toEqual({
      id: '1',
      name: 'Bay to Bay Properties, LLC',
    });
  });

  it('returns null when a short/junk candidate would ambiguously match multiple existing customers', () => {
    const existing = [
      { id: '1', name: 'ABC Builders' },
      { id: '2', name: 'ABC Roofing' },
    ];
    expect(matchCustomer('ABC', existing)).toBeNull();
  });

  it('returns null when there is no match at all', () => {
    const existing = [{ id: '1', name: 'Turner Construction' }];
    expect(matchCustomer('Brasfield & Gorrie', existing)).toBeNull();
  });

  it('matches via containment when exactly one existing customer contains the candidate', () => {
    const existing = [{ id: '1', name: 'Skanska USA Building Inc' }];
    expect(matchCustomer('Skanska USA', existing)).toEqual({ id: '1', name: 'Skanska USA Building Inc' });
  });

  it('returns null when containment would ambiguously match two existing customers', () => {
    const existing = [
      { id: '1', name: 'Ajax Electrical Roofing' },
      { id: '2', name: 'Ajax Electrical Supply' },
    ];
    expect(matchCustomer('Ajax Electrical', existing)).toBeNull();
  });

  it('returns null against an empty existing list', () => {
    expect(matchCustomer('Bay to Bay', [])).toBeNull();
  });

  it('does not merge two unrelated companies that share a single surname/word (DR Horton vs Horton Group)', () => {
    // "Horton Group" suffix-strips to the single token "horton" — a raw-substring
    // containment check would let "DR Horton" swallow it. Word-boundary containment
    // must refuse because the shorter side ("horton") is only one token.
    const existing = [{ id: '1', name: 'Horton Group' }];
    expect(matchCustomer('DR Horton', existing)).toBeNull();
  });

  it('never merges via containment when the shorter side normalizes to a single token, even with only one candidate', () => {
    const existing = [{ id: '1', name: 'Horton Roofing' }];
    expect(matchCustomer('Horton', existing)).toBeNull();
  });

  it('still matches a genuine multi-token contiguous subsequence', () => {
    const existing = [{ id: '1', name: 'Bay to Bay Electric Inc' }];
    expect(matchCustomer('Bay to Bay', existing)).toEqual({ id: '1', name: 'Bay to Bay Electric Inc' });
  });

  it('respects token boundaries — "bay to bays" is not a contiguous match for "bay to bay"', () => {
    const existing = [{ id: '1', name: 'Bay to Bay' }];
    expect(matchCustomer('Bay to Bays', existing)).toBeNull();
  });
});
