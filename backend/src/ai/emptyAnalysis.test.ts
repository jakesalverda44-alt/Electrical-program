import { describe, it, expect } from 'vitest';
import { analysisIsEmpty } from './emptyAnalysis';

describe('analysisIsEmpty (pure)', () => {
  it('is true for a fully empty object (every batch failed to parse)', () => {
    expect(analysisIsEmpty({})).toBe(true);
  });

  it('is true for null/undefined input', () => {
    expect(analysisIsEmpty(null)).toBe(true);
    expect(analysisIsEmpty(undefined)).toBe(true);
  });

  it('is true when panels/equipment/quantities are all present but empty arrays', () => {
    expect(analysisIsEmpty({ panels: [], equipment: [], quantities: [] })).toBe(true);
  });

  it('is true when the fields are the wrong type (not arrays at all)', () => {
    expect(analysisIsEmpty({ panels: null, equipment: 'none', quantities: 0 })).toBe(true);
  });

  it('is false when panels has at least one entry', () => {
    expect(analysisIsEmpty({ panels: [{ name: 'MDP' }], equipment: [], quantities: [] })).toBe(false);
  });

  it('is false when equipment has at least one entry', () => {
    expect(analysisIsEmpty({ panels: [], equipment: [{ tag: 'ATS-1' }], quantities: [] })).toBe(false);
  });

  it('is false when quantities has at least one entry', () => {
    expect(analysisIsEmpty({ panels: [], equipment: [], quantities: [{ item: 'LED Troffer' }] })).toBe(false);
  });

  it('is false for a normal, populated analysis (other fields present too)', () => {
    expect(analysisIsEmpty({
      project: { name: 'Test' },
      panels: [{ name: 'MDP', amps: 400 }],
      equipment: [],
      quantities: [{ item: 'Fixture', qty: 10 }],
      scopeNotes: ['note'],
    })).toBe(false);
  });
});
