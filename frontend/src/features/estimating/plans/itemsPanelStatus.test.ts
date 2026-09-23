import { describe, it, expect } from 'vitest';
import { computeLineStatus, STATUS_LABEL } from './itemsPanelStatus';
import { EstimateLine, RollupEntry } from '../types';

function line(over: Partial<EstimateLine> = {}): EstimateLine {
  return { category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA', source: 'takeoff', line_key: 'k1', ...over };
}
function rollup(over: Partial<RollupEntry> = {}): RollupEntry {
  return {
    lineKey: 'k1', markedQty: null, markerCount: 0, sheets: [], incompatibleCount: 0, missingScaleCount: 0,
    category: 'Branch Power', description: 'Duplex', unit: 'EA', currentQty: 10, qtySource: 'takeoff', aiQty: 10,
    ...over,
  };
}

describe('computeLineStatus', () => {
  it('not_marked: no rollup entry at all', () => {
    expect(computeLineStatus(line(), undefined)).toBe('not_marked');
  });

  it('not_marked: a rollup entry exists but has nothing confirmed (markedQty null)', () => {
    expect(computeLineStatus(line(), rollup({ markedQty: null }))).toBe('not_marked');
  });

  it('matches: markedQty equals the line\'s current qty', () => {
    expect(computeLineStatus(line({ qty: 10 }), rollup({ markedQty: 10 }))).toBe('matches');
  });

  it('differs: markedQty is confirmed but does not equal the current qty', () => {
    expect(computeLineStatus(line({ qty: 10 }), rollup({ markedQty: 24 }))).toBe('differs');
  });

  it('differs when markedQty is 0 and current qty is not (0 is a real confirmed value, not "nothing")', () => {
    expect(computeLineStatus(line({ qty: 5 }), rollup({ markedQty: 0 }))).toBe('differs');
  });

  it('matches when both are 0', () => {
    expect(computeLineStatus(line({ qty: 0 }), rollup({ markedQty: 0 }))).toBe('matches');
  });

  // Fix round 1 / B6 — 'applied' is now conditional on the CURRENT qty
  // still matching the LIVE rollup, not just qty_source==='markup' by
  // itself (the old, permanent-once-applied bug: 20 applied, 6 more
  // markers found later, and the row still read "Applied" in green with
  // no way to re-apply — see the reviewer's own failure scenario).
  describe('applied vs. changed_since_applied (B6)', () => {
    it('applied: qty_source is markup AND the current qty still equals the live rollup', () => {
      expect(computeLineStatus(line({ qty: 20, qty_source: 'markup' }), rollup({ markedQty: 20 }))).toBe('applied');
    });

    it('changed_since_applied: qty_source is markup but MORE markers were added since — rollup grew past the applied qty', () => {
      // The reviewer's exact scenario: 20 applied, 6 more fixtures found
      // and marked (26 total), qty still reads 20.
      expect(computeLineStatus(line({ qty: 20, qty_source: 'markup' }), rollup({ markedQty: 26 }))).toBe('changed_since_applied');
    });

    it('changed_since_applied: qty_source is markup but markers were REMOVED/rescaled since — rollup shrank below the applied qty', () => {
      expect(computeLineStatus(line({ qty: 20, qty_source: 'markup' }), rollup({ markedQty: 14 }))).toBe('changed_since_applied');
    });

    it('changed_since_applied: qty_source is markup but the rollup now has NOTHING confirmed at all (every marker deleted)', () => {
      expect(computeLineStatus(line({ qty: 20, qty_source: 'markup' }), rollup({ markedQty: null }))).toBe('changed_since_applied');
      expect(computeLineStatus(line({ qty: 20, qty_source: 'markup' }), undefined)).toBe('changed_since_applied');
    });

    it('applied tolerates sub-0.01 float/rounding noise between the stored qty and the live rollup (N6\'s applied-qty rounding)', () => {
      expect(computeLineStatus(line({ qty: 1234, qty_source: 'markup' }), rollup({ markedQty: 1234.004 }))).toBe('applied');
    });

    it('changed_since_applied once the gap exceeds the tolerance — this is not just "always applied" with a fuzzy match', () => {
      expect(computeLineStatus(line({ qty: 1234, qty_source: 'markup' }), rollup({ markedQty: 1234.5 }))).toBe('changed_since_applied');
    });

    it('STATUS_LABEL reads "Changed since applied"', () => {
      expect(STATUS_LABEL.changed_since_applied).toBe('Changed since applied');
    });
  });
});
