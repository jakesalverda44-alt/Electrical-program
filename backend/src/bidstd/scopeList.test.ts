// Takeoff accuracy Task 11 — the exact Big Dan's Car Wash (Lake City, Sep
// 2025) lines from the signed proposal.
import { describe, expect, it } from 'vitest';
import {
  significantTerms, mentionsExcludedItem, excludedScopeProblems, exclusionBulletsFor, renderScopeListBlock,
  nonElectricalFindings, nonElectricalReason, nearDuplicateLines, normalizeLineKey, type ScopeItem,
} from './scopeList';
import type { BidData } from './bidData';

const SCOPE: ScopeItem[] = [
  { id: '1', kind: 'exclude', text: '600A MCC — not included' },
  { id: '2', kind: 'exclude', text: 'VFDs for vacuums — not included' },
  { id: '3', kind: 'include', text: 'F/A: conduit + pull strings only' },
  { id: '4', kind: 'include', text: 'Data: conduit + pull strings only' },
];

/** The Lake City proposal's takeoff, as signed. */
function lakeCity(): Pick<BidData, 'takeoff' | 'sections'> {
  return {
    sections: [
      { title: 'A. Service & Distribution', bullets: ['Furnish and install 480V MCC for wash equipment (ECFECI).', 'Service entrance (ECFECI) per E-1.'] },
      { title: 'B. Branch Power', bullets: ['Power to vacuum producers.'] },
    ],
    takeoff: [
      { name: 'Service & Distribution', items: [
        { item: 'MCC', description: '480V MCC', unit: 'EA', qty: 1, source: 'E-1' },
        { item: 'VFD panels', description: '3 VFD panels for vacuum motors', unit: 'EA', qty: 3, source: 'E-3' },
        { item: 'MCCB', description: '400A MCCB main breaker', unit: 'EA', qty: 1, source: 'E-1' },
      ] },
      { name: 'Site / Underground / Allowances', items: [
        { item: 'HDPE pipe', description: 'Supply and install 12" HDPE pipe', unit: 'LF', qty: 500, source: 'C-3' },
        { item: 'Conduit', description: '2" HDPE conduit, directional bore', unit: 'LF', qty: 120, source: 'E-1' },
        { item: 'Light pole bases', description: 'Concrete light pole base', unit: 'EA', qty: 6, source: 'E-1' },
      ] },
      { name: 'Branch Power', items: [
        { item: 'Drywall', description: 'Install 5/8" drywall – Level 5 finish', unit: 'SF', qty: 8000, source: 'A-5' },
      ] },
      { name: 'Exterior / Site Lighting', items: [
        { item: 'Canopy lights', description: 'Install LED canopy fixtures', unit: 'EA', qty: 12, source: 'E-2' },
        { item: 'Canopy lights', description: 'Furnish and install surface-mounted LED canopy fixtures', unit: 'EA', qty: 12, source: 'E-2' },
        { item: 'Canopy', description: 'LED canopy fixture', unit: 'EA', qty: 12, source: 'E-2' },
        { item: 'Type A', description: '4 ft LED linear wraparound', unit: 'EA', qty: 10, source: 'E-2' },
        { item: 'Type B', description: '8 ft LED linear wraparound', unit: 'EA', qty: 4, source: 'E-2' },
      ] },
      { name: 'Interior Lighting', items: [
        { item: 'Exit sign', description: 'Exit sign', unit: 'EA', qty: 2, source: 'E-2' },
        { item: 'Exit sign', description: 'LED exit sign w/ battery', unit: 'EA', qty: 2, source: 'E-2' },
      ] },
      { name: 'Lighting Controls', items: [
        { item: 'Contactor', description: 'Lighting contactor', unit: 'EA', qty: 1, source: 'E-2' },
        { item: 'Contactor', description: 'Furnish and install lighting contactors', unit: 'EA', qty: 1, source: 'E-2' },
        { item: 'Contactor', description: 'Lighting contactor, 8-pole', unit: 'EA', qty: 1, source: 'E-2' },
      ] },
    ],
  };
}

