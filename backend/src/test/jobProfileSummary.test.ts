// Plans-panel fix round, Task 3 — "142 sheets in set · 23 electrical" used to
// count a bound spec book's pages as sheets. sheetSummaryOf now separates
// plan-set sheets from spec-book pages, using the sheet check's own
// classification (pageClassifier.ts's 'spec' discipline) rather than a
// second heuristic.
import { describe, it, expect } from 'vitest';
import { sheetSummaryOf } from '../services/jobProfileRun';
import type { CheckedPage, SheetCheckRow } from '../services/sheetCheck';
import type { ResolvedRef } from '../ai/sheetRefs';

function page(overrides: Partial<CheckedPage>): CheckedPage {
  return {
    key: `${overrides.sha ?? 'sha'}#${overrides.page ?? 1}`, file: 'set.pdf', sha: 'sha', page: 1,
    sheetNo: '', title: '', discipline: 'other', cls: 'plan', textChars: 0, hasTextLayer: false,
    classified: true, refs: [], role: 'excluded', reason: '', ...overrides,
  } as CheckedPage;
}

function row(pages: CheckedPage[]): SheetCheckRow {
  return {
    status: 'complete', run_token: null, input_key: 'k',
    result: { version: 1, pages, refs: [], unclassifiedFiles: [], otherFiles: [], checkedAt: 'now' },
    overrides: {}, skips: {}, error: null, finished_at: 'now',
  };
}

describe('sheetSummaryOf — plan sheets vs a bound spec book (Task 3)', () => {
  it('counts only plan-set pages as sheets, and spec-book pages separately', () => {
    const pages = [
      ...Array.from({ length: 6 }, (_, i) => page({ page: i + 1, discipline: 'electrical', role: 'analysis' })),
      ...Array.from({ length: 49 }, (_, i) => page({ page: 100 + i, discipline: 'architectural' })),
      ...Array.from({ length: 142 }, (_, i) => page({ page: 1000 + i, discipline: 'spec' })),
    ];
    const summary = sheetSummaryOf(row(pages));
    expect(summary).toMatchObject({ status: 'complete', total: 55, electrical: 6, specPages: 142 });
  });

  it('reports specPages: 0 when there is no spec book in the upload', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page({ page: i + 1, discipline: i < 3 ? 'electrical' : 'architectural', role: i < 3 ? 'analysis' : 'excluded' }));
    const summary = sheetSummaryOf(row(pages));
    expect(summary).toMatchObject({ total: 10, electrical: 3, specPages: 0 });
  });

  it('missing references still count against the missingRefs figure, unaffected by spec pages', () => {
    const pages = [page({ page: 1, discipline: 'electrical', role: 'analysis' }), page({ page: 2, discipline: 'spec' })];
    const missing: ResolvedRef = { id: 'r1', kind: 'sheet', key: 'M-1', label: 'M-1', status: 'missing', pages: [], referencedBy: [], notProvidedText: 'M-1 was not provided' };
    const r = row(pages);
    r.result = { ...r.result!, refs: [missing] };
    const summary = sheetSummaryOf(r);
    expect(summary?.missingRefs).toBe(1);
    expect(summary?.specPages).toBe(1);
  });

  it('a running check with no result yet reports zeros, not null', () => {
    expect(sheetSummaryOf({ status: 'running', run_token: 't', input_key: 'k', result: null, overrides: {}, skips: {}, error: null, finished_at: null }))
      .toEqual({ status: 'running', total: 0, electrical: 0, missingRefs: 0, specPages: 0 });
  });

  it('no sheet check at all is null', () => {
    expect(sheetSummaryOf(null)).toBeNull();
  });
});
