// Fix round 2 — compose-level blocks (S-R2-6) and their exact-line override.
import { describe, expect, it } from 'vitest';
import { coworkKissimmeeAgent4, AUTOZONE_SEED } from '../test/fixtures/bidstd/kissimmeeProposal';
import { composeProposal } from './composeProposal';
import { resolveAccountTerms, applyScopeAnswers } from './accountRules';
import { normalizeLineKey } from './scopeList';

function compose(extraExclusion: string, overrides: Array<{ lineKey: string; reason: string; flag?: string }> = []) {
  const a4 = coworkKissimmeeAgent4();
  a4.exclusions = [...(a4.exclusions ?? []), extraExclusion];
  const snap = resolveAccountTerms(AUTOZONE_SEED, 'brand', [], false);
  return composeProposal({
    agent4: a4,
    bidRow: { name: 'AutoZone Store #10077', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', gc: 'Summit General Contractors', brand: 'AutoZone' },
    price: '$81,485.60', accountSnap: snap,
    accountResolved: applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' }),
    scopeItems: [], overrides, countResult: null, reviewItems: [],
  });
}

describe('S-R2-6 — a conflicting named region blocks the GC documents (with an exact-line override)', () => {
  const sentence = 'Generator scope applies to Puerto Rico stores only.';
  it('the Kissimmee error blocks', () => {
    const r = compose(sentence);
    expect(r.lineFailures).toEqual([expect.objectContaining({ check: 'irrelevant_spec', line: sentence, flag: 'spec', category: 'spec' })]);
  });
  it('kept with a reason: clears only that sentence', () => {
    const kept = [{ lineKey: normalizeLineKey('spec', sentence), reason: 'Owner confirmed it applies here', flag: 'spec' }];
    expect(compose(sentence, kept).lineFailures).toEqual([]);
    expect(compose('Generator scope applies to Texas stores only.', kept).lineFailures).toHaveLength(1);
  });
});

describe('next round A3 — skipped sheets become Exclusions & Clarifications', () => {
  const run = (clarifications: string[], extra = '') => {
    const a4 = coworkKissimmeeAgent4();
    if (extra) a4.exclusions = [...(a4.exclusions ?? []), extra];
    const snap = resolveAccountTerms(AUTOZONE_SEED, 'brand', [], false);
    return composeProposal({
      agent4: a4,
      bidRow: { name: 'AutoZone Store #10077', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', gc: 'Summit General Contractors', brand: 'AutoZone' },
      price: '$81,485.60', accountSnap: snap,
      accountResolved: applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'APT', 'scope:power_poles:install': 'APT' }),
      scopeItems: [], overrides: [], countResult: null, reviewItems: [], clarifications,
    });
  };
  it('one bullet per skipped sheet, recorded as a correction, document still valid', () => {
    const r = run(['Mechanical schedules not provided at time of bid.', 'Sheet C-3.1 not provided at time of bid.']);
    expect(r.data.exclusions).toEqual(expect.arrayContaining(['Mechanical schedules not provided at time of bid.', 'Sheet C-3.1 not provided at time of bid.']));
    expect(r.corrections).toContain('Clarification added from the sheet check: "Mechanical schedules not provided at time of bid."');
    expect(r.dataProblems).toEqual([]);
  });
  it('never twice (Agent 4 already wrote it)', () => {
    const r = run(['Mechanical schedules not provided at time of bid.'], 'Mechanical schedules not provided at time of bid');
    expect(r.data.exclusions.filter(b => typeof b === 'string' && /Mechanical schedules not provided/.test(b))).toHaveLength(1);
  });
});

describe('next round A6 — "by G.C." never reaches the GC as an exclusion', () => {
  const run = (exclusion: string, overrides: Array<{ lineKey: string; reason: string; flag?: string }> = [], answers: Record<string, string> = { 'scope:power_poles:furnish': 'APT', 'scope:power_poles:install': 'APT' }) => {
    const a4 = coworkKissimmeeAgent4();
    a4.exclusions = [...(a4.exclusions ?? []), exclusion];
    const snap = resolveAccountTerms(AUTOZONE_SEED, 'brand', [], false);
    return composeProposal({
      agent4: a4,
      bidRow: { name: 'AutoZone Store #10077', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', gc: 'Summit General Contractors', brand: 'AutoZone' },
      price: '$81,485.60', accountSnap: snap, accountResolved: applyScopeAnswers(snap, answers),
      scopeItems: [], overrides, countResult: null, reviewItems: [],
    });
  };
  it('"Receptacles by GC." blocks (flag gc_scope) with the Decision-4 reason', () => {
    const r = run('Receptacles by GC.');
    expect(r.lineFailures).toEqual([expect.objectContaining({ check: 'gc_scope', category: 'exclusions', line: 'Receptacles by GC.', flag: 'gc_scope' })]);
    expect(r.lineFailures[0].detail).toContain('"by G.C." is APT scope');
  });
  it('kept with a reason: clears only that line', () => {
    const kept = [{ lineKey: normalizeLineKey('exclusions', 'Receptacles by GC.'), reason: 'GC confirmed they buy these direct', flag: 'gc_scope' }];
    expect(run('Receptacles by GC.', kept).lineFailures).toEqual([]);
  });
  it('a term the estimator really gave the GC is not flagged; other trades never are', () => {
    expect(run('Power poles furnished and installed by the GC.', [], { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'GC' }).lineFailures).toEqual([]);
    expect(run('Painting by the GC.').lineFailures).toEqual([]);
  });
});
