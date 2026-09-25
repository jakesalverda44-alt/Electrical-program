import { describe, it, expect } from 'vitest';
import { extractJobProfile, estimateJobProfileCost, PageText } from './jobProfile';

// Real text, read verbatim with `pdftotext -f N -l N` (read-only) from
// "Bids/Summit GC/Autozone Kissimmee, FL/Plans/1.0 - AZ #10077 - Kissimmee, FL
// FULL SET.pdf" (2026-09-24). Lines are kept in the PDF's own internal text
// order (not visual reading order) — the same order a real extraction would
// see — with unrelated lines cut out but nothing reworded. Small excerpts
// only, never the PDF itself.
const COVER_PAGE_1: PageText = {
  page: 1, file: 'AZ #10077 - Kissimmee, FL FULL SET.pdf', sheetNo: 'Cover',
  text: [
    'PHONE: (850) 638-0790',
    'ATTN: THOMAS K. MEAD, PSM',
    '',
    'ARCHITECT',
    'AUTOZONE, INC.',
    '123 S. FRONT STREET',
    'MEMPHIS, TENNESSEE 38103',
    'PHONE: (901) 495-8707',
    'ATTN.: GEORGE CALLOW, AIA',
    '',
    'COVER SHEET',
    '',
    'PHOTOMETRIC PLAN',
    '',
    'LANDSCAPE',
    'ARCHITECT',
    'CPH, INC.',
    '500 WEST FULTON STREET',
    'SANFORD, FLORIDA 32771',
    'PHONE: (407) 322-6841',
    'ATTN.: DANITA BRYANT',
    '',
    '2860 N OLD LAKE WILSON RD.',
    'KISSIMMEE, FLORIDA 34747',
    '',
    'OSCEOLA COUNTY',
    'INDEX OF SHEETS',
    'AutoZone Store No. FL10077',
    'ELECTRIC',
    '',
    'Owner / Developer: AUTOZONE STORES LLC',
    '123 South Front Street, 3rd Floor',
    'Memphis, Tennessee 38103',
    'TEL: 901-495-8709',
    '',
    '2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747',
    'SECTION 11 - TOWNSHIP 25 SOUTH - RANGE 27 EAST',
    '',
    '7N2',
    'C0.1',
  ].join('\n'),
};

// Sheet C1.1 — the building-area callout repeats on every civil sheet.
const CIVIL_C1_1: PageText = {
  page: 8, file: 'AZ #10077 - Kissimmee, FL FULL SET.pdf', sheetNo: 'C1.1',
  text: [
    'CONSTRUCTION ENTRANCE PER STATE',
    'CONTROL MANUAL (LATEST EDITION)',
    'BLDG. AREA = 7,381 SQ. FT.',
    'COMPACTED BACKFILL',
    '7N2',
    'C1.1',
  ].join('\n'),
};

// General notes sheet — "UNSPRINKLERED" (no fire sprinkler/alarm system).
const CIVIL_GENERAL_NOTES: PageText = {
  page: 10, file: 'AZ #10077 - Kissimmee, FL FULL SET.pdf', sheetNo: 'C0.3',
  text: ['ALL FIRE PROTECTION SPRINKLER SYSTEMS INSTALLED SHALL COMPLY WITH NFPA 13', 'UNSPRINKLERED'].join('\n'),
};

// E-1 — the electrical power plan's own title block (real text, page 49).
const E1_POWER_PLAN: PageText = {
  page: 49, file: 'AZ #10077 - Kissimmee, FL FULL SET.pdf', sheetNo: 'E-1',
  text: [
    '09/22/2025',
    '7N2-L',
    'E-1',
    '34747',
    'POWER PLAN / GENERAL NOTES',
    'ENGINEER: DANNY E. DOSS P.E.',
    'AutoZone Store No. 10077',
    '132 Kelley Drive',
    '2860 N OLD LAKE WILSON RD.',
    'Rogers, Arkansas 72756',
    'TEL: (479) 631-1712 FAX: (479) 631-1854',
    'For Bidding & Contractor Information Contact:',
    'KISSIMMEE',
    'FL',
    'Dodge Data & Analytics. Tel. 1-844-326-3826 ext 9429',
    'Cindy.searcy@construction.com',
  ].join('\n'),
};

const KISSIMMEE_SET = [COVER_PAGE_1, CIVIL_C1_1, CIVIL_GENERAL_NOTES, E1_POWER_PLAN];

