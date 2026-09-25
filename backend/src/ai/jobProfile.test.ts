// Job profile fix round (review 1755e62) — the extraction engine.
//
//   * The REAL Kissimmee set: the fixture is the unmodified output of the
//     production text path (extractPdfPageTexts) for all 55 pages; the
//     production page selection and title-block cut run on it; the model's
//     reply is mocked (realistic, grounded in that text) and the production
//     validators decide what survives. When the real PDF is readable on this
//     machine, the fixture is also re-derived from it live.
//   * A negative test for every B4 / B5 case in the review, and the rest of
//     the review's real-set failures (landscape architect, "ING DRAWINGS",
//     "AD UST"), each through the same validators.
import fs from 'fs';
import { describe, it, expect } from 'vitest';
import {
  selectProfilePages, prepareProfileInput, assembleJobProfile, currentSetPages, titleBlockText, parseModelReply,
  buildUserContent, jobProfileCostCents, revisionOf,
  type InventoryPage, type ModelReply, type ProfileSource, type JobProfile,
} from './jobProfile';
import { BUILTIN_BRANDS, mergeBrands, stateCode, datesIn, isGrounded } from './jobProfileValidators';
import { extractPdfPageTexts } from './pdfText';
import {
  loadKissimmeePages, kissimmeeInventory, KISSIMMEE_MODEL_REPLY, KISSIMMEE_PDF_PATH,
} from '../test/fixtures/kissimmeeJobProfile';

const brands = BUILTIN_BRANDS;
const none = { value: '', sheet: '', quote: '', confidence: 'none' as const };

function reply(partial: Partial<ModelReply>): ModelReply {
  return {
    brand: none, project_name: none, project_type: none, store_number: none, prototype: none,
    site_address: { street: '', city: '', state: '', zip: '', sheet: '', quote: '', confidence: 'none' },
    building_sf: { ...none, label: '' }, plan_date: { ...none, kind: '' }, owner: none, architect: none, engineer: none,
    build_type: none, other_brands: [], systems: {}, ...partial,
  };
}

function profileOf(sources: ProfileSource[], r: ModelReply): JobProfile {
  return assembleJobProfile({ reply: r, sources, brands, usedVision: false, pagesUsed: [], noText: false });
}

const src = (sheet: string, why: ProfileSource['why'], text: string): ProfileSource => ({ sheet, why, text, file: 'set.pdf', page: 1 });

// ── The real Kissimmee set ─────────────────────────────────────────────────

