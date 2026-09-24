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
