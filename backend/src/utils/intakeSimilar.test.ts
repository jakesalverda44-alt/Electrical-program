import { describe, it, expect } from 'vitest';
import { similarKey, findSimilar, SimilarCandidate } from './intakeSimilar';

describe('similarKey', () => {
  it('strips a bracketed (REBID) tag', () => {
    expect(similarKey('7-Eleven #42901 (REBID) - Tampa, FL'))
      .toBe(similarKey('7-Eleven #42901 - Tampa, FL'));
  });

  it('strips a bracketed [RFP] tag and collapses three Nick & Moes duplicates to one key', () => {
    const a = similarKey('[RFP] Nick & Moes Winter Haven');
    const b = similarKey('Nick & Moes Winter Haven');
    const c = similarKey('RE: [RFP] Nick & Moes Winter Haven');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('strips a leading RE:/FW:/FWD: prefix', () => {
    expect(similarKey('RE: Downtown Parking Structure')).toBe(similarKey('Downtown Parking Structure'));
    expect(similarKey('FWD: Downtown Parking Structure')).toBe(similarKey('Downtown Parking Structure'));
  });

  it('ignores punctuation and case', () => {
    expect(similarKey('7-Eleven #42901 - Tampa, FL')).toBe(similarKey('7 eleven 42901 tampa fl'));
  });

  it('two unrelated projects normalize to different keys', () => {
    expect(similarKey('Alachua County Admin Building')).not.toBe(similarKey('Firestone - (Prototype)'));
  });
});

describe('findSimilar', () => {
  const rebid: SimilarCandidate = { kind: 'intake', id: 'i1', name: '7-Eleven #42901 (REBID) - Tampa, FL' };
  const original: SimilarCandidate = { kind: 'bid', id: 'b1', name: '7-Eleven #42901 - Tampa, FL', stage: 'submitted' };
  const unrelated: SimilarCandidate = { kind: 'bid', id: 'b2', name: 'Firestone - (Prototype)', stage: 'new' };

  it('matches an exact-key REBID against its original bid', () => {
    const out = findSimilar(rebid.name, [original, unrelated]);
    expect(out).toEqual([original]);
  });

  it('matches when one key contains the other (partial project name)', () => {
    const short: SimilarCandidate = { kind: 'intake', id: 'i2', name: 'Nick & Moes Winter Haven' };
    const long: SimilarCandidate = { kind: 'intake', id: 'i3', name: '[RFP] Nick & Moes Winter Haven Retrofit Phase 2' };
    expect(findSimilar(short.name, [long])).toEqual([long]);
    expect(findSimilar(long.name, [short])).toEqual([short]);
  });

  it('does not match unrelated projects', () => {
    expect(findSimilar(original.name, [unrelated])).toEqual([]);
  });

  it('ignores a short/generic subject key entirely', () => {
    expect(findSimilar('Bid', [original, unrelated])).toEqual([]);
  });

  it('ignores a short/generic candidate key', () => {
    const generic: SimilarCandidate = { kind: 'intake', id: 'i9', name: 'ITB' };
    expect(findSimilar(original.name, [generic])).toEqual([]);
  });

  it('caps results at 3 by default', () => {
    const many: SimilarCandidate[] = Array.from({ length: 5 }, (_, i) => (
      { kind: 'intake', id: `dup-${i}`, name: `Nick & Moes Winter Haven ${i}` }
    ));
    expect(findSimilar('Nick & Moes Winter Haven', many)).toHaveLength(3);
  });

  it('respects a custom max', () => {
    const many: SimilarCandidate[] = Array.from({ length: 5 }, (_, i) => (
      { kind: 'intake', id: `dup-${i}`, name: `Nick & Moes Winter Haven ${i}` }
    ));
    expect(findSimilar('Nick & Moes Winter Haven', many, 2)).toHaveLength(2);
  });
});

describe('single-token containment ban', () => {
  it('a bare brand-name bid does not chip against every same-brand invite', () => {
    const candidates = [
      { kind: 'bid' as const, id: '1', name: 'AutoZone', stage: 'submitted' },
      { kind: 'bid' as const, id: '2', name: 'AutoZone', stage: 'lost' },
      { kind: 'bid' as const, id: '3', name: 'AutoZone #9300 - Nokomis, FL', stage: 'due' },
    ];
    const hits = findSimilar('AutoZone #9300 - Nokomis, FL: Invitation to bid on AutoZone #9300 - Nokomis, FL', candidates);
    expect(hits.map(h => h.id)).toEqual(['3']);
  });

  it('multi-token containment still matches', () => {
    const hits = findSimilar('7-Eleven #42901 (REBID) - Tampa, FL', [
      { kind: 'bid' as const, id: 'a', name: '7-Eleven #42901 - Tampa, FL', stage: 'submitted' },
    ]);
    expect(hits).toHaveLength(1);
  });
});
