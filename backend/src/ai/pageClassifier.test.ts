import { describe, it, expect } from 'vitest';
import {
  selectPages,
  shouldDropWholeFile,
  reviveIfAllDropped,
  titleBlockCropRect,
  parseClassifierJSON,
  reoffsetIfRelative,
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
    expect(selectPages(inv)).toEqual({ pages: [1, 2, 3, 4, 5], allExcluded: false });
  });

  it('default-includes a page the classifier could not place at all (unknown)', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'architectural' }),
      page({ page: 2, discipline: 'unknown' }),
    ];
    expect(selectPages(inv)).toEqual({ pages: [2], allExcluded: false });
  });

  it('never excludes everything — falls back to including all pages when selection would be empty', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'architectural' }),
      page({ page: 2, discipline: 'civil' }),
      page({ page: 3, discipline: 'structural' }),
    ];
    expect(selectPages(inv)).toEqual({ pages: [1, 2, 3], allExcluded: true });
  });

  it('returns empty (not the all-excluded guard) for an empty inventory — nothing to guard against', () => {
    expect(selectPages([])).toEqual({ pages: [], allExcluded: false });
  });
});

// FIX-1 (post-review): a purely architectural/non-electrical PDF must not ride
// selectPages' all-excluded guard to "include everything" — the whole-file
// filename check decides whether that fallback is trustworthy.
describe('shouldDropWholeFile (pure)', () => {
  it('drops a PDF whose pages are all non-electrical AND whose filename reads as non-electrical', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'architectural' }),
      page({ page: 2, discipline: 'architectural' }),
    ];
    expect(shouldDropWholeFile(inv, 'A101 Architectural.pdf')).toBe(true);
  });

  it('does not drop when the filename is electrical, even if every page classified as another discipline', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'other' }),
      page({ page: 2, discipline: 'other' }),
    ];
    expect(shouldDropWholeFile(inv, 'E-101 Electrical Site Plan.pdf')).toBe(false);
  });

  it('does not drop when the filename is ambiguous (uncertain — include)', () => {
    const inv: PageClassification[] = [page({ page: 1, discipline: 'civil' })];
    expect(shouldDropWholeFile(inv, 'combined-set.pdf')).toBe(false);
  });

  it('does not drop when the guard never fired (a real selection exists)', () => {
    const inv: PageClassification[] = [
      page({ page: 1, discipline: 'electrical' }),
      page({ page: 2, discipline: 'architectural' }),
    ];
    expect(shouldDropWholeFile(inv, 'A101 Architectural.pdf')).toBe(false);
  });
});

describe('reviveIfAllDropped (pure)', () => {
  it('reverts every drop when all files would otherwise be dropped', () => {
    const files = [{ id: 1, dropFile: true }, { id: 2, dropFile: true }];
    expect(reviveIfAllDropped(files)).toEqual([{ id: 1, dropFile: false }, { id: 2, dropFile: false }]);
  });

  it('leaves drops in place when at least one file survives', () => {
    const files = [{ id: 1, dropFile: true }, { id: 2, dropFile: false }];
    expect(reviveIfAllDropped(files)).toEqual(files);
  });

  it('is a no-op on an empty list', () => {
    expect(reviveIfAllDropped([])).toEqual([]);
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

// FIX-5 (post-review): a classifier response for batch 2+ of a large PDF must
// echo the ABSOLUTE page numbers given in the prompt, not renumber 1..N
// relative to the batch — otherwise every byPage lookup misses.
describe('reoffsetIfRelative (pure)', () => {
  it('re-offsets a relative 1..N response to the expected absolute page numbers', () => {
    expect(reoffsetIfRelative([1, 2, 3], [21, 22, 23])).toEqual([21, 22, 23]);
  });

  it('leaves a genuinely absolute response untouched', () => {
    expect(reoffsetIfRelative([21, 22, 23], [21, 22, 23])).toEqual([21, 22, 23]);
  });

  it('does not "correct" a legitimate single-batch run that really does start at page 1', () => {
    expect(reoffsetIfRelative([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('leaves a mismatched-length response untouched (parseClassifierJSON handles gaps separately)', () => {
    expect(reoffsetIfRelative([1, 2], [21, 22, 23])).toEqual([1, 2]);
  });

  it('leaves an out-of-order or non-sequential response untouched', () => {
    expect(reoffsetIfRelative([2, 1, 3], [21, 22, 23])).toEqual([2, 1, 3]);
    expect(reoffsetIfRelative([1, 3, 5], [21, 22, 23])).toEqual([1, 3, 5]);
  });

  it('is a no-op on an empty response', () => {
    expect(reoffsetIfRelative([], [])).toEqual([]);
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
    // FIX-5 (post-review): the default cls for a page missing from the
    // response is 'schedule' (highest detail), not 'plan' — silent
    // degradation to the lowest-fidelity class is never the safe default.
    expect(result[1]).toEqual({ page: 2, sheetNo: '', title: '', discipline: 'unknown', cls: 'schedule' });
    expect(result[2].discipline).toBe('unknown');
  });

  it('falls back to unknown/schedule for an invalid discipline or cls value', () => {
    const text = '[{"page":1,"sheetNo":"X","title":"Y","discipline":"not-a-real-discipline","cls":"not-a-real-cls"}]';
    const result = parseClassifierJSON(text, [1]);
    expect(result[0].discipline).toBe('unknown');
    expect(result[0].cls).toBe('schedule');
  });

  it('handles total parse failure (non-JSON garbage) as fully unclassified', () => {
    const result = parseClassifierJSON('not json at all, sorry!', [1, 2]);
    expect(result).toEqual([
      { page: 1, sheetNo: '', title: '', discipline: 'unknown', cls: 'schedule' },
      { page: 2, sheetNo: '', title: '', discipline: 'unknown', cls: 'schedule' },
    ]);
  });

  it('skips malformed entries (missing page number) without throwing', () => {
    const text = '[{"sheetNo":"no page field"},{"page":2,"discipline":"electrical","cls":"detail"}]';
    const result = parseClassifierJSON(text, [1, 2]);
    expect(result[0].discipline).toBe('unknown'); // page 1 never showed up validly
    expect(result[1]).toMatchObject({ page: 2, discipline: 'electrical', cls: 'detail' });
  });

  // FIX-5 (post-review) end to end: batch 2 of a large PDF (absolute pages
  // 21-23) comes back numbered 1-3 (relative) — without the re-offset, every
  // one of these would miss its byPage lookup and fall back to unclassified.
  it('recovers a batch-2 response that renumbered its pages 1..N instead of using absolute page numbers', () => {
    const text = '[{"page":1,"sheetNo":"E-21","discipline":"electrical","cls":"plan"},' +
      '{"page":2,"sheetNo":"E-22","discipline":"electrical","cls":"schedule"},' +
      '{"page":3,"sheetNo":"E-23","discipline":"architectural","cls":"detail"}]';
    const result = parseClassifierJSON(text, [21, 22, 23]);
    expect(result).toEqual([
      { page: 21, sheetNo: 'E-21', title: '', discipline: 'electrical', cls: 'plan' },
      { page: 22, sheetNo: 'E-22', title: '', discipline: 'electrical', cls: 'schedule' },
      { page: 23, sheetNo: 'E-23', title: '', discipline: 'architectural', cls: 'detail' },
    ]);
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
