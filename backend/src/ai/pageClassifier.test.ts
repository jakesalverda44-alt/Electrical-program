import { describe, it, expect } from 'vitest';
import {
  selectPages,
  titleBlockCropRect,
  parseClassifierJSON,
  formatSheetLabel,
  type PageClassification,
} from './pageClassifier';

function page(p: Partial<PageClassification> & { page: number }): PageClassification {
  return { sheetNo: '', title: '', discipline: 'other', cls: 'plan', ...p };
}

describe('selectPages (pure)', () => {
  it('includes electrical, fuel, lowvoltage, cover, and unknown', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'electrical' }),
      page({ page: 2, discipline: 'fuel' }),
      page({ page: 3, discipline: 'lowvoltage' }),
      page({ page: 4, discipline: 'cover' }),
      page({ page: 5, discipline: 'unknown' }),
      page({ page: 6, discipline: 'architectural' }),
      page({ page: 7, discipline: 'civil' }),
      page({ page: 8, discipline: 'structural' }),
      page({ page: 9, discipline: 'mechanical' }),
      page({ page: 10, discipline: 'plumbing' }),
      page({ page: 11, discipline: 'other' }),
    ];
    expect(selectPages(inv)).toEqual([1, 2, 3, 4, 5]);
  });

  it('default-includes a page the classifier could not place at all (unknown)', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'architectural' }),
      page({ page: 2, discipline: 'unknown' }),
    ];
    expect(selectPages(inv)).toEqual([2]);
  });

  it('never excludes everything — falls back to including all pages when selection would be empty', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'architectural' }),
      page({ page: 2, discipline: 'civil' }),
      page({ page: 3, discipline: 'structural' }),
    ];
    expect(selectPages(inv)).toEqual([1, 2, 3]);
  });

  it('returns empty for an empty inventory (nothing to guard against)', () => {
    expect(selectPages([])).toEqual([]);
  });
});

describe('titleBlockCropRect (pure crop geometry)', () => {
  it('crops the right 25% strip, full height', () => {
    expect(titleBlockCropRect(4000, 3000)).toEqual({ left: 3000, top: 0, width: 1000, height: 3000 });
  });

  it('rounds down the left edge for non-round widths', () => {
    expect(titleBlockCropRect(4001, 100)).toEqual({ left: 3000, top: 0, width: 1001, height: 100 });
  });

  it('never returns a zero-width crop for a tiny page', () => {
    const rect = titleBlockCropRect(2, 2);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('parseClassifierJSON (pure, tolerant)', () => {
  it('parses a clean JSON array', () => {
    const text = '[{"page":1,"sheetNo":"E-101","title":"Site Plan","discipline":"electrical","cls":"plan"}]';
    expect(parseClassifierJSON(text, [1])).toEqual([
      { page: 1, sheetNo: 'E-101', title: 'Site Plan', discipline: 'electrical', cls: 'plan' },
    ]);
  });

  it('strips markdown fences', () => {
    const text = '```json\n[{"page":1,"sheetNo":"E-601","title":"Panel Schedule","discipline":"electrical","cls":"schedule"}]\n```';
    const result = parseClassifierJSON(text, [1]);
    expect(result[0].sheetNo).toBe('E-601');
    expect(result[0].cls).toBe('schedule');
  });

  it('treats a page missing from the response as unclassified/included', () => {
    const text = '[{"page":1,"sheetNo":"E-101","title":"","discipline":"electrical","cls":"plan"}]';
    const result = parseClassifierJSON(text, [1, 2, 3]);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({ page: 2, sheetNo: '', title: '', discipline: 'unknown', cls: 'plan' });
    expect(result[2].discipline).toBe('unknown');
  });

  it('falls back to unknown/plan for an invalid discipline or cls value', () => {
    const text = '[{"page":1,"sheetNo":"X","title":"Y","discipline":"not-a-real-discipline","cls":"not-a-real-cls"}]';
    const result = parseClassifierJSON(text, [1]);
    expect(result[0].discipline).toBe('unknown');
    expect(result[0].cls).toBe('plan');
  });

  it('handles total parse failure (non-JSON garbage) as fully unclassified', () => {
    const result = parseClassifierJSON('not json at all, sorry!', [1, 2]);
    expect(result).toEqual([
      { page: 1, sheetNo: '', title: '', discipline: 'unknown', cls: 'plan' },
      { page: 2, sheetNo: '', title: '', discipline: 'unknown', cls: 'plan' },
    ]);
  });

  it('skips malformed entries (missing page number) without throwing', () => {
    const text = '[{"sheetNo":"no page field"},{"page":2,"discipline":"electrical","cls":"detail"}]';
    const result = parseClassifierJSON(text, [1, 2]);
    expect(result[0].discipline).toBe('unknown'); // page 1 never showed up validly
    expect(result[1]).toMatchObject({ page: 2, discipline: 'electrical', cls: 'detail' });
  });
});

describe('formatSheetLabel (pure)', () => {
  it('combines sheet number and title, quoted', () => {
    expect(formatSheetLabel('E1.1', 'Panel Schedules', 'fallback.pdf')).toBe('E1.1 "Panel Schedules"');
  });

  it('falls back to just the sheet number when title is missing', () => {
    expect(formatSheetLabel('E1.1', '', 'fallback.pdf')).toBe('E1.1');
  });

  it('falls back to just the quoted title when sheet number is missing', () => {
    expect(formatSheetLabel('', 'Panel Schedules', 'fallback.pdf')).toBe('"Panel Schedules"');
  });

  it('falls back to the given fallback when both are missing', () => {
    expect(formatSheetLabel('', '', 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('trims whitespace-only fields as missing', () => {
    expect(formatSheetLabel('   ', '   ', 'fallback.pdf')).toBe('fallback.pdf');
  });
});
