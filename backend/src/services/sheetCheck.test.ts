import { describe, it, expect } from 'vitest';
import { applySelection, missingRefs, skippedClarifications, MAX_REFERENCE_PAGES, type CheckedPage, type SheetCheckResult } from './sheetCheck';
import { extractRegexRefs } from '../ai/sheetRefs';

function page(file: string, n: number, sheetNo: string, title: string, discipline: string, notes = ''): CheckedPage {
  const key = `${file}-sha#${n}`;
  return {
    key, file, sha: `${file}-sha`, page: n, sheetNo, title, discipline, cls: 'plan', textChars: notes.length, hasTextLayer: !!notes,
    classified: true, refs: notes ? extractRegexRefs(notes, { key, label: sheetNo, sheetNo }).refs : [], role: 'excluded', reason: '',
  };
}

describe('applySelection', () => {
  it('electrical pages analysed, a file of only other disciplines dropped whole', () => {
    const { pages } = applySelection([
      page('E.pdf', 1, 'E-1', 'POWER PLAN', 'electrical'),
      page('A101 Architectural.pdf', 1, 'A-1', 'FLOOR PLAN', 'architectural'),
    ], {});
    expect(pages.map(p => `${p.sheetNo}:${p.role}`)).toEqual(['E-1:analysis', 'A-1:excluded']);
    expect(pages[1].reason).toContain('every page of this file');
  });

  it('never drops every file (an upload of only an architectural set is still analysed)', () => {
    const { pages } = applySelection([page('A101 Architectural.pdf', 1, 'A-1', 'FLOOR PLAN', 'architectural')], {});
    expect(pages[0].role).toBe('analysis');
  });

  it('a referenced page is a reference page; an exclude override wins over the reference', () => {
    const ps = [page('set.pdf', 1, 'E-7', 'DETAILS', 'electrical', 'SEE M-1 FOR RTU DATA.'), page('set.pdf', 2, 'M-1', 'MECHANICAL SCHEDULES', 'mechanical')];
    expect(applySelection(ps, {}).pages[1]).toMatchObject({ role: 'reference', referencedBy: ['E-7'] });
    const out = applySelection(ps, { [ps[1].key]: { decision: 'exclude', reason: 'not needed here', by: 'Jake', at: 'now' } });
    expect(out.pages[1]).toMatchObject({ role: 'excluded', reason: 'left out by Jake: not needed here' });
  });

  it('an excluded electrical page\'s notes are not followed', () => {
    const ps = [page('set.pdf', 1, 'E-7', 'DETAILS', 'electrical', 'SEE M-1 FOR RTU DATA.'), page('set.pdf', 2, 'M-1', 'MECHANICAL PLAN', 'mechanical')];
    const out = applySelection(ps, { [ps[0].key]: { decision: 'exclude', reason: 'superseded sheet', by: 'Jake', at: 'now' } });
    expect(out.pages.map(p => p.role)).toEqual(['excluded', 'excluded']);
    expect(out.refs).toEqual([]);
  });

  it('reference pages are capped', () => {
    const ps = [page('set.pdf', 1, 'E-7', 'DETAILS', 'electrical', 'SEE MECHANICAL DRAWINGS.')];
    for (let i = 1; i <= MAX_REFERENCE_PAGES + 3; i++) ps.push(page('set.pdf', i + 1, `A-${i}`, i === 1 ? 'REFLECTED CEILING PLAN' : 'LIFE SAFETY PLAN', 'architectural'));
    const out = applySelection(ps, {});
    expect(out.pages.filter(p => p.role === 'reference')).toHaveLength(MAX_REFERENCE_PAGES);
  });

  it('missing references carry their skips; skipped ones become clarifications', () => {
    const ps = [page('set.pdf', 1, 'E-7', 'DETAILS', 'electrical', 'SEE M-1 FOR RTU DATA. SEE CIVIL.')];
    const { pages, refs } = applySelection(ps, {});
    const result: SheetCheckResult = { version: 1, pages, refs, unclassifiedFiles: [], otherFiles: [], checkedAt: '' };
    expect(missingRefs(result, {}).map(m => m.id)).toEqual(['sheet:M1', 'discipline:civil']);
    expect(skippedClarifications(result, { 'discipline:civil': { reason: 'civil set not issued', by: 'J', at: '' } }))
      .toEqual(['Civil / site drawings not provided at time of bid.']);
  });
});

describe('fix round N7 — an override follows its sheet into a revised file', () => {
  it('matched by sheet number + title when the content hash changed', () => {
    const old = page('set.pdf', 2, 'A-1.1', 'FLOOR PLAN', 'architectural');
    const revised = { ...page('set-rev.pdf', 2, 'A-1.1', 'FLOOR PLAN', 'architectural'), key: 'newsha#2' };
    const ov = { [old.key]: { decision: 'include' as const, reason: 'Receptacle layout lives here', by: 'J', at: 't', sheetNo: 'A-1.1', title: 'FLOOR PLAN' } };
    const { pages } = applySelection([page('set-rev.pdf', 1, 'E-1', 'POWER PLAN', 'electrical'), revised], ov);
    expect(pages[1]).toMatchObject({ role: 'analysis', reason: expect.stringContaining('Receptacle layout') });
  });
});
