// Task 6 (phase 2 takeoff fidelity): buildPrebidCrossCheck (pure).
import { describe, it, expect } from 'vitest';
import { buildPrebidCrossCheck, PREBID_CROSS_CHECK_HEADER, CROSS_CHECK_CAP } from './agent3CrossCheck';

describe('buildPrebidCrossCheck (pure)', () => {
  it('returns null when there is no pre-bid row at all', () => {
    expect(buildPrebidCrossCheck(null)).toBeNull();
    expect(buildPrebidCrossCheck(undefined)).toBeNull();
  });

  it('returns null when the row has no line items', () => {
    expect(buildPrebidCrossCheck({ categories: [], line_items: [] })).toBeNull();
    expect(buildPrebidCrossCheck({ categories: [{ name: 'LIGHTING' }], line_items: null })).toBeNull();
  });

  it('emits the header, groups by category, and renders description/qty/confidence per row', () => {
    const out = buildPrebidCrossCheck({
      categories: [{ name: 'LIGHTING' }, { name: 'BRANCH POWER' }],
      line_items: [
        { category: 'LIGHTING', description: 'LED Troffer 2x4', unit: 'EA', qty: 48, confidence: 'FIRM' },
        { category: 'BRANCH POWER', description: 'Duplex Receptacle', unit: 'EA', qty: 64, confidence: 'APPROX' },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.startsWith(PREBID_CROSS_CHECK_HEADER)).toBe(true);
    expect(out).toContain('LIGHTING:');
    expect(out).toContain('- LED Troffer 2x4 — 48 EA [FIRM]');
    expect(out).toContain('BRANCH POWER:');
    expect(out).toContain('- Duplex Receptacle — 64 EA [APPROX]');
    // Categories list order wins over first-appearance order.
    expect(out!.indexOf('LIGHTING:')).toBeLessThan(out!.indexOf('BRANCH POWER:'));
  });

  it('renders a null qty as UNRESOLVED, not "null" or "0"', () => {
    const out = buildPrebidCrossCheck({
      categories: [{ name: 'LOW VOLTAGE' }],
      line_items: [
        { category: 'LOW VOLTAGE', description: 'Data Cable', unit: 'LF', qty: null, confidence: 'VERIFY' },
      ],
    });
    expect(out).toContain('- Data Cable — UNRESOLVED [VERIFY]');
    expect(out).not.toContain('null');
    expect(out).not.toContain('— 0');
  });

  it('renders a row with no confidence field with no bracket suffix', () => {
    const out = buildPrebidCrossCheck({
      categories: [],
      line_items: [{ category: 'FUEL', description: 'Dispenser', unit: 'EA', qty: 6 }],
    });
    expect(out).toContain('- Dispenser — 6 EA');
    expect(out).not.toContain('[');
  });

  it('falls back to first-appearance order when categories is absent', () => {
    const out = buildPrebidCrossCheck({
      line_items: [
        { category: 'ZED CATEGORY', description: 'Item Z', unit: 'EA', qty: 1 },
        { category: 'ALPHA CATEGORY', description: 'Item A', unit: 'EA', qty: 1 },
      ],
    });
    expect(out!.indexOf('ZED CATEGORY:')).toBeLessThan(out!.indexOf('ALPHA CATEGORY:'));
  });

  it('groups every line item under its own category even when categories omits one', () => {
    const out = buildPrebidCrossCheck({
      categories: [{ name: 'LIGHTING' }],
      line_items: [
        { category: 'LIGHTING', description: 'Item L', unit: 'EA', qty: 1 },
        { category: 'FIRE ALARM', description: 'Item F', unit: 'EA', qty: 1 },
      ],
    });
    expect(out).toContain('FIRE ALARM:');
    expect(out).toContain('- Item F — 1 EA');
  });

  it('caps the output at CROSS_CHECK_CAP chars with a visible marker', () => {
    const line_items = Array.from({ length: 2000 }, (_, i) => ({
      category: 'BRANCH POWER',
      description: `Duplex Receptacle circuit run number ${i} on level two east wing`,
      unit: 'EA',
      qty: 1,
      confidence: 'FIRM' as const,
    }));
    const out = buildPrebidCrossCheck({ categories: [{ name: 'BRANCH POWER' }], line_items });
    expect(out!.length).toBeLessThanOrEqual(CROSS_CHECK_CAP + '\n[TRUNCATED — pre-bid cross-check exceeded limit]'.length);
    expect(out).toContain('[TRUNCATED — pre-bid cross-check exceeded limit]');
  });
});
