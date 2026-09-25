// Round 2 R2-S3 — two uploads of the same sheets: only the current copy is
// analysed (higher revision in the name, else the newer upload); the older
// one is excluded with the file that replaced it. No evidence -> both stay.
import { describe, it, expect } from 'vitest';
import { applySelection, type CheckedPage } from '../services/sheetCheck';

function page(file: string, sha: string, sheetNo: string, uploadedAt: string | null, n = 1): CheckedPage {
  return {
    key: `${sha}#${n}`, file, sha, page: n, sheetNo, title: 'POWER PLAN', discipline: 'electrical', cls: 'plan',
    textChars: 500, hasTextLayer: true, classified: true, refs: [], role: 'excluded', reason: '', ...(uploadedAt ? { uploadedAt } : {}),
  };
}

describe('applySelection — replaced sheets (R2-S3)', () => {
  it('Rev 2 replaces Rev 1: the older file\'s pages are excluded, never sent', () => {
    const { pages } = applySelection([
      page('Elec Rev 1.pdf', 'a', 'E-1', '2026-01-01T00:00:00Z'), page('Elec Rev 1.pdf', 'a', 'E-2', '2026-01-01T00:00:00Z', 2),
      page('Elec Rev 2.pdf', 'b', 'E-1', '2025-12-01T00:00:00Z'), page('Elec Rev 2.pdf', 'b', 'E-2', '2025-12-01T00:00:00Z', 2),
    ], {});
    const old = pages.filter(p => p.sha === 'a');
    expect(old.every(p => p.role === 'excluded' && p.replacedBy === 'Elec Rev 2.pdf')).toBe(true);
    expect(pages.filter(p => p.sha === 'b').every(p => p.role === 'analysis')).toBe(true);
  });
  it('without revisions in the names, the newer upload wins', () => {
    const { pages } = applySelection([page('set.pdf', 'a', 'E-1', '2026-01-01T00:00:00Z'), page('set (1).pdf', 'b', 'E-1', '2026-02-01T00:00:00Z')], {});
    expect(pages.find(p => p.sha === 'a')!.replacedBy).toBe('set (1).pdf');
  });
  it('no evidence either way: both stay', () => {
    const { pages } = applySelection([page('a.pdf', 'a', 'E-1', null), page('b.pdf', 'b', 'E-1', null)], {});
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
  });
});
