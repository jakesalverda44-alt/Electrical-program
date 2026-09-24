import { describe, it, expect } from 'vitest';
import { computeAutoDeductAmount, lineMatchesAutoDeduct, formatAutoDeductLabel, DeductLineInput } from './autoDeductAlternate';

const SEVEN_ELEVEN_TERM_KEYS = ['lighting', 'panels', 'disconnects', 'other_equipment'] as const;

describe('lineMatchesAutoDeduct', () => {
  it('matches an Interior/Exterior Lighting line under "lighting"', () => {
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: '2x4 LED troffer' }, ['lighting'])).toBe(true);
    expect(lineMatchesAutoDeduct({ category: 'Exterior / Site Lighting', description: 'Wall pack' }, ['lighting'])).toBe(true);
  });
  it('matches Service & Distribution under "panels"/"disconnects"/"other_equipment" (switchgear/SPD have no own category)', () => {
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: '225A panelboard' }, ['panels'])).toBe(true);
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: 'Surge protective device' }, ['other_equipment'])).toBe(true);
  });
  it('matches a receptacle in Branch Power under "other_equipment", but not the whole branch-power category', () => {
    expect(lineMatchesAutoDeduct({ category: 'Branch Power', description: '20A duplex receptacle' }, ['other_equipment'])).toBe(true);
    expect(lineMatchesAutoDeduct({ category: 'Branch Power', description: '3/4" EMT conduit' }, ['other_equipment'])).toBe(false);
  });
  it('never matches Grounding or Low Voltage', () => {
    expect(lineMatchesAutoDeduct({ category: 'Grounding', description: 'Ground rod' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Low Voltage Infrastructure (Conduit & Boxes Only)', description: 'Data box' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
  });

  // Review round 2 / S16 — the old category-based match swept in APT's own
  // feeder wire/conduit and lighting controls just because they share a
  // category with a real Graybar item; the fix matches by description AND
  // excludes these regardless of category.
  it("never matches feeder wire or conduit, even in Service & Distribution (APT's own scope, not Graybar's)", () => {
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: 'Service feeder - 4/0 THHN copper' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: '4" PVC conduit, underground service' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: 'Main disconnect switch, 400A' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(true); // the disconnect ITSELF still matches
  });

  it('never matches the "Lighting Controls" category, even with fixture-sounding words in the description', () => {
    expect(lineMatchesAutoDeduct({ category: 'Lighting Controls', description: 'Occupancy sensor for troffer fixtures' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Lighting Controls', description: 'Lighting contactor panel' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
  });

  it('never matches a lighting CONTROL device even outside the Lighting Controls category (a mis-filed row)', () => {
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: 'Photocell for exterior fixtures' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
  });

  // Review round 2 / N-R2-3
  it('"panels" never matches a fire-alarm or other non-electrical control panel just because it contains the word "panel"', () => {
    expect(lineMatchesAutoDeduct({ category: 'Low Voltage Infrastructure (Conduit & Boxes Only)', description: 'Fire alarm control panel' }, ['panels'])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: 'Mechanical control panel connection' }, ['panels'])).toBe(false);
    // A real electrical panelboard still matches.
    expect(lineMatchesAutoDeduct({ category: 'Service & Distribution', description: '225A Panelboard, 42-circuit' }, ['panels'])).toBe(true);
  });

  it('a fixture that merely mentions an attached photocell or occupancy sensor is STILL a fixture — never under-deducted', () => {
    expect(lineMatchesAutoDeduct({ category: 'Exterior / Site Lighting', description: 'LED wall pack w/ photocell' }, ['lighting'])).toBe(true);
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: 'Type A - 2x4 LED troffer w/ integral occupancy sensor' }, ['lighting'])).toBe(true);
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: '2x4 LED troffer with integral photocell' }, ['lighting'])).toBe(true);
  });

  it('a STANDALONE control device is still excluded, even worded almost identically to the "attached accessory" phrasing', () => {
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: 'Photocell, button-type' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
    expect(lineMatchesAutoDeduct({ category: 'Interior Lighting', description: 'Ceiling-mount occupancy sensor' }, [...SEVEN_ELEVEN_TERM_KEYS])).toBe(false);
  });
});

describe('computeAutoDeductAmount', () => {
  const lines: DeductLineInput[] = [
    { category: 'Interior Lighting', description: '2x4 LED troffer', materialExt: 5000, excluded: false },
    { category: 'Service & Distribution', description: '225A panelboard', materialExt: 3000, excluded: false },
    { category: 'Service & Distribution', description: 'Surge protective device', materialExt: 500, excluded: false },
    { category: 'Branch Power', description: '20A duplex receptacle', materialExt: 800, excluded: false },
    { category: 'Branch Power', description: '3/4" EMT conduit', materialExt: 10000, excluded: false }, // never counted
    { category: 'Grounding', description: 'Ground rod', materialExt: 200, excluded: false }, // never counted
  ];

  it('sums matched material + material markup (installation labor is never part of the input, by construction)', () => {
    const result = computeAutoDeductAmount(lines, { termKeys: [...SEVEN_ELEVEN_TERM_KEYS], materialMarkupPct: 20 });
    // matched material: 5000+3000+500+800 = 9300
    expect(result.matchedMaterial).toBeCloseTo(9300, 2);
    expect(result.matchedLineCount).toBe(4);
    // + 20% markup = 11160
    expect(result.amount).toBeCloseTo(11160, 2);
  });

  it('adds tax only when the rule is marked taxable', () => {
    const untaxed = computeAutoDeductAmount(lines, { termKeys: [...SEVEN_ELEVEN_TERM_KEYS], materialMarkupPct: 20, taxable: false, materialTaxPct: 7 });
    expect(untaxed.amount).toBeCloseTo(11160, 2);
    const taxed = computeAutoDeductAmount(lines, { termKeys: [...SEVEN_ELEVEN_TERM_KEYS], materialMarkupPct: 20, taxable: true, materialTaxPct: 7 });
    // 11160 * 1.07 = 11941.2
    expect(taxed.amount).toBeCloseTo(11941.20, 2);
  });

  it('excludes an excluded line', () => {
    const withExcluded = [...lines, { category: 'Interior Lighting', description: 'Excluded fixture', materialExt: 999999, excluded: true }];
    const result = computeAutoDeductAmount(withExcluded, { termKeys: [...SEVEN_ELEVEN_TERM_KEYS], materialMarkupPct: 20 });
    expect(result.matchedMaterial).toBeCloseTo(9300, 2);
  });

  it('is zero (not negative, not NaN) when nothing matches', () => {
    const result = computeAutoDeductAmount([{ category: 'Grounding', description: 'Ground rod', materialExt: 500, excluded: false }], { termKeys: [...SEVEN_ELEVEN_TERM_KEYS], materialMarkupPct: 20 });
    expect(result.amount).toBe(0);
    expect(Number.isFinite(result.amount)).toBe(true);
  });

  it('never produces NaN or a negative amount for garbage input', () => {
    const result = computeAutoDeductAmount([{ category: 'Interior Lighting', description: 'x', materialExt: NaN, excluded: false }], { termKeys: ['lighting'], materialMarkupPct: 20 });
    expect(Number.isFinite(result.amount)).toBe(true);
    expect(result.amount).toBeGreaterThanOrEqual(0);
  });
});

describe('formatAutoDeductLabel', () => {
  it('fills in the %AMOUNT% token as a formatted dollar figure', () => {
    const label = formatAutoDeductLabel('Deduct %AMOUNT% if furnished by others.', 11160);
    expect(label).toBe('Deduct $11,160.00 if furnished by others.');
  });
});
