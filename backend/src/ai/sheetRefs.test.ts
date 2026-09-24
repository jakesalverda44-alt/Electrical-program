import { describe, it, expect } from 'vitest';
import {
  normalizeSheetId, extractRegexRefs, resolveRefs, alwaysUsefulPages, parseAiRefs, splitNotes,
  learnSheetPattern, matchesSheetPattern, type RefInventoryPage,
} from './sheetRefs';

const from = (sheetNo = 'E-7') => ({ key: `set.pdf#7`, label: `${sheetNo} "ELECTRICAL SITE PLAN"`, sheetNo });
const keys = (text: string, sheetNo = 'E-7', prefixes?: Set<string>) =>
  extractRegexRefs(text, from(sheetNo), prefixes).refs.map(r => `${r.kind}:${r.key}`);

describe('normalizeSheetId', () => {
  it('normalizes the usual spellings to one key', () => {
    expect(normalizeSheetId('E-7')).toBe('E7');
    expect(normalizeSheetId('E7')).toBe('E7');
    expect(normalizeSheetId('PH0.1')).toBe('PH0.1');
    expect(normalizeSheetId('PH-0.1')).toBe('PH0.1');
    expect(normalizeSheetId('e 3.1')).toBe('E3.1');
    expect(normalizeSheetId('E-001')).toBe('E1');
    expect(normalizeSheetId('C-3.1')).toBe('C3.1');
    expect(normalizeSheetId('M1.0A')).toBe('M1.0A');
    expect(normalizeSheetId('LIGHTING')).toBeNull();
    // N4 — 4 digits; E2.01 and E-2.1 are one sheet.
    expect(normalizeSheetId('E-1001')).toBe('E1001');
    expect(normalizeSheetId('E2.01')).toBe(normalizeSheetId('E-2.1'));
    expect(normalizeSheetId('')).toBeNull();
  });
});

describe('extractRegexRefs — explicit sheet ids', () => {
  it('SEE M-1', () => {
    expect(keys('3. PROVIDE DISCONNECT FOR RTU-1. SEE M-1 FOR EQUIPMENT DATA.')).toEqual(['sheet:M1']);
  });
  it('REFER TO SHEET C-3.1', () => {
    expect(keys('ROUTE UNDERGROUND CONDUIT. REFER TO SHEET C-3.1 FOR UTILITY ROUTING.')).toEqual(['sheet:C3.1']);
  });
  it('PER PH0.1', () => {
    expect(keys('POLE LOCATIONS PER PH0.1.')).toEqual(['sheet:PH0.1']);
  });
  it('detail references and lists', () => {
    expect(keys('MOUNT PER DETAIL 3/E-5. SEE E-2 AND E-3 FOR CIRCUITING.')).toEqual(['sheet:E5', 'sheet:E2', 'sheet:E3']);
  });
  it('never code sections, equipment tags or the sheet itself', () => {
    expect(keys('GFCI PROTECTION PER NEC 210.8. LISTED PER UL 924. SEE PANEL LP. RTU-1 ON ROOF. SEE E-7 NOTE 2.')).toEqual([]);
  });
  it('an unusual prefix counts only when the inventory uses it', () => {
    expect(keys('SEE LT-2 FOR CONTROLS.')).toEqual([]);
    expect(keys('SEE LT-2 FOR CONTROLS.', 'E-7', new Set(['LT']))).toEqual(['sheet:LT2']);
  });
  it('remembers the numbered note it came from', () => {
    const { refs } = extractRegexRefs('GENERAL NOTES\n1. ALL WORK PER NEC.\n3. SITE LIGHTING: SEE PHOTOMETRIC PLAN\nFOR POLE LOCATIONS.', from());
    expect(refs[0]).toMatchObject({ kind: 'discipline', key: 'photometric', note: 'note 3' });
  });
});

