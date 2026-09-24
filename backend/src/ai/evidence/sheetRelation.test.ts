// Evidence round 1.4 + fix round B4 — complementary layers vs the same
// devices drawn twice: sheets are ALIGNED (building outlines, else shared
// marks, else the sheet frame; never the marks' own bounding box), marks of
// a type in the same place are ONE object, and a sum needs positive
// evidence. Real Kissimmee marks and the viewport reader's boxes.
import { describe, it, expect } from 'vitest';
import { relateSheets, alignSheets, cosine, pairPoints, type RelationSheet } from './sheetRelation';
import { parseViewportReply, type SheetGeom } from './viewports';
import { resolveSheetMarks } from './viewportResolve';
import { VIEWPORT_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from '../../test/fixtures/evidence/kissimmeeBaseline';
import { displayedToPdf } from '../../estimating/pageGeometry';

const baseline = loadKissimmeeBaseline();
const G: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
const key = (p: number) => `${KISSIMMEE_FILE}#${p}`;
const pt = (xIn: number, yIn: number) => displayedToPdf(xIn * 72, yIn * 72, 0, 0, 1728, 2592, 270);

function sheet(page: number, label: string): RelationSheet {
  const vps = parseViewportReply(VIEWPORT_REPLIES[page], key(page), G)!.viewports;
  const marks = baseline.marks.filter(m => m.sheetKey === key(page)).map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y }));
  const res = resolveSheetMarks(marks, vps, G);
  return { key: key(page), label, geometry: G, viewports: vps, marks: res.counted.map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y, viewportId: m.viewportId })) };
}
/** A bare sheet (no viewports, so no building box) with marks at displayed inches. */
function bare(label: string, marks: Array<[string, number, number]>): RelationSheet {
  return { key: label, label, geometry: G, viewports: null, marks: marks.map(([t, x, y]) => ({ typeKey: t, ...pt(x, y) })) };
}

describe('Kissimmee E-1 "Power Plan" and E-2 "Power Pole & Junction Box Locations"', () => {
  const e1 = sheet(49, 'E-1'), e2 = sheet(50, 'E-2');
  it('the two main plans align by their building outlines (E-2 is drawn 0.53" right, 0.73" up)', () => {
    const al = alignSheets(e1, e2)!;
    expect(al.kind).toBe('building');
    const p = al.map({ x: 197 / 40, y: 120 / 40 }); // E-2's north-west outer wall corner (inches)
    expect(p.x).toBeCloseTo(176 / 40, 1);
    expect(p.y).toBeCloseTo(150 / 40, 1);
  });
  it('simplex: complementary, but B-32 (E-1 west wall = E-2 #11 kneewall) is ONE outlet -> 9, not 10', () => {
    const r = relateSheets('SIMPLEX RECEPTACLE', e1, e2);
    expect(r).toMatchObject({ kind: 'complementary', paired: 1, compared: 5, combined: 9, alignment: 'building' });
    expect(r.similarity!).toBeLessThan(0.5);
    expect(r.reason).toMatch(/that one is counted once/);
  });
  it('duplex: complementary, nothing drawn on both (E-2 #11 B30 is a kick-plate outlet E-1 doesn\'t show)', () => {
    expect(relateSheets('DUPLEX RECEPTACLE / FLOOR RECEPTACLE', e1, e2)).toMatchObject({ kind: 'complementary', paired: 0, combined: 4 });
  });
  it('the same sheet against itself is a duplicate', () => {
    expect(relateSheets('GFCI', e1, { ...e1, key: 'copy', label: 'E-1 copy' }).kind).toBe('duplicate');
  });
});

describe('fix round B4 — the reviewer\'s repro: identical duplexes, different other content, NO building box', () => {
  const duplex: Array<[string, number, number]> = Array.from({ length: 10 }, (_, i) => ['DUPLEX', 6 + i * 1.5, 5 + (i % 3) * 2]);
  const s1 = bare('P-1', [...duplex, ['WP', 30, 1], ['WP', 31, 22], ...Array.from({ length: 5 }, (_, i) => ['J', 8 + i, 12] as [string, number, number])]);
  const s2 = bare('P-2', [...duplex, ...Array.from({ length: 8 }, (_, i) => ['DATA', 7 + i, 14] as [string, number, number])]);
  it('10 duplexes, not 20: the shared marks register the sheets and every duplex pairs', () => {
    const r = relateSheets('DUPLEX', s1, s2);
    expect(r.kind).toBe('duplicate');
    expect(r.paired).toBe(10);
  });
  it('the same repro drawn 2" apart on the second sheet: the vote finds the offset', () => {
    const shifted = { ...s2, marks: s2.marks.map(m => ({ ...m, ...pt(0, 0), ...(() => { const d = { x: m.x, y: m.y }; return { x: d.x - 144, y: d.y }; })() })) };
    const r = relateSheets('DUPLEX', s1, shifted);
    expect(r.alignment).toBe('marks');
    expect(r.kind).toBe('duplicate');
  });
  it('no building box, too few shared marks, different sheet size -> unclear, never a sum', () => {
    const other = { ...bare('P-3', [['DUPLEX', 6, 5], ['DATA', 9, 9]]), geometry: { ...G, widthPt: 2592, heightPt: 3456 } };
    expect(relateSheets('DUPLEX', s1, other).kind).toBe('unclear');
  });
  it('the sheet frame (same size and scale) pairs within 1": a second duplex 0.9" off is the same object', () => {
    const a = bare('F-1', [['DUPLEX', 10, 10], ['J', 3, 3]]);
    const b = bare('F-2', [['DUPLEX', 10.6, 9.35], ['DATA', 20, 20]]);
    const r = relateSheets('DUPLEX', a, b);
    expect(r).toMatchObject({ alignment: 'frame', paired: 1 });
    expect(r.kind).toBe('duplicate');
  });
  it('similar content with marks that don\'t line up is unclear (two parts of a level drawn at other page positions); a 20" "offset" is never a registration', () => {
    const a = bare('W', [['DUPLEX', 5, 5], ['DUPLEX', 6, 5], ['J', 3, 3], ['J', 4, 3], ['J', 5, 3]]);
    const b = bare('E', [['DUPLEX', 25, 5], ['DUPLEX', 26, 5], ['J', 23, 3], ['J', 24, 3], ['J', 22, 3]]);
    expect(relateSheets('DUPLEX', a, b).kind).toBe('unclear');
  });
});

describe('helpers', () => {
  it('cosine and one-to-one pairing', () => {
    expect(cosine(new Map([['A', 1]]), new Map([['B', 1]]))).toBe(0);
    expect(cosine(new Map([['A', 2]]), new Map([['A', 5]]))).toBeCloseTo(1);
    expect(cosine(new Map(), new Map([['A', 1]]))).toBeNull();
    expect(pairPoints([{ x: 0.1, y: 0.1 }, { x: 0.11, y: 0.1 }], [{ x: 0.1, y: 0.1 }], 0.06)).toBe(1);
  });
});
