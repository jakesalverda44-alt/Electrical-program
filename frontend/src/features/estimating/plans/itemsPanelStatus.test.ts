import { describe, it, expect } from 'vitest';
import { computeLineStatus } from './itemsPanelStatus';
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
  it('applied: qty_source is markup, regardless of rollup', () => {
    expect(computeLineStatus(line({ qty_source: 'markup' }), rollup({ markedQty: 999 }))).toBe('applied');
    expect(computeLineStatus(line({ qty_source: 'markup' }), undefined)).toBe('applied');
  });

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
});