describe('extractRegexRefs — discipline-only references', () => {
  it('see civil / see mechanical drawings / photometric plan / RCP / life safety / equipment schedule', () => {
    expect(keys('ROUTE PER SITE PLAN. SEE CIVIL FOR STORM.')).toEqual(['discipline:civil']);
    expect(keys('COORDINATE EXACT LOCATIONS, SEE MECHANICAL DRAWINGS.')).toEqual(['discipline:mechanical']);
    expect(keys('SITE FIXTURES PER PHOTOMETRIC PLAN.')).toEqual(['discipline:photometric']);
    expect(keys('FIXTURE LOCATIONS AS SHOWN ON THE REFLECTED CEILING PLAN.')).toEqual(['discipline:reflected_ceiling']);
    expect(keys('EXIT LOCATIONS PER LIFE SAFETY PLAN.')).toEqual(['discipline:life_safety']);
    expect(keys('FOR MCA/MOCP SEE MECHANICAL EQUIPMENT SCHEDULE.')).toEqual(['discipline:equipment_schedule']);
  });
  it('a trade named without a pointer is not a reference', () => {
    expect(keys('EXHAUST FAN INSTALLED BY MECHANICAL CONTRACTOR, WIRED BY EC.')).toEqual([]);
    expect(keys('PLUMBING FIXTURES BY OTHERS.')).toEqual([]);
  });
  it('vague pointers the regex cannot read are handed on (for Haiku)', () => {
    const { refs, unresolved } = extractRegexRefs('PROVIDE POWER TO ALL OWNER EQUIPMENT. SEE OWNER-PROVIDED VENDOR DRAWINGS FOR REQUIREMENTS.', from());
    expect(refs).toEqual([]);
    expect(unresolved.map(u => u.text)).toEqual(['SEE OWNER-PROVIDED VENDOR DRAWINGS FOR REQUIREMENTS.']);
  });
});

describe('splitNotes', () => {
  it('splits sentences and carries the note number', () => {
    const s = splitNotes('1. FIRST. SECOND SENTENCE.\n2) THIRD');
    expect(s).toEqual([
      { text: '1. FIRST.', note: 'note 1' }, { text: 'SECOND SENTENCE.', note: 'note 1' }, { text: '2) THIRD', note: 'note 2' },
    ]);
  });
});

// AutoZone-shaped inventory (the Kissimmee set, abridged).
const INV: RefInventoryPage[] = [
  { key: 'set.pdf#1', file: 'set.pdf', page: 1, sheetNo: 'G-0.1', title: 'COVER SHEET', discipline: 'cover' },
  { key: 'set.pdf#10', file: 'set.pdf', page: 10, sheetNo: 'A-1.1', title: 'FLOOR PLAN', discipline: 'architectural' },
  { key: 'set.pdf#11', file: 'set.pdf', page: 11, sheetNo: 'A-3.1', title: 'REFLECTED CEILING PLAN', discipline: 'architectural' },
  { key: 'set.pdf#20', file: 'set.pdf', page: 20, sheetNo: 'E-0.1', title: 'ELECTRICAL SCHEDULES', discipline: 'electrical' },
  { key: 'set.pdf#21', file: 'set.pdf', page: 21, sheetNo: 'E-1', title: 'ELECTRICAL SITE PLAN', discipline: 'electrical' },
  { key: 'set.pdf#23', file: 'set.pdf', page: 23, sheetNo: 'E-3', title: 'LIGHTING PLAN', discipline: 'electrical' },
  { key: 'set.pdf#27', file: 'set.pdf', page: 27, sheetNo: 'E-7', title: 'ELECTRICAL DETAILS', discipline: 'electrical' },
  // The classifier called the photometric sheet 'civil' — the live failure.
  { key: 'set.pdf#30', file: 'set.pdf', page: 30, sheetNo: 'PH0.1', title: 'PHOTOMETRIC SITE PLAN', discipline: 'civil' },
  { key: 'set.pdf#31', file: 'set.pdf', page: 31, sheetNo: 'C-3.1', title: 'UTILITY PLAN', discipline: 'civil' },
  { key: 'set.pdf#32', file: 'set.pdf', page: 32, sheetNo: 'C-1.0', title: 'DEMOLITION PLAN', discipline: 'civil' },
];

