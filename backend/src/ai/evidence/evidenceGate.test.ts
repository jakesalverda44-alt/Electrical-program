// Evidence round 4.1 — the GC-facing evidence gate's pure half.
import { describe, it, expect } from 'vitest';
import { lineEvidenceKind, missingEvidenceTypes, manualLinesMissingReason } from './evidenceGate';
import type { TypeCountResult } from '../countMerge';

function type(over: Partial<TypeCountResult>): TypeCountResult {
  return {
    key: 'X', type: 'X', description: '', category: 'device', count: 1, heads: null, status: 'counted', reason: '',
    sheets: [], flags: [], wattage: null, ...over,
  };
}

describe('lineEvidenceKind', () => {
  it('schedule beats everything else; a marker beats a bare typical component', () => {
    expect(lineEvidenceKind(type({ scheduleRows: [{ sheetKey: 's', sheetLabel: 'S', tableId: 't', table: 'T', rowIdx: 0, cells: [], qty: 1 }] }))).toBe('schedule');
    expect(lineEvidenceKind(type({ sheets: [{ sheetKey: 's', label: 'S', count: 1, used: true }] }))).toBe('marker');
    expect(lineEvidenceKind(type({ sheets: [{ sheetKey: 's', label: 'S', count: 1, used: true }], photometricOnly: true }))).toBe('photometric');
    expect(lineEvidenceKind(type({ sheets: [], components: { drawn: 0, typical: 3, schedule: 0 } }))).toBe('typical');
    expect(lineEvidenceKind(type({ sheets: [] }))).toBe('none');
  });
  it('B2 — a gap-fill suggestion is never, by itself, evidence (it is only ever a suggested marker + a review item)', () => {
    // No `gapFill`-shaped field exists on TypeCountResult any more; a type
    // with no drawn mark and no schedule row is 'none' regardless of what
    // gap-fill proposed for it.
    expect(lineEvidenceKind(type({ sheets: [] }))).toBe('none');
  });
});

describe('missingEvidenceTypes', () => {
  it('a counted type with real evidence is never flagged; one with none is', () => {
    const evidenced = type({ key: 'A', sheets: [{ sheetKey: 's', label: 'S', count: 1, used: true }] });
    const bare = type({ key: 'B', sheets: [] });
    expect(missingEvidenceTypes([evidenced, bare])).toEqual([{ key: 'B', type: 'X', description: '' }]);
  });
  it('a zero-count or unreadable type is never flagged (it has its own review item)', () => {
    expect(missingEvidenceTypes([type({ key: 'B', status: 'zero', count: 0, sheets: [] })])).toEqual([]);
    expect(missingEvidenceTypes([type({ key: 'B', status: 'unreadable', count: 0, sheets: [] })])).toEqual([]);
  });
  it('a host marker or a merged type is never GC-facing evidence-checked', () => {
    expect(missingEvidenceTypes([{ ...type({ key: 'H', sheets: [] }), host: true }])).toEqual([]);
    expect(missingEvidenceTypes([type({ key: 'M', status: 'merged', sheets: [] })])).toEqual([]);
  });
  it('S14 — a type the estimator RESOLVED (any review-item action) is never flagged, even with no AI evidence', () => {
    const bare = type({ key: 'B', sheets: [] });
    expect(missingEvidenceTypes([bare], new Set(['B']))).toEqual([]);
    expect(missingEvidenceTypes([bare], new Set(['OTHER']))).toHaveLength(1);
  });
});

describe('manualLinesMissingReason', () => {
  const takeoffLine = { description: 'Type A — troffer', source: 'takeoff' as const };
  it('a manual line with no reason is flagged; a real reason (10+ chars) clears it', () => {
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual' }])).toHaveLength(1);
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual', evidence_note: 'short' }])).toHaveLength(1);
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual', evidence_note: 'Verbal add per GC on 9/24' }])).toEqual([]);
  });
  it('a takeoff line the estimator hand-overrode (qty_source manual) needs a reason too', () => {
    expect(manualLinesMissingReason([{ ...takeoffLine, qty_source: 'manual' }])).toHaveLength(1);
    expect(manualLinesMissingReason([{ ...takeoffLine, qty_source: 'markup' }])).toEqual([]);
  });
  it('an ordinary AI-sourced takeoff line is never flagged; an excluded line is never flagged', () => {
    expect(manualLinesMissingReason([takeoffLine])).toEqual([]);
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual', excluded: true }])).toEqual([]);
  });
  it('S6 — a long but letter-less "reason" (the migration 134 placeholder shape, or a keyboard-mash) still fails', () => {
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual', evidence_note: '..........' }])).toHaveLength(1);
    expect(manualLinesMissingReason([{ ...takeoffLine, source: 'manual', evidence_note: '1234567890123' }])).toHaveLength(1);
  });
});
