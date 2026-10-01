// Accuracy round, fix round 1 (Opus review of Builder R) — the shared-host
// (power pole) count and its questions: B-2 (levels / unalignable sheets),
// S1 (same-type marks never merge), S2 (found > stated), S6 (honest unlocated
// labels), and the nits (hostTagOf, pipePoles answer matching).
import { describe, it, expect } from 'vitest';
import { hostFamilyCount, type SheetCountInput } from '../countMerge';
import { distinctHosts, type HostAssignmentGroup, type HostMark } from './typicals';
import { hostTagOf } from '../counter';
import { buildReviewItems, enforcedCounts, type ReviewItem } from '../reviewItems';
import type { CountResult } from '../countingStage';

const sheet = (key: string, level: string, marks: Array<{ typeKey: string; x: number; y: number }>): SheetCountInput => ({
  sheet: { key, label: `${key} PLAN`, level } as never, status: 'counted', placed: marks, unreadable: [], geometry: null,
});
const mainPos = (_s: SheetCountInput, m: { x?: number; y?: number }) => ({ x: m.x!, y: m.y! });
const rel = (s: SheetCountInput) => ({ key: s.sheet.key, label: s.sheet.label, geometry: s.geometry ?? null, viewports: null, marks: [] as never[] });
const count = (sheets: SheetCountInput[]) => hostFamilyCount('PP', new Set(['PP']), sheets, mainPos as never, rel as never, () => true);
const pts = (n: number, y = 5) => Array.from({ length: n }, (_, i) => ({ typeKey: 'PP', x: 3 + i * 4, y }));

describe('B-2 — shared-host sheets: levels and unalignable sheets', () => {
  it('a sheet on ANOTHER level adds its hosts (distinct floors, never dropped)', () => {
    const r = count([sheet('E-1', 'L1', pts(4)), sheet('E-2', 'L2', pts(3))]);
    expect(r.marks.length).toBe(7);
    expect(r.unaligned).toEqual([]);
    expect(r.note).toMatch(/E-2.*another level, added/);
  });

  it('a same-level sheet that cannot be lined up is never dropped: its marks are listed and reported', () => {
    const r = count([sheet('E-1', 'L1', pts(4)), sheet('E-2', 'L1', pts(3, 30))]);
    expect(r.unaligned).toEqual([{ sheetLabel: 'E-2', refLabel: 'E-1', hosts: 3, refHosts: 4, sheetKey: 'E-2' }]);
    expect(r.marks.length).toBe(7); // listed in their own frame, never merged with E-1's
    expect(r.note).toMatch(/E-2 could not be lined up with E-1/);
  });
});

describe('S1 — two marks of one type on one sheet are two poles', () => {
  it('same type, same sheet, 0.1" apart: both kept; a different type at the same place joins one pole', () => {
    const r = count([sheet('E-2', 'L1', [{ typeKey: 'PP', x: 5, y: 5 }, { typeKey: 'PP', x: 5.1, y: 5 }])]);
    expect(r.marks.length).toBe(2);
    const m = (typeKey: string, x: number, srcSheet = 'E-2'): HostMark => ({ sheetKey: 'E-2', x, y: 5, typeKey, srcSheet });
    expect(distinctHosts([m('PP', 5), m('#3', 5.1)]).length).toBe(1);
    expect(distinctHosts([m('PP', 5), m('PP', 5.1)]).length).toBe(2);
    // The same pole drawn on two aligned sheets (same key, different source sheet): one.
    expect(distinctHosts([m('PP', 5, 'E-1'), m('PP', 5.1, 'E-2')]).length).toBe(1);
    // Marks with no type info keep the old behavior.
    expect(distinctHosts([{ sheetKey: 'E-2', x: 1, y: 1 }, { sheetKey: 'E-2', x: 1.2, y: 1 }]).length).toBe(1);
  });
});

describe('nit — hostTagOf', () => {
  it('"#A-33" is circuit A-33, never tag "A"; numbers still bind', () => {
    expect(hostTagOf('#A-33')).toEqual({ rest: 'A-33' });
    expect(hostTagOf('#3 A-33')).toEqual({ tag: '3', rest: 'A-33' });
    expect(hostTagOf('#3')).toEqual({ tag: '3', rest: '' });
    expect(hostTagOf('#12B')).toMatchObject({ tag: '12B' });
    expect(hostTagOf('A-33')).toEqual({ rest: 'A-33' });
  });
});

const group = (over: Partial<HostAssignmentGroup>): HostAssignmentGroup => ({
  hostKey: 'PP-1..6', hostNoun: 'power pole', hostCount: 6, viewportLabel: '#9 LEGEND', sheetKey: 'E-2',
  types: [1, 2, 3, 4, 6].map(n => ({ typeId: `tag:${n}`, packageId: `p${n}`, host: `Type ${n} power pole`, hostTag: String(n), quote: '', devices: [], unstated: [], suggested: null })),
  suggestion: null, drawnNearHosts: [], hosts: [], found: 0, stated: { total: 6, tags: ['1', '2', '3', '4', '5', '6'], label: 'E-2' },
  ...over,
});
const cr = (ev: Record<string, unknown>) => ({ types: [{ key: 'PP-1..6', type: 'PP-1..6', status: 'counted', count: 6, flags: [], sheets: [], category: 'equipment', description: '' }], targets: [], evidence: ev }) as unknown as CountResult;
const assign = (g: HostAssignmentGroup) => buildReviewItems(cr({ hostAssignments: [g] })).find(i => i.id === 'typicalassign:PP-1..6')!;

