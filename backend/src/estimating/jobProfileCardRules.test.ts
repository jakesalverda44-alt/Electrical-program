// Job profile card-update rules (Decision 4, as tightened by the fix round
// for review 1755e62).
import { describe, it, expect } from 'vitest';
import {
  computeCardUpdates, reconcileFills, mergeSuggestions, isRejected,
  type CurrentBidFields, type FillRecord, type StoredSuggestion,
} from './jobProfileCardRules';
import type { JobProfile, FieldEvidence } from '../ai/jobProfile';

function ev(value: unknown, opts: Partial<FieldEvidence> = {}): FieldEvidence {
  return { value, sheet: 'E-1', quote: 'quote', confidence: 'high', validated: true, ...opts };
}

function profile(fields: JobProfile['fields'], status: JobProfile['status'] = 'complete'): JobProfile {
  const unk = { value: null, sheet: null, quote: null };
  return {
    status, fields, rejected: [], usedVision: false, pagesUsed: [],
    systems: { fuel: unk, site_lighting: unk, fire_alarm: unk, generator: unk, ev: unk },
  };
}

const baseBid: CurrentBidFields = { name: 'Some Job', loc: null, sq_ft: null, project_type: null };

describe('computeCardUpdates — fills', () => {
  it('fills an empty field from a validated, high-confidence value, tagged with the sheet', () => {
    const plan = computeCardUpdates(baseBid, profile({ sq_ft: ev(7381, { sheet: 'C2.1', quote: 'BUILDING AREA: 7,381 S.F.' }) }));
    expect(plan.fills).toEqual([
      { field: 'sq_ft', value: 7381, sheet: 'C2.1', quote: 'BUILDING AREA: 7,381 S.F.', reasonTag: 'from plans (sheet C2.1)' },
    ]);
    expect(plan.suggestions).toEqual([]);
  });

  it('treats "—" (bids.ts default loc) as empty', () => {
    const plan = computeCardUpdates({ ...baseBid, loc: '—' }, profile({ loc: ev('2860 N Old Lake Wilson Rd, Kissimmee, FL 34747') }));
    expect(plan.fills.map(f => f.field)).toEqual(['loc']);
  });

  it('an empty field gets only a SUGGESTION when the value is not high confidence or not validated', () => {
    const plan = computeCardUpdates(baseBid, profile({
      architect: ev('AUTOZONE, INC.', { confidence: 'medium' }),
      prototype: ev('7N2-L', { confidence: 'high', validated: false }),
    }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions.map(s => s.field).sort()).toEqual(['architect', 'prototype']);
    expect(plan.suggestions.find(s => s.field === 'architect')!.message).toBe('Plans say "AUTOZONE, INC." (architect). Use it?');
  });

  it('an undetermined profile (a scanned set) changes nothing', () => {
    const plan = computeCardUpdates(baseBid, profile({ sq_ft: ev(7381) }, 'undetermined'));
    expect(plan).toEqual({ fills: [], suggestions: [] });
  });
});

describe('computeCardUpdates — conflicts, gc, name', () => {
  it('a filled field that differs is a suggestion, never an overwrite', () => {
    const plan = computeCardUpdates({ ...baseBid, sq_ft: 7000 }, profile({ sq_ft: ev(7381) }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions[0]).toMatchObject({ field: 'sq_ft', currentValue: 7000, suggestedValue: 7381, message: 'Plans say 7,381 SF — card says 7,000. Update?' });
  });

  it('equal values (case / whitespace, ISO dates) do nothing', () => {
    const plan = computeCardUpdates({ ...baseBid, brand: 'autozone ', plan_date: '2025-09-22' }, profile({ brand: ev('AutoZone'), plan_date: ev('2025-09-22') }));
    expect(plan).toEqual({ fills: [], suggestions: [] });
  });

  it('gc is never touched and name is only ever suggested', () => {
    const p = profile({ name: ev('AutoZone #10077 – Kissimmee, FL'), ...({ gc: ev('Some Other GC') } as unknown as JobProfile['fields']) });
    const plan = computeCardUpdates({ ...baseBid, name: '' }, p);
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions.map(s => s.field)).toEqual(['name']);
  });

  it('plan dates in the message are shown without the time', () => {
    const plan = computeCardUpdates({ ...baseBid, plan_date: '2025-12-03' }, profile({ plan_date: ev('2025-09-22') }));
    expect(plan.suggestions[0].message).toBe('Plans say 09/22/2025 — card says 12/03/2025 (plan date). Update?');
  });
});

describe('S2 — a cleared auto-fill is rejected, never re-filled', () => {
  const filled: Record<string, FillRecord> = { architect: { value: 'CPH, INC.', at: 't', sheet: 'C0.1', status: 'filled' } };

  it('a field the person cleared becomes a rejection; the same value is not filled or suggested again', () => {
    const fills = reconcileFills(filled, { ...baseBid, architect: null });
    expect(fills.architect).toMatchObject({ status: 'rejected', rejectedValues: ['CPH, INC.'] });
    expect(isRejected('architect', 'cph, inc.', fills)).toBe(true);
    const plan = computeCardUpdates({ ...baseBid, architect: null }, profile({ architect: ev('CPH, INC.') }), fills);
    expect(plan).toEqual({ fills: [], suggestions: [] });
  });

  it('a DIFFERENT plans value for that field can still fill', () => {
    const fills = reconcileFills(filled, { ...baseBid, architect: '' });
    const plan = computeCardUpdates({ ...baseBid, architect: '' }, profile({ architect: ev('RLBA ARCHITECTS') }), fills);
    expect(plan.fills.map(f => f.value)).toEqual(['RLBA ARCHITECTS']);
  });

  it('a field the person retyped is marked edited (their value stands; a differing plans value is a suggestion)', () => {
    const fills = reconcileFills(filled, { ...baseBid, architect: 'RLBA' });
    expect(fills.architect.status).toBe('edited');
    const plan = computeCardUpdates({ ...baseBid, architect: 'RLBA' }, profile({ architect: ev('CPH, INC.') }), fills);
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions.map(s => s.field)).toEqual(['architect']);
  });
});

describe('mergeSuggestions (Decision 6, review N5)', () => {
  const fresh = (value: unknown) => [{ field: 'sq_ft' as const, currentValue: 7000, suggestedValue: value, sheet: 'C2.1', quote: 'q', confidence: 'high', message: 'm' }];
  const prior = (status: StoredSuggestion['status'], value: unknown = 7381): Record<string, StoredSuggestion> =>
    ({ sq_ft: { value, sheet: 'C2.1', quote: 'q', status, at: 'then', by: 'Jake' } });

  it('an ignored suggestion stays ignored for the same value; a new value is pending again', () => {
    expect(mergeSuggestions(fresh(7381), prior('ignored')).sq_ft.status).toBe('ignored');
    expect(mergeSuggestions(fresh(7400), prior('ignored')).sq_ft.status).toBe('pending');
  });

  it('accepted, then retyped by the person: overridden — the same plans value is not re-suggested', () => {
    const out = mergeSuggestions(fresh(7381), prior('accepted'));
    expect(out.sq_ft.status).toBe('overridden');
    expect(out.sq_ft.by).toBe('Jake');
    expect(mergeSuggestions(fresh(7381), out).sq_ft.status).toBe('overridden');
    expect(mergeSuggestions(fresh(7500), out).sq_ft.status).toBe('pending');
  });

  it('a field the plans and card now agree on drops out', () => {
    expect(mergeSuggestions([], prior('pending'))).toEqual({});
  });
});
