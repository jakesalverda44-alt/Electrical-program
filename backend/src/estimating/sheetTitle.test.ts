import { describe, it, expect } from 'vitest';
import { cleanSheetTitle, isJunkTitle, isGarbledText, caesarShift } from './sheetTitle';

describe('isJunkTitle — stamps, dates, note fragments, garble', () => {
  const junk = [
    'Dodge Data & Analytics', 'Dodge Data & Analytics…',
    'For Bidding & Contractors Use Only', 'For Bidding & Contracto…',
    'ConstructConnect', 'BuildingConnected',
    'coverings', '05/20/09',
    'Signature must be verified', 'Signature must be verifie…',
    '5IJT JUFN IBT CFFO',
    '', '   ', '123-45',
  ];
  for (const j of junk) it(`rejects ${JSON.stringify(j)}`, () => {
    expect(isJunkTitle(j)).toBe(true);
    expect(cleanSheetTitle(j)).toBeNull();
  });

  it('rejects over-long text and sentence-like fragments', () => {
    expect(isJunkTitle('A'.repeat(71))).toBe(true);
    expect(isJunkTitle('Verify all dimensions in the field before ordering.')).toBe(true);
  });
});

describe('cleanSheetTitle — real titles survive', () => {
  const real = [
    'Power Plan & General Notes', 'ELECTRICAL SITE PLAN', 'LIGHTING PLAN', 'PANEL SCHEDULES',
    'ONE-LINE DIAGRAM', 'Reflected Ceiling Plan', 'Fire Alarm Riser',
  ];
  for (const r of real) it(`keeps ${JSON.stringify(r)}`, () => expect(cleanSheetTitle(`  ${r}  `)).toBe(r));

  it('keeps a long but valid title (70 characters or fewer)', () => {
    const t = 'Enlarged Electrical Floor Plan - Kitchen And Canopy Area Partial 1';
    expect(t.length).toBeLessThanOrEqual(70);
    expect(cleanSheetTitle(t)).toBe(t);
  });

  it('collapses inner whitespace', () => {
    expect(cleanSheetTitle('Power   Plan')).toBe('Power Plan');
  });
});

describe('garble check', () => {
  it('caesarShift works both ways', () => {
    expect(caesarShift('ijt', -1)).toBe('his');
    expect(caesarShift('xyz', 3)).toBe('abc');
  });
  it('plain English is not garbled', () => {
    expect(isGarbledText('This item has been')).toBe(false);
  });
  it('a one-token or unshiftable string is not garbled', () => {
    expect(isGarbledText('E1')).toBe(false);
    expect(isGarbledText('Qzxv Wkjh')).toBe(false);
  });
});
