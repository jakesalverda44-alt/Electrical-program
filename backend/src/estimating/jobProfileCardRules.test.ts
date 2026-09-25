import { describe, it, expect } from 'vitest';
import { computeCardUpdates, CurrentBidFields } from './jobProfileCardRules';
import type { JobProfile, FieldEvidence } from '../ai/jobProfile';

function ev(value: unknown, sheet: string | null = 'E-1', quote: string | null = 'quote'): FieldEvidence {
  return { value, sheet, quote, confidence: 'extracted' } as FieldEvidence;
}

function profile(fields: JobProfile['fields']): JobProfile {
  return {
    fields,
    systems: {
      fuel: ev(false) as unknown as FieldEvidence<boolean>,
      site_lighting: ev(false) as unknown as FieldEvidence<boolean>,
      fire_alarm: ev(false) as unknown as FieldEvidence<boolean>,
      generator: ev(false) as unknown as FieldEvidence<boolean>,
      ev: ev(false) as unknown as FieldEvidence<boolean>,
    },
    usedVision: false,
  };
}

const baseBid: CurrentBidFields = { name: 'Some Job', loc: null, sq_ft: null, project_type: null };

describe('computeCardUpdates — empty fields fill', () => {
  it('fills an empty field, tagged with the sheet', () => {
    const plan = computeCardUpdates(baseBid, profile({ sq_ft: ev(7381, 'C1.1', 'BLDG. AREA = 7,381 SQ. FT.') }));
    expect(plan.fills).toEqual([
      { field: 'sq_ft', value: 7381, sheet: 'C1.1', quote: 'BLDG. AREA = 7,381 SQ. FT.', reasonTag: 'from plans (sheet C1.1)' },
    ]);
    expect(plan.suggestions).toEqual([]);
  });

  it('fills store_number, brand, and project_type independently', () => {
    const plan = computeCardUpdates(baseBid, profile({
      brand: ev('AutoZone'), store_number: ev('10077'), project_type: ev('retail'),
    }));
    expect(plan.fills.map(f => f.field).sort()).toEqual(['brand', 'project_type', 'store_number']);
  });
});

describe('computeCardUpdates — conflicts become suggestions, never silent overwrites', () => {
  it('a differing filled field is a suggestion, not a fill', () => {
    const bid: CurrentBidFields = { ...baseBid, sq_ft: 7000 };
    const plan = computeCardUpdates(bid, profile({ sq_ft: ev(7381, 'C1.1', 'BLDG. AREA = 7,381 SQ. FT.') }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toEqual([
      {
        field: 'sq_ft', currentValue: 7000, suggestedValue: 7381, sheet: 'C1.1', quote: 'BLDG. AREA = 7,381 SQ. FT.',
        message: 'Plans say 7,381 SF — card says 7,000. Update?',
      },
    ]);
  });

  it('an already-agreeing field is neither a fill nor a suggestion', () => {
    const bid: CurrentBidFields = { ...baseBid, sq_ft: 7381 };
    const plan = computeCardUpdates(bid, profile({ sq_ft: ev(7381) }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toEqual([]);
  });

  it('a string field compares case/whitespace-insensitively before flagging a conflict', () => {
    const bid: CurrentBidFields = { ...baseBid, brand: '  autozone ' };
    const plan = computeCardUpdates(bid, profile({ brand: ev('AutoZone') }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toEqual([]);
  });
});

describe('computeCardUpdates — gc is never touched, name is always suggestion-only', () => {
  it('a gc field on the profile (defensive — jobProfile.ts never actually emits one) is never filled or suggested', () => {
    const fields = { gc: ev('Some GC') } as unknown as JobProfile['fields'];
    const plan = computeCardUpdates({ ...baseBid, gc: null } as CurrentBidFields & { gc: null }, profile(fields));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toEqual([]);
  });

  it('name is a suggestion even though the card name is non-empty', () => {
    const plan = computeCardUpdates(baseBid, profile({ name: ev('AutoZone #10077 – Kissimmee, FL', null, null) }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toEqual([
      {
        field: 'name', currentValue: 'Some Job', suggestedValue: 'AutoZone #10077 – Kissimmee, FL', sheet: null, quote: null,
        message: 'Plans suggest naming this bid "AutoZone #10077 – Kissimmee, FL". Rename?',
      },
    ]);
  });

  it('name is STILL only a suggestion even when the card name is blank — never auto-filled', () => {
    const blankNameBid: CurrentBidFields = { ...baseBid, name: '' };
    const plan = computeCardUpdates(blankNameBid, profile({ name: ev('AutoZone #10077 – Kissimmee, FL', null, null) }));
    expect(plan.fills).toEqual([]);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].field).toBe('name');
  });

  it('no suggestion when the suggested name already matches the card name', () => {
    const plan = computeCardUpdates({ ...baseBid, name: 'AutoZone #10077 – Kissimmee, FL' },
      profile({ name: ev('AutoZone #10077 – Kissimmee, FL', null, null) }));
    expect(plan.suggestions).toEqual([]);
  });
});

describe('computeCardUpdates — a full Kissimmee-shaped profile', () => {
  it('produces the expected mix of fills, suggestions, and no-ops', () => {
    const bid: CurrentBidFields = {
      name: 'Kissimmee Store', loc: null, sq_ft: 7000, project_type: null, brand: null,
      store_number: '10077', prototype: null, plan_date: null, owner_name: null, architect: null, engineer: null, build_type: null,
    };
    const plan = computeCardUpdates(bid, profile({
      brand: ev('AutoZone', 'Cover'),
      project_type: ev('retail', 'Cover'),
      store_number: ev('10077', 'Cover', 'AutoZone Store No. FL10077'),
      sq_ft: ev(7381, 'C1.1', 'BLDG. AREA = 7,381 SQ. FT.'),
      engineer: ev('DANNY E. DOSS P.E.', 'E-1'),
      name: ev('AutoZone #10077 – Kissimmee, FL', null, null),
    }));

    expect(plan.fills.map(f => f.field).sort()).toEqual(['brand', 'engineer', 'project_type']);
    expect(plan.suggestions.map(s => s.field).sort()).toEqual(['name', 'sq_ft']);
    // store_number matches already (both "10077") — neither a fill nor a suggestion.
    expect(plan.fills.some(f => f.field === 'store_number')).toBe(false);
    expect(plan.suggestions.some(s => s.field === 'store_number')).toBe(false);
  });
});