describe('1. Not-included items', () => {
  it('terms ignore ratings and plurals', () => {
    expect(significantTerms('600A MCC — not included')).toEqual(['mcc']);
    expect(significantTerms('VFDs for vacuums')).toEqual(['vfd', 'vacuum']);
  });
  it('the Lake City MCC and VFD lines (and the MCC scope bullet) are blocked; MCCB is not an MCC', () => {
    expect(excludedScopeProblems(lakeCity(), SCOPE)).toEqual([
      'Takeoff Service & Distribution: "MCC 480V MCC" is on the Not-included list ("600A MCC — not included")',
      'A. Service & Distribution: "Furnish and install 480V MCC for wash equipment (ECFECI)." is on the Not-included list ("600A MCC — not included")',
      'Takeoff Service & Distribution: "VFD panels 3 VFD panels for vacuum motors" is on the Not-included list ("VFDs for vacuums — not included")',
    ]);
    expect(mentionsExcludedItem('400A MCCB main breaker', SCOPE[0])).toBe(false);
  });
  it('each Not-included item becomes an exclusion bullet, once', () => {
    expect(exclusionBulletsFor(SCOPE, [])).toEqual(['600A MCC — not included.', 'VFDs for vacuums — not included.']);
    expect(exclusionBulletsFor(SCOPE, ['MCC by others.'])).toEqual(['VFDs for vacuums — not included.']);
  });
  it('Agents 2 and 4 receive the list as binding', () => {
    expect(renderScopeListBlock(SCOPE)!.split('\n')).toEqual([
      '--- ESTIMATOR SCOPE LIST (BINDING — overrides the drawings, the analysis and every earlier scope) ---',
      'INCLUDED, exactly as limited here:',
      '- F/A: conduit + pull strings only',
      '- Data: conduit + pull strings only',
      'NOT INCLUDED — never write a scope bullet or takeoff line for these; each one gets an exclusion instead:',
      '- 600A MCC — not included',
      '- VFDs for vacuums — not included',
    ]);
    expect(renderScopeListBlock([])).toBeNull();
  });
});

describe('2. Non-electrical gate', () => {
  it('flags the HDPE pipe and the drywall (trade + SF unit); HDPE conduit and concrete light-pole bases are electrical', () => {
    const f = nonElectricalFindings(lakeCity(), []);
    expect(f.map(x => [x.line, x.reason])).toEqual([
      ['HDPE pipe Supply and install 12" HDPE pipe', 'site piping (HDPE / storm / sanitary / water)'],
      ['Drywall Install 5/8" drywall – Level 5 finish', 'drywall / finishes'],
    ]);
  });
  it('unit sanity alone catches an SF line with an innocent name', () => {
    expect(nonElectricalReason('Misc. work', 'SF')).toBe('unit "SF" is not an electrical takeoff unit');
    expect(nonElectricalReason('Duplex receptacle', 'EA')).toBeNull();
    expect(nonElectricalReason('Rooftop unit connection, 60A/3P', 'EA')).toBeNull();
    expect(nonElectricalReason('Furnish rooftop unit', 'EA')).toBe('HVAC equipment / ductwork supply');
  });
  it('an estimator override (with a reason) is carried on the finding', () => {
    const key = normalizeLineKey('Site / Underground / Allowances', 'HDPE pipe Supply and install 12" HDPE pipe');
    const f = nonElectricalFindings(lakeCity(), [{ lineKey: key, reason: 'Utility requires EC to set the service sleeve' }]);
    expect(f[0].overridden).toBe('Utility requires EC to set the service sleeve');
    expect(f[1].overridden).toBeNull();
  });
});

describe('3. Near-duplicate lines', () => {
  it('canopy fixtures x3, exit signs x2, lighting contactors x3 — but Type A vs Type B is not a duplicate', () => {
    expect(nearDuplicateLines(lakeCity())).toEqual([
      { category: 'Exterior / Site Lighting', lines: ['Canopy lights Install LED canopy fixtures', 'Canopy lights Furnish and install surface-mounted LED canopy fixtures', 'Canopy LED canopy fixture'] },
      { category: 'Interior Lighting', lines: ['Exit sign Exit sign', 'Exit sign LED exit sign w/ battery'] },
      { category: 'Lighting Controls', lines: ['Contactor Lighting contactor', 'Contactor Furnish and install lighting contactors', 'Contactor Lighting contactor, 8-pole'] },
    ]);
  });
});