describe('real Kissimmee (AutoZone #10077) — production selection + validators', () => {
  const fx = loadKissimmeePages();
  const inv = kissimmeeInventory({ sha: 'kissimmee', texts: fx.pages });
  const textOf = (p: InventoryPage) => fx.pages[p.page - 1] ?? '';
  const selected = selectProfilePages(inv, textOf);
  const prepared = prepareProfileInput(selected, textOf);

  it('the fixture is the full 55-page production text', () => {
    expect(fx.pageCount).toBe(55);
    expect(fx.pages).toHaveLength(55);
    expect(fx.extractedWith).toMatch(/extractPdfPageTexts/);
  });

  it('reads ONLY the covers, the code / area sheets and the electrical title blocks', () => {
    const by = (why: string) => selected.filter(p => p.why === why).map(p => p.sheetNo);
    expect(by('cover')).toEqual(['C0.1', 'A-0']);
    expect(by('code_area')).toEqual(['A-1.1', 'C2.1']);
    expect(by('electrical')).toEqual(['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'PH0.1']);
    // Never the civil general notes (the "ENGINEERING DRAWINGS" page) or the
    // architectural page with "AD UST" — the review's real failures.
    expect(selected.map(p => p.sheetNo)).not.toContain('C0.2');
    expect(selected.map(p => p.sheetNo)).not.toContain('A-1.2');
    expect(prepared.noText).toBe(false);
    expect(prepared.needsImage).toHaveLength(0);
  });

  it('cuts a busy electrical page down to its title block', () => {
    const ph = prepared.sources.find(s => s.sheet === 'PH0.1')!;
    expect(fx.pages[18].length).toBeGreaterThan(50_000);
    expect(ph.text.length).toBeLessThan(15_000);
    expect(ph.text).toMatch(/PHOTOMETRIC PLAN/);
    expect(ph.text).toMatch(/AutoZone Store No\. FL10077/);
    const e1 = prepared.sources.find(s => s.sheet === 'E-1')!;
    expect(e1.text).toBe(fx.pages[48]); // a ~600-char page IS its title block
  });

  it('keeps the prompt small (a few thousand tokens)', () => {
    const chars = prepared.promptPages.reduce((n, p) => n + p.text.length, 0);
    expect(chars).toBeLessThan(25_000);
    const content = buildUserContent(prepared.promptPages);
    expect(content.filter(b => b.type === 'image')).toHaveLength(0);
  });

  it('every quote in the mocked model reply is really on the sheet it cites', () => {
    const r = KISSIMMEE_MODEL_REPLY;
    const onSheet = (sheet: string, quote: string) => isGrounded(quote, prepared.sources.find(s => s.sheet === sheet)!.text);
    for (const k of ['brand', 'store_number', 'prototype', 'building_sf', 'plan_date', 'owner', 'architect', 'engineer'] as const) {
      const f = r[k]!;
      expect(onSheet(f.sheet, f.quote), `${k}: "${f.quote}" on ${f.sheet}`).toBe(true);
    }
    expect(onSheet(r.site_address!.sheet, r.site_address!.quote)).toBe(true);
    // ...and in the compacted text the model is shown.
    const shown = (sheet: string) => prepared.promptPages.find(p => p.sheet === sheet)!.text;
    expect(shown('C2.1')).toContain('BUILDING AREA: | 7,381 S.F.');
    expect(shown('C0.1')).toContain('2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747');
  });

  it('produces the right profile — fills only what is validated and high confidence', () => {
    const profile = assembleJobProfile({ reply: KISSIMMEE_MODEL_REPLY, sources: prepared.sources, brands, usedVision: false, pagesUsed: prepared.pagesUsed, noText: false });
    const f = profile.fields;
    expect(profile.status).toBe('complete');
    expect(f.brand).toMatchObject({ value: 'AutoZone', confidence: 'high', validated: true, sheet: 'C0.1' });
    expect(f.project_type).toMatchObject({ value: 'retail', validated: true });
    expect(f.store_number).toMatchObject({ value: '10077', confidence: 'high', validated: true, sheet: 'E-1' });
    expect(f.prototype).toMatchObject({ value: '7N2-L', confidence: 'medium', validated: true });
    expect(f.loc).toMatchObject({ value: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', confidence: 'high', validated: true });
    expect(f.sq_ft).toMatchObject({ value: 7381, label: 'building', confidence: 'high', validated: true, sheet: 'C2.1' });
    expect(f.plan_date).toMatchObject({ value: '2025-09-22', confidence: 'high', validated: true, sheet: 'E-1' });
    expect(f.owner_name).toMatchObject({ value: 'AUTOZONE STORES LLC', confidence: 'high', validated: true });
    expect(f.architect).toMatchObject({ value: 'AUTOZONE, INC.', confidence: 'medium' });
    expect(f.engineer).toMatchObject({ value: 'DANNY E. DOSS P.E.', confidence: 'high', validated: true });
    expect(f.build_type).toBeUndefined(); // no explicit evidence -> unknown, never a default
    expect(f.name).toMatchObject({ value: 'AutoZone #10077 – Kissimmee, FL', validated: false });
    expect(profile.systems.site_lighting).toMatchObject({ value: true, sheet: 'E-7' });
    expect(profile.systems.fuel.value).toBeNull();
    expect(profile.systems.fire_alarm.value).toBeNull();
    expect(profile.rejected).toEqual([]);
  });

  it('rejects the landscape architect and the civil engineer, and never takes the civil bid-set date', () => {
    const bad = reply({
      architect: { value: 'CPH, INC.', sheet: 'C0.1', quote: 'CPH, INC.', confidence: 'high' },
      engineer: { value: "MATHEW S. D'ANGELO", sheet: 'PH0.1', quote: "MATHEW S. D'ANGELO", confidence: 'high' },
      plan_date: { value: '2025-12-03', kind: 'issue', sheet: 'PH0.1', quote: '12/3/2025', confidence: 'high' },
    });
    const p = profileOf(prepared.sources, bad);
    expect(p.fields.architect).toBeUndefined();
    expect(p.rejected.find(r => r.field === 'architect')?.reason).toMatch(/landscape|civil/i);
    // A P.E. on one of eight electrical title blocks: a suggestion at most.
    expect(p.fields.engineer?.validated).toBe(false);
    // The E-sheets agree on 09/22/2025: the civil date is flagged, not filled.
    expect(p.fields.plan_date).toMatchObject({ value: '2025-12-03', confidence: 'low', validated: false });
    expect(p.fields.plan_date?.notes?.join(' ')).toMatch(/2025-09-22/);
  });

  it('rejects the owner-office address (Memphis) and the engineer-office address (Rogers, AR)', () => {
    const memphis = reply({ site_address: { street: '123 S. FRONT STREET', city: 'MEMPHIS', state: 'TENNESSEE', zip: '38103', sheet: 'C0.1', quote: '123 S. FRONT STREET', confidence: 'high' } });
    expect(profileOf(prepared.sources, memphis).fields.loc).toBeUndefined();
    const rogers = reply({ site_address: { street: '132 Kelley Drive', city: 'Rogers', state: 'Arkansas', zip: '72756', sheet: 'E-1', quote: '132 Kelley Drive', confidence: 'high' } });
    const p = profileOf(prepared.sources, rogers);
    expect(p.fields.loc).toBeUndefined();
    expect(p.rejected[0].reason).toMatch(/office|city, state/);
  });

  it('matches the live production text path when the real PDF is on this machine', async () => {
    let buf: Buffer | null = null;
    try { buf = fs.readFileSync(KISSIMMEE_PDF_PATH); } catch { /* not on this machine / OneDrive placeholder */ }
    if (!buf || buf.length < 1_000_000) return;
    const live = await extractPdfPageTexts(buf);
    expect(live).toEqual(fx.pages);
  }, 180_000);
});

// ── Review B4: brand ───────────────────────────────────────────────────────

describe('brand (review B4)', () => {
  const cover711 = src('T-1', 'cover', [
    '7-ELEVEN STORE #41234                    PROJECT: NEW CONVENIENCE STORE',
    '4410 GULF BLVD, TAMPA, FL 33606',
    'NOTE: ADJACENT AUTOZONE PARCEL BY OTHERS',
  ].join('\n'));

  it('an adjacent-brand note is never the brand', () => {
    const p = profileOf([cover711], reply({ brand: { value: 'AutoZone', sheet: 'T-1', quote: 'NOTE: ADJACENT AUTOZONE PARCEL BY OTHERS', confidence: 'high' } }));
    expect(p.fields.brand).toBeUndefined();
    expect(p.fields.project_type).toBeUndefined();
  });

  it('the real brand stays a fill even when the note names another brand', () => {
    const p = profileOf([cover711], reply({
      brand: { value: '7-Eleven', sheet: 'T-1', quote: '7-ELEVEN STORE #41234', confidence: 'high' },
      other_brands: [{ value: 'AutoZone', sheet: 'T-1', quote: 'NOTE: ADJACENT AUTOZONE PARCEL BY OTHERS' }],
    }));
    expect(p.fields.brand).toMatchObject({ value: '7-Eleven', confidence: 'high', validated: true });
    expect(p.fields.project_type?.value).toBe('cstore_fuel');
  });

  it('a person named Murrell is never the Murrell brand', () => {
    const e1 = src('E-1', 'electrical', 'ELECTRICAL ENGINEER: JOHN MURRELL P.E.        DUNKIN #3321\nE-1');
    const p = profileOf([e1], reply({ brand: { value: 'Murrell', sheet: 'E-1', quote: 'ELECTRICAL ENGINEER: JOHN MURRELL P.E.', confidence: 'high' } }));
    expect(p.fields.brand).toBeUndefined();
    expect(p.fields.project_type).toBeUndefined();
    expect(p.rejected[0].reason).toMatch(/person|consultant/);
  });

  it("TOMMY'S TIRE (adjacent) is never Tommy's", () => {
    const c = src('C-1', 'cover', "BIG DAN'S CAR WASH - SEBASTIAN\nTOMMY'S TIRE & LUBE (ADJACENT)");
    const p = profileOf([c], reply({ brand: { value: "Tommy's", sheet: 'C-1', quote: "TOMMY'S TIRE & LUBE (ADJACENT)", confidence: 'high' } }));
    expect(p.fields.brand).toBeUndefined();
    // Round 2 (R2-S5): an unlabeled title line is only a suggestion; the
    // project line ("PROJECT:") fills.
    const unlabeled = profileOf([c], reply({ brand: { value: "Big Dan's", sheet: 'C-1', quote: "BIG DAN'S CAR WASH - SEBASTIAN", confidence: 'high' } }));
    expect(unlabeled.fields.brand).toMatchObject({ value: "Big Dan's", validated: false });
    const labeled = src('C-1', 'cover', "PROJECT: BIG DAN'S CAR WASH - SEBASTIAN\nTOMMY'S TIRE & LUBE (ADJACENT)");
    const ok = profileOf([labeled], reply({ brand: { value: "Big Dan's", sheet: 'C-1', quote: "PROJECT: BIG DAN'S CAR WASH - SEBASTIAN", confidence: 'high' } }));
    expect(ok.fields.brand).toMatchObject({ value: "Big Dan's", validated: true });
    expect(ok.fields.project_type?.value).toBe('car_wash');
  });

  it('never reads a brand from notes (a code / area excerpt)', () => {
    const notes = src('C0.2', 'code_area', 'GENERAL NOTES: MATCH AUTOZONE STANDARD DETAILS');
    const p = profileOf([notes], reply({ brand: { value: 'AutoZone', sheet: 'C0.2', quote: 'MATCH AUTOZONE STANDARD DETAILS', confidence: 'high' } }));
    expect(p.fields.brand).toBeUndefined();
  });

  it('matches the account-rule aliases: 7-11 and 7 Eleven are 7-Eleven', () => {
    for (const printed of ['7-11 #41234 TAMPA', '7 ELEVEN STORE NO. 41234']) {
      const c = src('T-1', 'cover', printed);
      const name = printed.startsWith('7-11') ? '7-11' : '7 Eleven';
      const p = profileOf([c], reply({ brand: { value: name, sheet: 'T-1', quote: printed, confidence: 'high' } }));
      expect(p.fields.brand?.value).toBe('7-Eleven');
    }
    const merged = mergeBrands([{ name: 'Dunkin', matchAliases: ["Dunkin'", 'Dunkin Donuts'], projectTypes: ['restaurant'] }]);
    const c = src('T-1', 'cover', "DUNKIN' STORE #3321 - LAKELAND");
    const p = assembleJobProfile({ reply: reply({ brand: { value: "Dunkin'", sheet: 'T-1', quote: "DUNKIN' STORE #3321 - LAKELAND", confidence: 'high' } }), sources: [c], brands: merged, usedVision: false, pagesUsed: [], noText: false });
    expect(p.fields.brand).toMatchObject({ value: 'Dunkin', validated: true });
    expect(p.fields.project_type?.value).toBe('restaurant');
  });

  it('two brands in the project block: a suggestion, never a fill', () => {
    const c = src('T-1', 'cover', 'AUTOZONE / 7-ELEVEN SHARED SITE\nAUTOZONE STORE #10077        7-ELEVEN STORE #41234');
    const p = profileOf([c], reply({ brand: { value: 'AutoZone', sheet: 'T-1', quote: 'AUTOZONE STORE #10077', confidence: 'high' } }));
    expect(p.fields.brand).toMatchObject({ value: 'AutoZone', confidence: 'low', validated: false });
  });
});

// ── Review B5 ──────────────────────────────────────────────────────────────

describe('store number (review B5)', () => {
  it('a phone number is never a store number', () => {
    for (const quote of ['CONTACT STORE 813-555-1212', 'STORE # 813-555-1212', 'STORE NO. (813) 555-1212']) {
      const s = src('T-1', 'cover', quote);
      const p = profileOf([s], reply({ store_number: { value: '813', sheet: 'T-1', quote, confidence: 'high' } }));
      expect(p.fields.store_number, quote).toBeUndefined();
    }
  });
  it('a room tag is never a store number', () => {
    const s = src('E-1', 'electrical', 'STORE 104      OFFICE 105\nE-1');
    const p = profileOf([s], reply({ store_number: { value: '104', sheet: 'E-1', quote: 'STORE 104', confidence: 'high' } }));
    expect(p.fields.store_number).toBeUndefined();
  });
  it('"STORE #/NO/NUMBER" wording passes', () => {
    for (const quote of ['AutoZone Store No. FL10077', 'STORE #41234', 'STORE NUMBER: 3321']) {
      const s = src('T-1', 'cover', quote);
      const digits = quote.replace(/\D/g, '');
      expect(profileOf([s], reply({ store_number: { value: digits, sheet: 'T-1', quote, confidence: 'high' } })).fields.store_number?.value, quote).toBe(digits);
    }
  });
});

describe('site address (review B5)', () => {
  it("an engineer's office address is never the site", () => {
    const e1 = src('E-1', 'electrical', [
      'ENGINEER: DANNY E. DOSS P.E.',
      '132 Kelley Drive',
      'Rogers, AR 72756',
      'TEL: (479) 631-1712',
    ].join('\n'));
    const p = profileOf([e1], reply({ site_address: { street: '132 Kelley Drive', city: 'Rogers', state: 'AR', zip: '72756', sheet: 'E-1', quote: '132 Kelley Drive', confidence: 'high' } }));
    expect(p.fields.loc).toBeUndefined();
  });
  it('"Memphis, TE" — a state must be a real 2-letter code', () => {
    const c = src('T-1', 'cover', '123 S. Front Street, Memphis, Tennessee 38103');
    const p = profileOf([c], reply({ site_address: { street: '123 S. Front Street', city: 'Memphis', state: 'TE', zip: '38103', sheet: 'T-1', quote: '123 S. Front Street, Memphis, Tennessee 38103', confidence: 'high' } }));
    expect(p.fields.loc).toBeUndefined();
    expect(stateCode('TE')).toBeNull();
    expect(stateCode('Tennessee')).toBe('TN');
    expect(stateCode('FL')).toBe('FL');
  });
  it('a title-block address under the project (STORE) line passes; the same street with no label is a suggestion', () => {
    const e1 = src('E-1', 'electrical', 'AutoZone Store No. 10077\n2860 N OLD LAKE WILSON RD.\nKISSIMMEE   FL   34747');
    const quote = '2860 N OLD LAKE WILSON RD.\nKISSIMMEE   FL   34747';
    const p = profileOf([e1], reply({ site_address: { street: '2860 N OLD LAKE WILSON RD.', city: 'KISSIMMEE', state: 'FL', zip: '34747', sheet: 'E-1', quote, confidence: 'high' } }));
    expect(p.fields.loc).toMatchObject({ value: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', confidence: 'high', validated: true });
    const bare = src('E-1', 'electrical', 'GENERAL NOTES\n2860 N OLD LAKE WILSON RD.\nKISSIMMEE   FL   34747');
    const p2 = profileOf([bare], reply({ site_address: { street: '2860 N OLD LAKE WILSON RD.', city: 'KISSIMMEE', state: 'FL', zip: '34747', sheet: 'E-1', quote, confidence: 'high' } }));
    expect(p2.fields.loc).toMatchObject({ confidence: 'medium', validated: false });
  });
});

describe('building SF (review B5)', () => {
  const site = src('C2.1', 'code_area', 'SITE DATA:\nGROSS SITE AREA: 52,272 SF\nBLDG. AREA = 7,381 SQ. FT.\n1 SPACE PER 300 SF OF GROSS FLOOR AREA');
  it('a site area is never the building SF', () => {
    const p = profileOf([site], reply({ building_sf: { value: '52272', label: 'building', sheet: 'C2.1', quote: 'GROSS SITE AREA: 52,272 SF', confidence: 'high' } }));
    expect(p.fields.sq_ft).toBeUndefined();
    const labeled = profileOf([site], reply({ building_sf: { value: '52272', label: 'site', sheet: 'C2.1', quote: 'GROSS SITE AREA: 52,272 SF', confidence: 'high' } }));
    expect(labeled.fields.sq_ft).toBeUndefined();
  });
  it('a parking ratio is never the building SF', () => {
    const p = profileOf([site], reply({ building_sf: { value: '300', label: 'floor', sheet: 'C2.1', quote: '1 SPACE PER 300 SF OF GROSS FLOOR AREA', confidence: 'high' } }));
    expect(p.fields.sq_ft).toBeUndefined();
  });
  it('a labeled building area passes', () => {
    const p = profileOf([site], reply({ building_sf: { value: '7381', label: 'building', sheet: 'C2.1', quote: 'BLDG. AREA = 7,381 SQ. FT.', confidence: 'high' } }));
    expect(p.fields.sq_ft).toMatchObject({ value: 7381, validated: true });
  });
});

describe('prototype (review B5)', () => {
  const e = (sheet: string) => src(sheet, 'electrical', `PANEL 1L1        7N2-L\n1L1\n${sheet}   AutoZone Store No. 10077`);
  const covers = [src('A-0', 'cover', 'AutoZone Store No. 10077\n7N2-L'), e('E-1'), e('E-2')];
  const brand = { value: 'AutoZone', sheet: 'A-0', quote: 'AutoZone Store No. 10077', confidence: 'high' as const };
  it('a panel name is never the prototype', () => {
    const p = profileOf(covers, reply({ brand, prototype: { value: '1L1', sheet: 'E-1', quote: '1L1', confidence: 'high' } }));
    expect(p.fields.prototype).toBeUndefined();
    const p2 = profileOf(covers, reply({ brand, prototype: { value: '1L1', sheet: 'E-1', quote: 'PANEL 1L1', confidence: 'high' } }));
    expect(p2.fields.prototype).toBeUndefined();
  });
  it('a labeled prototype, or the brand code repeated across title blocks, passes', () => {
    expect(profileOf(covers, reply({ brand, prototype: { value: '7N2-L', sheet: 'A-0', quote: '7N2-L', confidence: 'high' } })).fields.prototype)
      .toMatchObject({ value: '7N2-L', validated: true });
    const labeled = src('T-1', 'cover', 'PROTOTYPE: 2024 SMALL FORMAT');
    expect(profileOf([labeled], reply({ prototype: { value: '2024 SMALL FORMAT', sheet: 'T-1', quote: 'PROTOTYPE: 2024 SMALL FORMAT', confidence: 'high' } })).fields.prototype?.validated).toBe(true);
    // No label, no known brand pattern: never.
    const bare = src('T-1', 'cover', 'SERIES 4B2');
    expect(profileOf([bare], reply({ prototype: { value: '4B2', sheet: 'T-1', quote: 'SERIES 4B2', confidence: 'high' } })).fields.prototype).toBeUndefined();
  });
});

describe('plan date (review B5)', () => {
  const tb = (sheet: string) => src(sheet, 'electrical', `ISSUED FOR BID   09/22/2025\nREV 1   03/01/2026   ADDENDUM 1\n${sheet}`);
  const sources = [tb('E-1'), tb('E-2'), tb('E-3')];
  it('a revision date is never the plan date (R2-S4: rejected, not suggested)', () => {
    const p = profileOf(sources, reply({ plan_date: { value: '2026-03-01', kind: 'revision', sheet: 'E-1', quote: 'REV 1   03/01/2026', confidence: 'high' } }));
    expect(p.fields.plan_date).toBeUndefined();
    const mislabeled = profileOf(sources, reply({ plan_date: { value: '2026-03-01', kind: 'issue', sheet: 'E-1', quote: '03/01/2026', confidence: 'high' } }));
    expect(mislabeled.fields.plan_date).toBeUndefined();
    expect(mislabeled.rejected[0].reason).toMatch(/revision/);
  });
  it('a revision-table row with its label on the RIGHT (or only a header above) is never the plan date (R2-S4)', () => {
    const tb = (sheet: string) => src(sheet, 'electrical', [
      'REV   DATE         DESCRIPTION',
      '1     10/15/2025   ADDENDUM 1',
      '2     11/02/2025   OWNER COMMENTS',
      'ISSUE DATE: 09/22/2025',
      sheet,
    ].join('\n'));
    const s3 = [tb('E-1'), tb('E-2')];
    for (const [value, quote] of [['2025-10-15', '10/15/2025'], ['2025-11-02', '11/02/2025']]) {
      const p = profileOf(s3, reply({ plan_date: { value, kind: 'issue', sheet: 'E-1', quote, confidence: 'high' } }));
      expect(p.fields.plan_date, value).toBeUndefined();
    }
    const ok = profileOf(s3, reply({ plan_date: { value: '2025-09-22', kind: 'issue', sheet: 'E-1', quote: 'ISSUE DATE: 09/22/2025', confidence: 'high' } }));
    expect(ok.fields.plan_date).toMatchObject({ value: '2025-09-22', validated: true });
  });
  it('the issue date passes', () => {
    const p = profileOf(sources, reply({ plan_date: { value: '2025-09-22', kind: 'issue', sheet: 'E-1', quote: 'ISSUED FOR BID   09/22/2025', confidence: 'high' } }));
    expect(p.fields.plan_date).toMatchObject({ value: '2025-09-22', validated: true, confidence: 'high' });
  });
  it('reads the date formats title blocks use', () => {
    expect(datesIn('09/22/2025 · 9/22/25 · SEPT 22, 2025 · 9-22-2025')).toEqual(['2025-09-22', '2025-09-22', '2025-09-22', '2025-09-22']);
    expect(datesIn('9/16')).toEqual([]);
  });
});

describe('engineer / architect / owner', () => {
  it('"ING DRAWINGS. BACKFILLING IN THE PIPE" is never an engineer', () => {
    const e1 = src('E-1', 'electrical', 'ENGINEERING DRAWINGS.   BACKFILLING IN THE PIPE\nE-1');
    const p = profileOf([e1], reply({ engineer: { value: 'ING DRAWINGS. BACKFILLING IN THE PIPE', sheet: 'E-1', quote: 'ENGINEERING DRAWINGS.   BACKFILLING IN THE PIPE', confidence: 'high' } }));
    expect(p.fields.engineer).toBeUndefined();
  });
  it('the engineer comes from an electrical title block only', () => {
    const c = src('C0.1', 'cover', 'ENGINEER: MATTHEW S. D\'ANGELO, P.E.');
    const p = profileOf([c], reply({ engineer: { value: "MATTHEW S. D'ANGELO, P.E.", sheet: 'C0.1', quote: "ENGINEER: MATTHEW S. D'ANGELO, P.E.", confidence: 'high' } }));
    expect(p.fields.engineer).toBeUndefined();
  });
  it('a structural or civil "engineer/architect" block is never the architect', () => {
    const c = src('A-0', 'cover', 'STRUCTURAL ENGINEER\nSMITH & JONES, INC.\n\nARCHITECT\nRLBA ARCHITECTS');
    expect(profileOf([c], reply({ architect: { value: 'SMITH & JONES, INC.', sheet: 'A-0', quote: 'SMITH & JONES, INC.', confidence: 'high' } })).fields.architect).toBeUndefined();
    expect(profileOf([c], reply({ architect: { value: 'RLBA ARCHITECTS', sheet: 'A-0', quote: 'RLBA ARCHITECTS', confidence: 'high' } })).fields.architect?.validated).toBe(true);
  });
  it('an invented quote is never accepted', () => {
    const c = src('A-0', 'cover', 'OWNER: AUTOZONE STORES LLC');
    const p = profileOf([c], reply({ owner: { value: 'WALMART INC', sheet: 'A-0', quote: 'OWNER: WALMART INC', confidence: 'high' } }));
    expect(p.fields.owner_name).toBeUndefined();
    expect(p.rejected[0].reason).toMatch(/not on any sheet/);
  });
});

describe('build type (review B2 / B5)', () => {
  it('a "RENOVATION ... (N/A)" spec-index line is never a remodel', () => {
    const c = src('T-1', 'cover', '01 35 16   ALTERATION / RENOVATION PROJECT PROCEDURES (N/A)\nNEW BUILDING');
    const p = profileOf([c], reply({ build_type: { value: 'remodel', sheet: 'T-1', quote: '01 35 16   ALTERATION / RENOVATION PROJECT PROCEDURES (N/A)', confidence: 'high' } }));
    expect(p.fields.build_type).toBeUndefined();
  });
  it('no evidence -> no build type (never a default)', () => {
    const c = src('T-1', 'cover', 'AUTOZONE STORE NO. 10077');
    expect(profileOf([c], reply({})).fields.build_type).toBeUndefined();
    expect(profileOf([c], reply({ build_type: { value: 'new', sheet: 'T-1', quote: 'AUTOZONE STORE NO. 10077', confidence: 'high' } })).fields.build_type).toBeUndefined();
  });
  it('explicit scope wording passes', () => {
    const c = src('T-1', 'cover', 'SCOPE: INTERIOR RENOVATION OF EXISTING STORE');
    expect(profileOf([c], reply({ build_type: { value: 'remodel', sheet: 'T-1', quote: 'SCOPE: INTERIOR RENOVATION OF EXISTING STORE', confidence: 'high' } })).fields.build_type?.value).toBe('remodel');
  });
});

describe('notable systems (tri-state, electrical sheets only)', () => {
  it('"AD UST" (ADJUST split by the layout) is never fuel', () => {
    const e = src('E-2', 'electrical', 'AD UST DOOR CLOSER\nE-2');
    const p = profileOf([e], reply({ systems: { fuel: { present: 'yes', sheet: 'E-2', quote: 'AD UST DOOR CLOSER' } } }));
    expect(p.systems.fuel.value).toBeNull();
  });
  it('evidence on a non-electrical sheet does not count', () => {
    const a = src('A-1', 'cover', 'FUEL DISPENSER CANOPY');
    expect(profileOf([a], reply({ systems: { fuel: { present: 'yes', sheet: 'A-1', quote: 'FUEL DISPENSER CANOPY' } } })).systems.fuel.value).toBeNull();
  });
  it('absence is unknown, never false; an explicit "not provided" is false', () => {
    const e = src('E-1', 'electrical', 'NO GENERATOR PROVIDED\nFIRE ALARM CONTROL PANEL (FACP)\nE-1');
    const p = profileOf([e], reply({ systems: {
      generator: { present: 'no', sheet: 'E-1', quote: 'NO GENERATOR PROVIDED' },
      fire_alarm: { present: 'yes', sheet: 'E-1', quote: 'FIRE ALARM CONTROL PANEL (FACP)' },
    } }));
    expect(p.systems.generator.value).toBe(false);
    expect(p.systems.fire_alarm.value).toBe(true);
    expect(p.systems.ev.value).toBeNull();
  });
});

describe('a scanned set', () => {
  it('no text layer and nothing the vision fallback can read -> undetermined, nothing to fill', () => {
    const inv: InventoryPage[] = [
      { file: 'scan.pdf', sha: 's', page: 1, sheetNo: 'T-1', title: 'COVER SHEET', discipline: 'cover' },
      { file: 'scan.pdf', sha: 's', page: 2, sheetNo: 'E-1', title: 'POWER PLAN', discipline: 'electrical' },
    ];
    const sel = selectProfilePages(inv, () => '');
    const prep = prepareProfileInput(sel, () => '');
    expect(prep.noText).toBe(true);
    expect(prep.needsImage).toHaveLength(2);
    const noReply = assembleJobProfile({ reply: null, sources: prep.sources, brands, usedVision: true, pagesUsed: prep.pagesUsed, noText: true });
    expect(noReply.status).toBe('undetermined');
    expect(noReply.fields).toEqual({});
    const emptyReply = assembleJobProfile({ reply: reply({}), sources: prep.sources, brands, usedVision: true, pagesUsed: prep.pagesUsed, noText: true });
    expect(emptyReply.status).toBe('undetermined');
    expect(emptyReply.fields).toEqual({});
  });
});

describe('the current plan set only (review S7)', () => {
  const page = (file: string, sheetNo: string, uploadedAt: string, extra: Partial<InventoryPage> = {}): InventoryPage =>
    ({ file, sha: file, page: 1, sheetNo, title: 'POWER PLAN', discipline: 'electrical', uploadedAt, ...extra });
  it('the newest upload of a sheet wins; older copies never outvote it', () => {
    const old1 = page('old.pdf', 'E-1', '2026-01-01T00:00:00Z');
    const old2 = page('old-copy.pdf', 'E-1', '2026-01-02T00:00:00Z');
    const fresh = page('new.pdf', 'E-1', '2026-03-01T00:00:00Z');
    expect(currentSetPages([old1, old2, fresh])).toEqual([fresh]);
  });
  it('a higher revision wins over a newer upload of a lower one; spec books are never read', () => {
    const r2 = page('Elec REV 2.pdf', 'E-1', '2026-01-01T00:00:00Z');
    const r1 = page('Elec REV 1.pdf', 'E-1', '2026-02-01T00:00:00Z');
    const spec = page('Project Manual.pdf', 'SP-1', '2026-02-01T00:00:00Z', { title: 'SPECIFICATIONS', discipline: 'other' });
    expect(currentSetPages([r2, r1, spec])).toEqual([r2]);
    expect(revisionOf('Elec REV 2.pdf')).toBe(2);
  });
});

describe('plumbing', () => {
  it('parses a fenced or bare JSON reply, and null for garbage', () => {
    expect(parseModelReply('```json\n{"brand":{"value":"AutoZone"}}\n```')?.brand?.value).toBe('AutoZone');
    expect(parseModelReply('{"brand":{"value":"X"}}')?.brand?.value).toBe('X');
    expect(parseModelReply('I could not read it')).toBeNull();
  });
  it('prices one Sonnet 5 call in cents', () => {
    // 5,000 in + 1,500 out at $2 / $10 per million = $0.025 = 2.5 cents.
    expect(jobProfileCostCents({ input_tokens: 5000, output_tokens: 1500 }, 'claude-sonnet-5')).toBeCloseTo(2.5, 4);
  });
  it('titleBlockText keeps a short page whole', () => {
    expect(titleBlockText('E-1  POWER PLAN')).toBe('E-1  POWER PLAN');
  });
});

describe('an unclassified set (no sheet check inventory)', () => {
  it('reads page 1 as the cover and the pages whose title block prints an E-sheet id', () => {
    const fx = loadKissimmeePages();
    const inv: InventoryPage[] = fx.pages.map((_, i) => ({ file: 'set.pdf', sha: 'k', page: i + 1, sheetNo: '', title: '', discipline: 'unknown' }));
    const sel = selectProfilePages(inv, p => fx.pages[p.page - 1]);
    expect(sel.filter(p => p.why === 'cover').map(p => p.page)).toEqual([1]);
    expect(sel.filter(p => p.why === 'electrical').map(p => p.sheetNo)).toEqual(['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7']);
  });
});

// ── Round 2 review repros (R2-B1 / R2-S5): verbatim quotes at "high" ─────────

describe('round 2 — the reviewer\'s hostile replies on the real Kissimmee sources fill nothing', () => {
  const fx = loadKissimmeePages();
  const inv = kissimmeeInventory({ sha: 'kissimmee', texts: fx.pages });
  const textOf = (p: InventoryPage) => fx.pages[p.page - 1] ?? '';
  const prepared = prepareProfileInput(selectProfilePages(inv, textOf), textOf);
  const fillable = (p: JobProfile, k: keyof JobProfile['fields']) => !!p.fields[k] && p.fields[k]!.validated && p.fields[k]!.confidence === 'high';

  it('site address = the owner\'s corporate office ("123 South Front Street, 3rd Floor")', () => {
    for (const quote of ['123 South Front Street, 3rd Floor', '123 South Front Street, 3rd Floor\nMemphis, Tennessee 38103']) {
      const p = profileOf(prepared.sources, reply({ site_address: { street: '123 South Front Street', city: 'Memphis', state: 'TN', zip: '38103', sheet: 'PH0.1', quote, confidence: 'high' } }));
      expect(fillable(p, 'loc'), quote).toBe(false);
    }
  });

  it('the city swap: Kissimmee street with Orlando / 32801 is rejected', () => {
    const p = profileOf(prepared.sources, reply({ site_address: { street: '2860 N OLD LAKE WILSON RD.', city: 'ORLANDO', state: 'FL', zip: '32801', sheet: 'C0.1', quote: '2860 N OLD LAKE WILSON RD., KISSIMMEE, FLORIDA 34747', confidence: 'high' } }));
    expect(p.fields.loc).toBeUndefined();
    expect(p.fields.name).toBeUndefined();
  });

  it('Dodge Data & Analytics (the bid service stamp) is never the engineer or the owner', () => {
    const p = profileOf(prepared.sources, reply({
      engineer: { value: 'Dodge Data & Analytics', sheet: 'E-1', quote: 'Dodge Data & Analytics', confidence: 'high' },
      owner: { value: 'Dodge Data & Analytics', sheet: 'E-2', quote: 'Dodge Data & Analytics', confidence: 'high' },
    }));
    expect(p.fields.engineer).toBeUndefined();
    expect(p.fields.owner_name).toBeUndefined();
  });

  it('CPH, INC. (the civil engineer / landscape architect) is never filled as the owner', () => {
    const p = profileOf(prepared.sources, reply({ owner: { value: 'CPH, INC.', sheet: 'C0.1', quote: 'CPH, INC.', confidence: 'high' } }));
    expect(fillable(p, 'owner_name')).toBe(false);
  });

  it('AUTOZONE, INC. as architect at "high" is only suggested: A-0 names RLBA as designer of record', () => {
    const p = profileOf(prepared.sources, reply({ architect: { value: 'AUTOZONE, INC.', sheet: 'C0.1', quote: 'AUTOZONE, INC.', confidence: 'high' } }));
    expect(p.fields.architect).toMatchObject({ value: 'AUTOZONE, INC.', confidence: 'medium' });
    expect(p.fields.architect?.notes?.join(' ')).toMatch(/A-0 names a different architect/);
  });

  it('a firm printed on every E title block with no engineer label is never the filled EOR', () => {
    const tb = (sheet: string) => src(sheet, 'electrical', `SMITH ARCHITECTS LLC          AUTOZONE STORE NO. 1234\n${sheet}    09/22/2025`);
    const p = profileOf([tb('E-1'), tb('E-2'), tb('E-3')], reply({ engineer: { value: 'SMITH ARCHITECTS LLC', sheet: 'E-1', quote: 'SMITH ARCHITECTS LLC', confidence: 'high' } }));
    expect(fillable(p, 'engineer')).toBe(false);
  });

  it('the real owner and EOR still fill (they sit next to their labels)', () => {
    const p = profileOf(prepared.sources, reply({
      owner: { value: 'AUTOZONE STORES LLC', sheet: 'C0.1', quote: 'Owner / Developer: AUTOZONE STORES LLC', confidence: 'high' },
      engineer: { value: 'DANNY E. DOSS P.E.', sheet: 'E-1', quote: 'ENGINEER: DANNY E. DOSS P.E.', confidence: 'high' },
    }));
    expect(fillable(p, 'owner_name')).toBe(true);
    expect(fillable(p, 'engineer')).toBe(true);
  });
});

describe('round 2 — R2-S5: a brand mentioned outside the project block never fills', () => {
  it('Wawa cover + "SHARED DRIVE WITH AUTOZONE" -> no AutoZone, and no Wawa fill either', () => {
    const c = src('T-1', 'cover', 'WAWA STORE #8123 - LAKELAND, FL\nNOTE: SHARED DRIVE WITH AUTOZONE');
    const az = profileOf([c], reply({ brand: { value: 'AutoZone', sheet: 'T-1', quote: 'NOTE: SHARED DRIVE WITH AUTOZONE', confidence: 'high' } }));
    expect(az.fields.brand).toBeUndefined();
    expect(az.fields.project_type).toBeUndefined();
    const azBare = profileOf([src('T-1', 'cover', 'WAWA STORE #8123 - LAKELAND, FL\nAUTOZONE')], reply({ brand: { value: 'AutoZone', sheet: 'T-1', quote: 'AUTOZONE', confidence: 'high' } }));
    expect(azBare.fields.brand).toBeUndefined();
    const wawa = profileOf([c], reply({ brand: { value: 'Wawa', sheet: 'T-1', quote: 'WAWA STORE #8123 - LAKELAND, FL', confidence: 'high' } }));
    expect(wawa.fields.brand).toMatchObject({ value: 'Wawa', validated: false }); // unknown brand: a suggestion at most
  });

  it("N-R2-2 — a generic TOMMY'S project is not Tommy's Express", () => {
    const c = src('T-1', 'cover', "PROJECT: TOMMY'S DINER");
    const p = profileOf([c], reply({ brand: { value: "Tommy's", sheet: 'T-1', quote: "PROJECT: TOMMY'S DINER", confidence: 'high' } }));
    expect(p.fields.brand?.value).not.toBe("Tommy's Express");
    expect(p.fields.project_type?.value).not.toBe('car_wash');
  });
});

describe('N-R2-3 — an older upload\'s cover is not read beside the new one', () => {
  it('only the newest upload batch contributes covers', () => {
    const inv: InventoryPage[] = [
      { file: 'old.pdf', sha: 'o', page: 1, sheetNo: 'CS', title: 'COVER SHEET', discipline: 'cover', uploadedAt: '2026-01-01T00:00:00Z' },
      { file: 'new.pdf', sha: 'n', page: 1, sheetNo: 'T-1', title: 'TITLE SHEET', discipline: 'cover', uploadedAt: '2026-03-01T00:00:00Z' },
      { file: 'new-civil.pdf', sha: 'c', page: 1, sheetNo: 'C0.1', title: 'COVER SHEET', discipline: 'cover', uploadedAt: '2026-03-01T00:05:00Z' },
    ];
    expect(selectProfilePages(inv, () => 'x'.repeat(100)).filter(p => p.why === 'cover').map(p => p.sheetNo).sort()).toEqual(['C0.1', 'T-1']);
  });
});