describe('resolveRefs — AutoZone-shaped inventory', () => {
  const e7 = extractRegexRefs(
    'GENERAL NOTES\n3. SITE LIGHTING POLES PER PH0.1.\n4. SEE M-1 FOR RTU ELECTRICAL DATA.\n5. SITE CONDUIT: SEE CIVIL.',
    { key: 'set.pdf#27', label: 'E-7 "ELECTRICAL DETAILS"', sheetNo: 'E-7' },
  ).refs;
  const resolved = resolveRefs(e7, INV);

  it('E-7 -> PH0.1 is present (auto-included as reference)', () => {
    const ph = resolved.find(r => r.id === 'sheet:PH0.1')!;
    expect(ph.status).toBe('present');
    expect(ph.pages).toEqual(['set.pdf#30']);
    expect(ph.referencedBy[0]).toMatchObject({ fromLabel: 'E-7 "ELECTRICAL DETAILS"', note: 'note 3' });
  });
  it('the missing M-1 is flagged with its clarification text', () => {
    const m = resolved.find(r => r.id === 'sheet:M1')!;
    expect(m.status).toBe('missing');
    expect(m.pages).toEqual([]);
    expect(m.notProvidedText).toBe('Sheet M-1 not provided at time of bid');
  });
  it('"see civil" resolves to the utility sheet, not every civil page', () => {
    const c = resolved.find(r => r.id === 'discipline:civil')!;
    expect(c.status).toBe('present');
    expect(c.pages).toEqual(['set.pdf#31']);
  });
  it('a missing discipline gets its not-provided wording', () => {
    const r = resolveRefs(extractRegexRefs('FOR MCA SEE MECHANICAL EQUIPMENT SCHEDULE.', from()).refs, INV);
    expect(r[0]).toMatchObject({ status: 'missing', notProvidedText: 'Mechanical schedules not provided at time of bid' });
  });
  it('two different pages with one sheet number is ambiguous', () => {
    const inv = [...INV, { key: 'alt.pdf#1', file: 'alt.pdf', page: 1, sheetNo: 'PH-0.1', title: 'PHOTOMETRIC PLAN - ALTERNATE', discipline: 'electrical' }];
    expect(resolveRefs(e7, inv).find(r => r.id === 'sheet:PH0.1')!.status).toBe('ambiguous');
  });
  it('one entry per target, every referencing place kept', () => {
    const more = extractRegexRefs('POLES PER PH0.1.', { key: 'set.pdf#21', label: 'E-1 "ELECTRICAL SITE PLAN"', sheetNo: 'E-1' }).refs;
    const r = resolveRefs([...e7, ...more], INV).filter(x => x.id === 'sheet:PH0.1');
    expect(r).toHaveLength(1);
    expect(r[0].referencedBy.map(b => b.fromLabel)).toEqual(['E-7 "ELECTRICAL DETAILS"', 'E-1 "ELECTRICAL SITE PLAN"']);
  });
});

describe('alwaysUsefulPages', () => {
  it('photometric and RCP are always useful; floor plans are not', () => {
    expect(alwaysUsefulPages(INV)).toEqual([
      { key: 'set.pdf#30', why: 'photometric / site lighting' },
      { key: 'set.pdf#11', why: 'reflected ceiling plan' },
    ]);
  });
});

describe('parseAiRefs', () => {
  it('accepts sheets and known disciplines, drops the rest', () => {
    const refs = parseAiRefs('```json\n[{"kind":"sheet","id":"M-1","context":"see mech"},{"kind":"discipline","key":"plumbing"},{"kind":"discipline","key":"vibes"},{"kind":"sheet","id":"NEC 210"}]\n```',
      { key: 'k', label: 'E-7' }, 'haiku');
    expect(refs.map(r => `${r.kind}:${r.key}:${r.source}`)).toEqual(['sheet:M1:haiku', 'discipline:plumbing:haiku']);
  });
  it('garbage is no references, never a guess', () => {
    expect(parseAiRefs('I could not read it', { key: 'k', label: 'E' }, 'vision')).toEqual([]);
  });
});

describe('splitNotes — pdftotext -layout columns', () => {
  it('a column gap is a line break (two notes side by side stay apart)', () => {
    const s = splitNotes('3. POLES PER PH0.1.        E-3 LIGHTING PLAN   SCALE 1/8"');
    expect(s.map(x => x.text)).toEqual(['3. POLES PER PH0.1.', 'E-3 LIGHTING PLAN', 'SCALE 1/8"']);
  });
});

