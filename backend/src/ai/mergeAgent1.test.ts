import { describe, expect, it } from 'vitest';
import { mergeAgent1Batches } from './mergeAgent1';

// Synthetic batch results shaped exactly like the AGENT1_SYSTEM schema
// (project, service, panels, equipment, quantities, allowances, ecfeciItems,
// flags, scopeNotes, missingSheets).

const batch1 = {
  project: {
    name: 'AutoZone #4521',
    address: '',
    gcName: 'Ace Builders',
    gcContact: '',
    gcEmail: '',
    drawingDate: '2026-01-15',
    sheets: ['E1.0', 'E1.1'],
    projectType: 'retail',
    sqFt: 0,
  },
  service: {
    voltage: '',
    mainAmps: 400,
    phase: 3,
    utilityCompany: '',
    transformerKVA: '',
    confidence: 'VERIFIED',
  },
  panels: [
    { name: 'MDP', amps: 400, voltage: '208/120', phase: 3, circuits: 42, location: 'Electrical Room', fedFrom: '', nemaRating: '', confidence: 'VERIFIED' },
  ],
  equipment: [
    { tag: 'ATS-1', description: 'Automatic Transfer Switch', amps: 400, voltage: '208', phase: 3, ecfeci: true, confidence: 'VERIFIED' },
  ],
  quantities: [
    { category: 'Interior Lighting', item: '2x4 LED Troffer', qty: 40, unit: 'EA', spec: '', sourceSheet: 'E2.0', confidence: 'VERIFIED' },
  ],
  allowances: [
    { item: 'Site Underground', footage: 200, unit: 'LF', sourceSheet: 'E3.0' },
  ],
  ecfeciItems: ['MDP', 'ATS-1'],
  flags: [
    { item: 'Panel LP-2', issue: 'Schedule not fully legible', risk: 'MEDIUM' },
  ],
  scopeNotes: ['Coordinate with GC on temp power'],
  missingSheets: ['E4.0'],
};

const batch2 = {
  project: {
    name: '',
    address: '123 Main St',
    gcName: '',
    gcContact: 'John Smith',
    gcEmail: '',
    drawingDate: '',
    sheets: ['E1.2'],
    projectType: '',
    sqFt: 7381,
  },
  service: {
    voltage: '208Y/120',
    mainAmps: 0,
    phase: 3,
    utilityCompany: 'Duke Energy',
    transformerKVA: '',
    confidence: 'VERIFIED',
  },
  panels: [
    { name: 'MDP', amps: 400, voltage: '208/120', phase: 3, circuits: 42, location: 'Electrical Room', fedFrom: '', nemaRating: '', confidence: 'VERIFIED' },
    { name: 'LP-2', amps: 100, voltage: '208/120', phase: 3, circuits: 24, location: 'Storage', fedFrom: 'MDP', nemaRating: '', confidence: 'ASSUMED' },
  ],
  equipment: [],
  quantities: [
    { category: 'Branch Power', item: 'Receptacle', qty: 60, unit: 'EA', spec: '', sourceSheet: 'E2.1', confidence: 'VERIFIED' },
  ],
  allowances: [],
  ecfeciItems: [],
  flags: [],
  scopeNotes: ['Verify utility transformer location'],
  missingSheets: [],
};

describe('mergeAgent1Batches', () => {
  it('concatenates array fields across batches', () => {
    const merged = mergeAgent1Batches([batch1, batch2]);
    expect(merged.quantities).toHaveLength(2);
    expect(merged.allowances).toHaveLength(1);
    expect(merged.flags).toHaveLength(1);
    expect(merged.scopeNotes).toEqual([
      'Coordinate with GC on temp power',
      'Verify utility transformer location',
    ]);
    expect(merged.ecfeciItems).toEqual(['MDP', 'ATS-1']);
    expect(merged.missingSheets).toEqual(['E4.0']);
  });

  it('merges object fields field-by-field, first non-empty wins, later batches fill gaps', () => {
    const merged = mergeAgent1Batches([batch1, batch2]);
    const project = merged.project as Record<string, unknown>;
    expect(project.name).toBe('AutoZone #4521');       // batch1 had it, batch2 empty
    expect(project.address).toBe('123 Main St');        // batch1 empty, batch2 filled it
    expect(project.gcName).toBe('Ace Builders');
    expect(project.gcContact).toBe('John Smith');
    expect(project.sqFt).toBe(7381);                    // batch1 had 0 (empty), batch2 filled it
    expect(project.sheets).toEqual(['E1.0', 'E1.1']);    // object field merge does not concat arrays inside objects

    const service = merged.service as Record<string, unknown>;
    expect(service.mainAmps).toBe(400);                  // batch1 had it, batch2 had 0
    expect(service.voltage).toBe('208Y/120');            // batch1 empty, batch2 filled
    expect(service.utilityCompany).toBe('Duke Energy');
  });

  it('tags a duplicate panel signature (name + location) as CROSS-REFERENCE', () => {
    const merged = mergeAgent1Batches([batch1, batch2]);
    const panels = merged.panels as Record<string, unknown>[];
    expect(panels).toHaveLength(3);
    expect(panels[0].cross_reference).toBeUndefined();    // batch1 MDP, first occurrence
    expect(panels[2].cross_reference).toBeUndefined();    // LP-2, unique, first occurrence
    // The MDP entry from batch2 (index 1) duplicates batch1's MDP (name+location)
    expect(panels[1].name).toBe('MDP');
    expect(panels[1].cross_reference).toBe('CROSS-REFERENCE — VERIFY');
  });

  it('falls back to name alone when location is empty', () => {
    const withNoLocation1 = { panels: [{ name: 'DP-1', location: '' }] };
    const withNoLocation2 = { panels: [{ name: 'DP-1', location: '' }] };
    const merged = mergeAgent1Batches([withNoLocation1, withNoLocation2]);
    const panels = merged.panels as Record<string, unknown>[];
    expect(panels[1].cross_reference).toBe('CROSS-REFERENCE — VERIFY');
  });

  it('merges an unknown extra array key from a hypothetical custom prompt', () => {
    const customBatch1 = { ...batch1, customArrayKey: ['x'] };
    const customBatch2 = { ...batch2, customArrayKey: ['y', 'z'] };
    const merged = mergeAgent1Batches([customBatch1, customBatch2]);
    expect(merged.customArrayKey).toEqual(['x', 'y', 'z']);
  });

  it('handles a single batch (no duplicates, straight passthrough)', () => {
    const merged = mergeAgent1Batches([batch1]);
    expect(merged.quantities).toHaveLength(1);
    expect((merged.project as Record<string, unknown>).name).toBe('AutoZone #4521');
  });

  it('handles an empty batch array', () => {
    const merged = mergeAgent1Batches([]);
    expect(merged).toEqual({});
  });
});
