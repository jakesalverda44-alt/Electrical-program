// Takeoff accuracy Task 9 — output hygiene, one test per Kissimmee error.
import { describe, expect, it } from 'vitest';
import {
  emptyHygiene, applyGcHygiene, filterMissingSheets, downgradeNotFound, collectSqFt, normalizeSheetNo,
  irrelevantSpecSentences, projectStateOf, zeroQuantityProblems,
} from './outputHygiene';
import { KISSIMMEE_AGENT1_BATCHES, kissimmeeAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';
import { verifyBidText } from '../bidstd/verifyBid';
import { standardScope6, standardTerms } from '../bidstd/boilerplate';

describe('GC = the bid record (Kissimmee: the owner AutoZone Stores LLC was pulled as the GC)', () => {
  it('the drawings\' name moves to gc_extracted, the bid GC is used, the mismatch is flagged', () => {
    const r = emptyHygiene();
    const out = applyGcHygiene(kissimmeeAgent1(), 'Summit General Contractors', r);
    expect((out.project as Record<string, unknown>).gcName).toBe('Summit General Contractors');
    expect((out.project as Record<string, unknown>).gc_extracted).toBe('AutoZone Stores LLC');
    expect(r.gc).toEqual({ bidGc: 'Summit General Contractors', extracted: 'AutoZone Stores LLC', owner: '', mismatch: true });
    expect(r.flags[0]).toBe('The drawings name "AutoZone Stores LLC" where the GC goes; this bid\'s GC is Summit General Contractors — the bid record is used everywhere.');
  });
  it('the same company spelled differently is not a mismatch', () => {
    const r = emptyHygiene();
    applyGcHygiene({ project: { gcName: 'SUMMIT GENERAL CONTRACTORS, INC.' } }, 'Summit General Contractors', r);
    expect(r.gc!.mismatch).toBe(false);
    expect(r.flags).toEqual([]);
  });
  it('never touches anything when the bid has no GC', () => {
    const json = { project: { gcName: 'X' } };
    expect(applyGcHygiene(json, '', emptyHygiene())).toBe(json);
  });
});

describe('"Missing sheets" filtered against what was loaded', () => {
  it('Kissimmee: E-3 and E-7 were in the set (and E-3 listed twice across batches); E-5 really is missing', () => {
    const r = emptyHygiene();
    const out = filterMissingSheets(kissimmeeAgent1(), ['E-0.1', 'E-1', 'E-2', 'E3.0', 'E-4', 'E 7', 'PH0.1'], r);
    expect(out.missingSheets).toEqual(['E-5']);
    expect(r.removedMissingSheets).toEqual(['E-3', 'E-7', 'E-3']);
  });
  it('normalizes sheet numbers', () => {
    expect(normalizeSheetNo('E-3.0')).toBe('E3');
    expect(normalizeSheetNo('sheet e 101')).toBe('E101');
    expect(normalizeSheetNo('E-3.1')).toBe('E3.1');
  });
});

describe('a value flagged not-found is never VERIFIED/FIRM', () => {
  it('Kissimmee utility "Not found on drawings" (VERIFIED) -> ASSUMED, recorded', () => {
    const r = emptyHygiene();
    const out = downgradeNotFound(kissimmeeAgent1(), r);
    expect((out.service as Record<string, unknown>).confidence).toBe('ASSUMED');
    expect(r.downgraded).toContainEqual({ path: 'service', value: 'utilityCompany: Not found on drawings', from: 'VERIFIED', to: 'ASSUMED' });
    // Everything else untouched.
    expect(((out.panels as Array<Record<string, unknown>>)[0]).confidence).toBe('VERIFIED');
  });
  it('Agent 2 / playbook vocabulary: FIRM -> APPROX', () => {
    const r = emptyHygiene();
    const out = downgradeNotFound({ takeoff: [{ item: 'Utility transformer', notes: 'size not shown', confidence: 'FIRM' }] }, r);
    expect((out.takeoff as Array<Record<string, unknown>>)[0].confidence).toBe('APPROX');
  });
});

describe('square footage', () => {
  it('Kissimmee batches say 7,381 and 7,350: both kept, flagged', () => {
    const r = emptyHygiene();
    collectSqFt(KISSIMMEE_AGENT1_BATCHES as unknown as Array<Record<string, unknown>>, r);
    expect(r.sqFt).toEqual({ values: [{ value: 7381, source: 'drawing analysis batch 1' }, { value: 7350, source: 'drawing analysis batch 2' }], conflict: true });
    expect(r.flags[0]).toMatch(/^Two different square footages on the drawings: 7,381 SF .* vs 7,350 SF/);
  });
  it('one value: kept with its source, no flag', () => {
    const r = emptyHygiene();
    collectSqFt([{ project: { sqFt: 7381, sqFtSource: 'A-001 code data' } }], r);
    expect(r.sqFt).toEqual({ values: [{ value: 7381, source: 'A-001 code data' }], conflict: false });
    expect(r.flags).toEqual([]);
  });
});

describe('GC-facing text', () => {
  it('verifyBid blocks RFI, "field verify", "verify in field", TBD and ±', () => {
    const v = verifyBidText('RFI 3 pending. Field verify existing utility. Verify in field the panel location. Panel size TBD. ±10%.', 'gc');
    expect(v.failures.find(f => f.check === 'banned_language')!.matches).toEqual(['RFI', 'Field verify', 'Verify in field', '±', 'TBD']);
  });
  it('zero-quantity takeoff lines and zero-footage allowances are problems', () => {
    expect(zeroQuantityProblems({
      takeoff: [{ name: 'Site / Underground / Allowances', items: [{ item: 'Site underground to poles', description: 'Allowance', unit: 'LF', qty: 0, source: 'E-1' }, { item: 'Primary conduit', description: '', unit: 'LF', qty: 120, source: 'Civil' }] }],
      sections: [{ title: 'D. Site Lighting, Underground Work & Allowances', bullets: ["0' allowance — field verify site underground.", "120' allowance - primary conduit."] }],
    })).toEqual([
      'Site / Underground / Allowances: "Site underground to poles — Allowance" has quantity 0',
      'D. Site Lighting, Underground Work & Allowances: zero-footage allowance "0\' allowance — field verify site underground."',
    ]);
  });
  it('owner-spec text scoped to other stores/regions is blocked; a mere state name is only a warning', () => {
    const text = 'Generator scope applies to Puerto Rico stores only.\nCoordinate the service with Duke Energy.\nFlorida Building Code 2023 applies.\nMeter per Georgia Power standards.';
    expect(irrelevantSpecSentences(text, '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747')).toEqual({
      block: ['Generator scope applies to Puerto Rico stores only.'],
      warn: [],
    });
    const v = verifyBidText(text, 'gc', { projectAddress: 'Kissimmee, FL 34747' });
    expect(v.failures.find(f => f.check === 'irrelevant_spec')!.matches).toEqual(['Generator scope applies to Puerto Rico stores only.']);
    expect(irrelevantSpecSentences('Service from Georgia Power per utility standards.', 'Kissimmee, FL 34747').warn).toEqual([]);
    expect(irrelevantSpecSentences('Per the Texas prototype details.', 'Kissimmee, FL 34747')).toEqual({ block: [], warn: ['Per the Texas prototype details.'] });
  });
  it('reads the project state from the address', () => {
    expect(projectStateOf('2860 N Old Lake Wilson Rd, Kissimmee, FL 34747')).toBe('Florida');
    expect(projectStateOf('Ocala, Florida')).toBe('Florida');
    expect(projectStateOf('')).toBeNull();
  });
});

describe('change orders are approved by the GC (Jake), not the Owner', () => {
  it('scope bullet 3 and terms bullet 6', () => {
    expect(standardScope6('d', 's', 'Summit')[2]).toBe('Installation per plan. All changes will require a written Change Order approved by the GC before work proceeds.');
    expect(standardTerms('d')[5]).toBe('All changes to the approved scope require a written Change Order signed by the GC prior to proceeding.');
  });
});
