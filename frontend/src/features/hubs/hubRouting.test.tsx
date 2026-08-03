import { describe, it, expect } from 'vitest';
import { coerceGenTab, coerceElecTab, GEN_HUB_TABS, ELEC_HUB_TABS } from './constants';

describe('hub tab coercion', () => {
  it('accepts valid tabs', () => {
    for (const t of GEN_HUB_TABS) expect(coerceGenTab(t.key)).toBe(t.key);
    for (const t of ELEC_HUB_TABS) expect(coerceElecTab(t.key)).toBe(t.key);
  });
  it('falls back to overview on unknown/missing', () => {
    expect(coerceGenTab('nope')).toBe('overview');
    expect(coerceGenTab(null)).toBe('overview');
    expect(coerceElecTab('leads')).toBe('overview'); // gen-only tab is invalid here
  });
});
