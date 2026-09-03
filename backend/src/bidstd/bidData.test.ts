import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateBidData, BidData } from './bidData';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

describe('validateBidData', () => {
  it('round-trips the canonical fixture clean', () => {
    expect(validateBidData(fixture)).toEqual([]);
  });

  it('flags a missing required field', () => {
    const problems = validateBidData({ ...fixture, project_name: '' });
    expect(problems.some(p => p.includes('project_name'))).toBe(true);
  });

  it('flags a scope that is not exactly 6 bullets', () => {
    const problems = validateBidData({ ...fixture, scope: fixture.scope.slice(0, 3) });
    expect(problems.some(p => /scope must have exactly 6/.test(p))).toBe(true);
  });

  it('flags an empty scope bullet', () => {
    const problems = validateBidData({ ...fixture, scope: [...fixture.scope.slice(0, 5), ''] });
    expect(problems.some(p => /empty bullet/.test(p))).toBe(true);
  });

  it('flags empty sections', () => {
    const problems = validateBidData({ ...fixture, sections: [] });
    expect(problems.some(p => /sections must not be empty/.test(p))).toBe(true);
  });

  it('flags a section with no bullets', () => {
    const problems = validateBidData({
      ...fixture,
      sections: [{ title: 'A. Service & Distribution', bullets: [] }],
    });
    expect(problems.some(p => /has no bullets/.test(p))).toBe(true);
  });

  it('flags an empty takeoff', () => {
    const problems = validateBidData({ ...fixture, takeoff: [] });
    expect(problems.some(p => /takeoff must not be empty/.test(p))).toBe(true);
  });

  it('flags a takeoff category missing a name', () => {
    const problems = validateBidData({
      ...fixture,
      takeoff: [{ name: '', items: [] }],
    });
    expect(problems.some(p => /missing a name/.test(p))).toBe(true);
  });

  it('flags terms that are not exactly 10 bullets', () => {
    const problems = validateBidData({ ...fixture, terms: fixture.terms.slice(0, 2) });
    expect(problems.some(p => /terms must have exactly 10/.test(p))).toBe(true);
  });

  it('flags missing exclusions', () => {
    const problems = validateBidData({ ...fixture, exclusions: [] });
    expect(problems.some(p => /exclusions must not be empty/.test(p))).toBe(true);
  });

  it('handles null/undefined input without throwing', () => {
    expect(validateBidData(null)).not.toEqual([]);
    expect(validateBidData(undefined)).not.toEqual([]);
  });

  it('accepts a mixed-run bullet ({b,t}) as a valid scope entry', () => {
    const data = {
      ...fixture,
      scope: [...fixture.scope.slice(0, 5), { b: 'Bold lead: ', t: 'rest of sentence.' }],
    };
    expect(validateBidData(data)).toEqual([]);
  });
});