describe('extractJobProfile — Kissimmee (real plan text)', () => {
  const profile = extractJobProfile(KISSIMMEE_SET);

  it('brand + project type', () => {
    expect(profile.fields.brand?.value).toBe('AutoZone');
    expect(profile.fields.brand?.sheet).toBe('Cover');
    expect(profile.fields.project_type?.value).toBe('retail');
  });

  it('store number — normalized to digits, evidence keeps the raw "FL10077" quote', () => {
    expect(profile.fields.store_number?.value).toBe('10077');
    expect(profile.fields.store_number?.quote).toContain('FL10077');
  });

  it('prototype — "7N2-L" (the more specific variant) from the E-1 title block', () => {
    expect(profile.fields.prototype?.value).toBe('7N2-L');
    expect(profile.fields.prototype?.sheet).toBe('E-1');
  });

  it('site address — title-cased from the combined address/city/state line', () => {
    expect(profile.fields.loc?.value).toBe('2860 N Old Lake Wilson Rd, Kissimmee, FL 34747');
  });

  it('building SF', () => {
    expect(profile.fields.sq_ft?.value).toBe(7381);
    expect(profile.fields.sq_ft?.quote).toContain('7,381');
  });

  it('plan date — the electrical sheet\'s own date (E-1), normalized to ISO', () => {
    expect(profile.fields.plan_date?.value).toBe('2025-09-22');
    expect(profile.fields.plan_date?.sheet).toBe('E-1');
  });

  it('owner', () => {
    expect(profile.fields.owner_name?.value).toBe('AUTOZONE STORES LLC');
  });

  it('architect — the main block, not the landscape-architect block', () => {
    expect(profile.fields.architect?.value).toBe('AUTOZONE, INC.');
  });

  it('engineer — the electrical sheet\'s "ENGINEER:" line, not the civil consultant', () => {
    expect(profile.fields.engineer?.value).toBe('DANNY E. DOSS P.E.');
    expect(profile.fields.engineer?.sheet).toBe('E-1');
  });

  it('build type defaults to new (no remodel/tenant language anywhere in the set)', () => {
    expect(profile.fields.build_type?.value).toBe('new');
    expect(profile.fields.build_type?.confidence).toBe('inferred');
  });

  it('notable systems — unsprinklered/no FA, photometric present, no fuel/generator/EV', () => {
    expect(profile.systems.site_lighting.value).toBe(true);
    expect(profile.systems.fire_alarm.value).toBe(false);
    expect(profile.systems.fuel.value).toBe(false);
    expect(profile.systems.generator.value).toBe(false);
    expect(profile.systems.ev.value).toBe(false);
  });

  it('suggested bid name', () => {
    expect(profile.fields.name?.value).toBe('AutoZone #10077 – Kissimmee, FL');
    expect(profile.fields.name?.confidence).toBe('inferred');
  });

  it('every extracted field carries a real quote (never invented text)', () => {
    for (const [key, ev] of Object.entries(profile.fields)) {
      if (ev.confidence === 'extracted') {
        expect(ev.quote, `${key} should carry a quote`).toBeTruthy();
      }
    }
  });
});

describe('extractJobProfile — edge cases', () => {
  it('an empty plan set yields no fields, never throws', () => {
    const profile = extractJobProfile([]);
    expect(profile.fields).toEqual({ build_type: expect.objectContaining({ value: 'new' }) });
    expect(profile.systems.fuel.value).toBe(false);
  });

  it('does not mistake a sheet id (E-1, M-1.1) for a prototype code', () => {
    const pages: PageText[] = [{ page: 1, file: 'x.pdf', text: 'E-1\nM-1.1\nP-1\n' }];
    expect(extractJobProfile(pages).fields.prototype).toBeUndefined();
  });

  it('detects remodel/tenant-fit-out language over the "new" default', () => {
    const remodel = extractJobProfile([{ page: 1, file: 'x.pdf', text: 'STORE REMODEL PLANS\n' }]);
    expect(remodel.fields.build_type?.value).toBe('remodel');
    const tenant = extractJobProfile([{ page: 1, file: 'x.pdf', text: 'TENANT FIT-OUT DRAWINGS\n' }]);
    expect(tenant.fields.build_type?.value).toBe('tenant');
  });

  it('a free-text brand (no known chain) still gets a project-type keyword fallback', () => {
    const pages: PageText[] = [{ page: 1, file: 'x.pdf', text: 'ACME WAREHOUSE EXPANSION\n' }];
    const profile = extractJobProfile(pages);
    expect(profile.fields.brand).toBeUndefined();
    expect(profile.fields.project_type?.value).toBe('warehouse');
  });
});

describe('estimateJobProfileCost', () => {
  it('is free when the profile came entirely from a text layer', () => {
    expect(estimateJobProfileCost(0)).toBe(0);
  });

  it('charges a small, conservative amount per vision crop', () => {
    expect(estimateJobProfileCost(1)).toBe(2);
    expect(estimateJobProfileCost(3)).toBe(6);
  });
});