describe('S2 — found vs stated, said in both directions', () => {
  const hosts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `pole:E-2:${i + 1}`, sheetKey: 'E-2', sheetLabel: 'E-2', x: i, y: i }));
  it('found > stated: "E-2 states 6; 8 found" in the title, and the detail says more were found', () => {
    const it8 = assign(group({ hosts: hosts(8), found: 8, hostCount: 8 }));
    expect(it8.title).toMatch(/^E-2 states 6 power poles \(#1–#6\); 8 found on the plans/);
    expect(it8.detail).toMatch(/More power poles were found \(8\) than E-2 states \(6\)/);
  });
  it('found < stated (unchanged) and found = stated (no "states")', () => {
    const it4 = assign(group({ hosts: hosts(4), found: 4, hostCount: 4, unlocated: [{ id: 'pole:unlocated:5', tag: '5' }, { id: 'pole:unlocated:6', tag: '6' }] }));
    expect(it4.title).toMatch(/^E-2 states 6 power poles \(#1–#6\); 4 found/);
    expect(it4.detail).not.toMatch(/More power poles/);
    const it6 = assign(group({ hosts: hosts(6), found: 6 }));
    expect(it6.title).toMatch(/^6 power poles found on the plans/);
  });
});

describe('S6 — unlocated members are labelled honestly', () => {
  const six = ['1', '2', '3', '4', '5', '6'].map(t => ({ id: `pole:unlocated:${t}`, tag: t }));
  it('nothing found: "stated power pole n of 6 — not found on the plans", the tag caveat in the detail (#5 is pipes, #3 two poles — the stated tags are not one pole each)', () => {
    const a = assign(group({ unlocated: six }));
    expect(a.reconcileMembers!.map(m => m.type)).toEqual([1, 2, 3, 4, 5, 6].map(n => `stated power pole ${n} of 6 — not found on the plans`));
    expect(a.reconcileMembers![0].description).toMatch(/none were found/);
    expect(a.reconcileMembers![0].description).toMatch(/one tag can be more than one power pole, and a tag may not be a power pole at all/);
    expect(a.reconcileMembers!.map(m => m.key)).toEqual(six.map(s => s.id)); // keys unchanged
  });
  it('some found and the stated tags ARE the legend tags one-to-one: "stated power pole tag #n — not found on the plans"', () => {
    const types = [1, 2, 3, 4, 5, 6].map(n => ({ typeId: `tag:${n}`, packageId: `p${n}`, host: `T${n} power pole`, hostTag: String(n), quote: '', devices: [], unstated: [], suggested: null }));
    const a = assign(group({ types, found: 4, hostCount: 4, hosts: [], unlocated: six.slice(4) }));
    expect(a.reconcileMembers!.map(m => m.type)).toEqual(['stated power pole tag #5 — not found on the plans', 'stated power pole tag #6 — not found on the plans']);
  });
});

describe('B-2 — the unalignable-sheet question is an item', () => {
  it('a blocking two-option question with both counts', () => {
    const items = buildReviewItems(cr({ hostAlign: [{ hostKey: 'PP', hostType: 'PP', carried: 4, ifMore: 7, sheets: [{ sheetLabel: 'E-2', refLabel: 'E-1', hosts: 3, refHosts: 4 }], text: "E-2's 3 (vs E-1's 4) PP marks could not be lined up with the other sheet of the same level — same poles, or more?" }] }));
    const q = items.find(i => i.id === 'typicalalign:PP')!;
    expect(q.blocking).not.toBe(false);
    expect(q.kind).toBe('area');
    expect(q.title).toMatch(/E-2's 3 could not be lined up with E-1's 4 — same poles or more\?/);
    expect(q.detail).toMatch(/carries 4 PP/);
    expect(q.detail).toMatch(/the line is 7/);
    expect(q.group).toBe('typical');
  });
});

describe('nit — the pipepoles answer is matched without regard to case or whitespace', () => {
  it('"yes" with other spacing / case still adds the pipes; "No" adds nothing', () => {
    const c = cr({ pipePoles: [{ hostKey: 'PP-1..6', item: '3" PVC data/security pipes at pole #5', qty: 2 }] });
    const q = buildReviewItems(c).find(i => i.id.startsWith('pipepoles:'))!;
    const answered = (a: string): ReviewItem => ({ ...q, resolution: { action: 'answer', answer: a, by: 'j', at: 't' } });
    const base = enforcedCounts(c, [answered(q.options![1])]).byType.get('PP-1..6');
    expect(base).toBe(8);
    expect(enforcedCounts(c, [answered(`  ${q.options![1].toUpperCase().replace(/ /g, '   ')}  `)]).byType.get('PP-1..6')).toBe(8);
    expect(enforcedCounts(c, [answered(q.options![0])]).byType.get('PP-1..6') ?? 6).toBe(6);
  });
});