// ── Fix round — B1 / N1 / N2 / N3 ───────────────────────────────────────────
// The reviewer's false cases, run the way the sheet check runs them: with
// the set's own sheet-number pattern and ids (the Kissimmee-shaped INV).
const PATTERN = learnSheetPattern(INV.map(p => p.sheetNo));
const KEYS = new Set(INV.map(p => normalizeSheetId(p.sheetNo)!));
const live = (text: string) => extractRegexRefs(text, from('E-7'), { pattern: PATTERN, inventoryKeys: KEYS }).refs.map(r => `${r.kind}:${r.key}`);

describe('fix round B1 — ordinary note wording is never a sheet', () => {
  it.each([
    'MAXIMUM OF 6 RECEPTACLES ON A 20 AMP CIRCUIT.',
    'MOUNT AT 18" AFF IN A 4" SQ BOX.',
    'PROVIDE (2) 20A CIRCUITS IN A 1" CONDUIT.',
    'CIRCUIT ON C-3',
    'LOCATE ON S 1 SIDE',
    'INSTALL ON L-1 LEVEL',
    'PER T-24 REQUIREMENTS',
    'PHOTOCELL ON S1 AND S2 POLES',
    'EMERGENCY DRIVER IN F2 FIXTURES',
    'SEE TYPE A1 FIXTURE',
    'PER CKT C-3',
    'SEE PANEL L-1',
    'PER #12 AWG',
    'SEE 3/4" CONDUIT',
    'REFER TO A 20 AMP BREAKER',
    'PER NEC 210.8',
  ])('%s -> nothing', (text) => {
    expect(live(text)).toEqual([]);
  });
  it.each([
    ['SEE M-1 FOR RTU DATA.', ['sheet:M1']],
    ['REFER TO SHEET C-3.1 FOR UTILITY ROUTING.', ['sheet:C3.1']],
    ['POLE LOCATIONS PER PH0.1.', ['sheet:PH0.1']],
    ['MOUNT PER DETAIL 3/E-5.', ['sheet:E5']],
    ['SEE DETAIL 4 ON SHEET E-2.', ['sheet:E2']],
    ['ROUTE AS SHOWN ON SHEET E 3.', ['sheet:E3']],
  ])('%s -> %j', (text, want) => {
    expect(live(text)).toEqual(want);
  });
  it('a missing id must look like this set\'s sheet numbers', () => {
    expect(matchesSheetPattern('M-1', PATTERN)).toBe(true);
    expect(matchesSheetPattern('M 1', PATTERN)).toBe(false); // no set sheet uses a space
    expect(matchesSheetPattern('E-1001', PATTERN)).toBe(false); // this set's numbers are 1 digit
    expect(matchesSheetPattern('QZ-1', PATTERN)).toBe(false); // unknown prefix
    // An AI-read id is filtered the same way when it resolves as missing.
    const refs = parseAiRefs('[{"kind":"sheet","id":"A 20"},{"kind":"sheet","id":"M-1"}]', { key: 'k', label: 'E-7' }, 'haiku');
    expect(resolveRefs(refs, INV, PATTERN).map(r => r.id)).toEqual(['sheet:M1']);
  });
});

describe('fix round N1 / N2 / N3', () => {
  it('N1: a pointer wrapped onto the next line', () => {
    expect(live('3. ROUTE CONDUIT, SEE SHEET\nE-2 FOR HOMERUNS.')).toEqual(['sheet:E2']);
  });
  it('N2: a range is expanded', () => {
    expect(live('SEE E-1 THRU E-4.')).toEqual(['sheet:E1', 'sheet:E2', 'sheet:E3', 'sheet:E4']);
  });
  it('N3: RCP only, not every architectural sheet; bare headings are not references', () => {
    expect(live('REFER TO ARCHITECTURAL REFLECTED CEILING PLAN.')).toEqual(['discipline:reflected_ceiling']);
    expect(live('MECHANICAL EQUIPMENT SCHEDULE')).toEqual([]);
    expect(live('ABBREVIATIONS: RCP REFLECTED CEILING PLAN')).toEqual([]);
  });
});

