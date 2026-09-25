// Round 3 R3-B1 — a file is NEVER excluded because another file shares its
// sheet numbers. A likely revision (same file-name stem, or >= 70% of the
// newer file's sheets matching by number AND title, with a higher revision
// / later date / a separate later upload) is only PROPOSED; only the
// estimator's "Replace" excludes the older file's matching sheets.
import { describe, it, expect } from 'vitest';
import { applySelection, detectPlanRevisions, differentBuildingOrPackage, type CheckedPage } from '../services/sheetCheck';

let n = 0;
function page(file: string, sha: string, sheetNo: string, title: string, uploadedAt: string | null): CheckedPage {
  n++;
  return {
    key: `${sha}#${n}`, file, sha, page: n, sheetNo, title, discipline: 'electrical', cls: 'plan',
    textChars: 500, hasTextLayer: true, classified: true, refs: [], role: 'excluded', reason: '', ...(uploadedAt ? { uploadedAt } : {}),
  };
}
const set = (file: string, sha: string, at: string | null, sheets: Array<[string, string]>) => sheets.map(([no, t]) => page(file, sha, no, t, at));
const E = [['E-1', 'POWER PLAN'], ['E-2', 'LIGHTING PLAN'], ['E-3', 'PANEL SCHEDULES']] as Array<[string, string]>;
const T0 = '2026-01-01T10:00:00.000Z';
const T0b = '2026-01-01T10:00:00.400Z'; // the same drop, 400 ms later
const DAY2 = '2026-01-02T10:00:00.000Z';

describe('R3-B1 — the reviewer\'s repros: nothing is excluded, nothing is proposed', () => {
  it('Building A.pdf and Building B.pdf dropped together keep every page', () => {
    const { pages, revisionProposals } = applySelection([...set('Building A.pdf', 'a', T0, E), ...set('Building B.pdf', 'b', T0b, E)], {});
    expect(revisionProposals).toEqual([]);
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
  });

  it('Building A / B uploaded on different days are still never proposed (different buildings)', () => {
    expect(differentBuildingOrPackage('Building A.pdf', 'Building B.pdf')).toBe(true);
    const { revisionProposals } = applySelection([...set('Building A.pdf', 'a', T0, E), ...set('Building B.pdf', 'b', DAY2, E)], {});
    expect(revisionProposals).toEqual([]);
  });

  it('Site Rev 3.pdf vs Building Rev 1.pdf (two packages sharing E-1) keep both', () => {
    const site = set('Site Rev 3.pdf', 's', DAY2, [['E-1', 'SITE ELECTRICAL PLAN']]);
    const bldg = set('Building Rev 1.pdf', 'b', T0, [['E-1', 'POWER PLAN'], ['E-2', 'LIGHTING PLAN']]);
    const { pages, revisionProposals } = applySelection([...bldg, ...site], {});
    expect(revisionProposals).toEqual([]);
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
  });

  it('a multi-building prototype job (same sheet numbers AND titles, one file per building) keeps every building', () => {
    const b = ['Bldg 1.pdf', 'Bldg 2.pdf', 'Bldg 3.pdf'].flatMap((f, i) => set(f, `b${i}`, `2026-01-0${i + 1}T10:00:00.000Z`, E));
    const { pages, revisionProposals } = applySelection(b, {});
    expect(revisionProposals).toEqual([]);
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
  });

  it('the same sheet number with a DIFFERENT title is kept in both files and noted', () => {
    const { pages, revisionProposals, duplicateSheets } = applySelection([
      ...set('Main.pdf', 'm', T0, [['E-1', 'POWER PLAN']]), ...set('Canopy.pdf', 'c', DAY2, [['E-1', 'CANOPY LIGHTING']]),
    ], {});
    expect(revisionProposals).toEqual([]);
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
    expect(duplicateSheets).toEqual([{ sheetNo: 'E1', files: ['Main.pdf', 'Canopy.pdf'], titles: ['POWER PLAN', 'CANOPY LIGHTING'] }]);
  });
});

describe('R3-B1 — a real revision is proposed, and only "Replace" excludes', () => {
  const rev1 = () => set('AZ Elec Rev 1.pdf', 'r1', T0, E);
  const rev2 = () => set('AZ Elec Rev 2.pdf', 'r2', T0b, E);

  it('Rev 2 of the same file name is proposed (12-sheet style count), nothing is excluded until answered', () => {
    const { pages, revisionProposals } = applySelection([...rev1(), ...rev2()], {});
    expect(revisionProposals).toHaveLength(1);
    expect(revisionProposals[0]).toMatchObject({ id: 'r1>r2', olderFile: 'AZ Elec Rev 1.pdf', newerFile: 'AZ Elec Rev 2.pdf', matchingSheets: ['E1', 'E2', 'E3'] });
    expect(revisionProposals[0].decision).toBeUndefined();
    expect(pages.every(p => p.role === 'analysis')).toBe(true);
  });

  it('"Replace" excludes the older copies; "Keep both" keeps both', () => {
    const replaced = applySelection([...rev1(), ...rev2()], {}, { 'r1>r2': { decision: 'replace', by: 'Jake', at: 't' } });
    expect(replaced.pages.filter(p => p.sha === 'r1').every(p => p.role === 'excluded' && p.replacedBy === 'AZ Elec Rev 2.pdf')).toBe(true);
    expect(replaced.pages.filter(p => p.sha === 'r2').every(p => p.role === 'analysis')).toBe(true);
    const kept = applySelection([...rev1(), ...rev2()], {}, { 'r1>r2': { decision: 'keep_both', by: 'Jake', at: 't' } });
    expect(kept.pages.every(p => p.role === 'analysis')).toBe(true);
    expect(kept.revisionProposals[0].decision?.decision).toBe('keep_both');
  });

  it('a partial addendum (E-2 only, uploaded later) replaces only E-2; E-1 / E-3 of the set stay', () => {
    const full = set('Electrical Set.pdf', 'f', T0, E);
    const add = set('Addendum 1.pdf', 'ad', DAY2, [['E-2', 'LIGHTING PLAN']]);
    const proposed = detectPlanRevisions([...full, ...add]).proposals;
    expect(proposed).toHaveLength(1);
    expect(proposed[0].matchingSheets).toEqual(['E2']);
    const { pages } = applySelection([...full, ...add], {}, { [proposed[0].id]: { decision: 'replace', by: 'Jake', at: 't' } });
    const old = pages.filter(p => p.sha === 'f');
    expect(old.find(p => p.sheetNo === 'E-2')!.role).toBe('excluded');
    expect(old.filter(p => p.sheetNo !== 'E-2').every(p => p.role === 'analysis')).toBe(true);
  });

  it('a sheet only the older file has is never excluded, even after "Replace"', () => {
    const old = set('AZ Elec Rev 1.pdf', 'r1', T0, [...E, ['E-4', 'SITE LIGHTING']]);
    const { pages } = applySelection([...old, ...set('AZ Elec Rev 2.pdf', 'r2', T0b, E)], {}, { 'r1>r2': { decision: 'replace', by: 'Jake', at: 't' } });
    expect(pages.find(p => p.sha === 'r1' && p.sheetNo === 'E-4')!.role).toBe('analysis');
  });

  it('no evidence of which is newer (same drop, different names) -> no proposal', () => {
    const { revisionProposals } = applySelection([...set('Set.pdf', 'a', T0, E), ...set('Set copy B.pdf', 'b', T0b, E)], {});
    expect(revisionProposals).toEqual([]);
  });
});
