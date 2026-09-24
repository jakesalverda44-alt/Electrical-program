// Evidence round 1.4 — complementary layers vs the same devices drawn twice,
// decided from the sheets' own content and mark placement (the Opus
// counter's REAL Kissimmee marks and the viewport reader's boxes).
import { describe, it, expect } from 'vitest';
import { relateSheets, cosine, pairCount, type RelationSheet } from './sheetRelation';
import { parseViewportReply, type SheetGeom } from './viewports';
import { resolveSheetMarks } from './viewportResolve';
import { VIEWPORT_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline, KISSIMMEE_FILE } from '../../test/fixtures/evidence/kissimmeeBaseline';

const baseline = loadKissimmeeBaseline();
const G: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
const key = (p: number) => `${KISSIMMEE_FILE}#${p}`;

function sheet(page: number, label: string, opts: { viewports?: boolean } = {}): RelationSheet {
  const vps = opts.viewports === false ? null : parseViewportReply(VIEWPORT_REPLIES[page], key(page), G)!.viewports;
  const marks = baseline.marks.filter(m => m.sheetKey === key(page)).map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y }));
  const res = resolveSheetMarks(marks, vps, G);
  return { key: key(page), label, geometry: G, viewports: vps, marks: res.counted.map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y, viewportId: m.viewportId })) };
}

describe('Kissimmee E-1 "Power Plan" and E-2 "Power Pole & Junction Box Locations"', () => {
  const e1 = sheet(49, 'E-1'), e2 = sheet(50, 'E-2');
  it('receptacles: complementary — E-2\'s office receptacles (enlarged #11) are not E-1\'s', () => {
    const r = relateSheets('SIMPLEX RECEPTACLE', e1, e2);
    expect(r.kind).toBe('complementary');
    expect(r.paired).toBe(0);
    expect(r.similarity!).toBeLessThan(0.5);
    expect(relateSheets('DUPLEX RECEPTACLE / FLOOR RECEPTACLE', e1, e2).kind).toBe('complementary');
  });
  it('the same sheet against itself is a duplicate (every mark pairs)', () => {
    const r = relateSheets('GFCI', e1, { ...e1, key: 'copy', label: 'E-1 copy' });
    expect(r.kind).toBe('duplicate');
    expect(r.paired).toBe(r.compared);
  });
  it('a re-issued sheet drawn at a shifted position still pairs (footprint alignment)', () => {
    // The whole E-1 plan redrawn 2" to the right and 1" down: displayed +x is
    // PDF -y on this /Rotate 270 page, displayed +y is PDF -x.
    const shifted: RelationSheet = {
      ...e1, key: 'shifted', label: 'E-1 rev',
      viewports: e1.viewports!.map(v => ({ ...v, rectIn: { ...v.rectIn, left: v.rectIn.left + 2, top: v.rectIn.top + 1 }, ...(v.buildingIn ? { buildingIn: { ...v.buildingIn, left: v.buildingIn.left + 2, top: v.buildingIn.top + 1 } } : {}) })),
      marks: e1.marks.map(m => ({ ...m, x: m.x - 72, y: m.y - 144 })),
    };
    expect(relateSheets('WP GFI', e1, shifted).kind).toBe('duplicate');
  });
  it('without positions it is unclear (the old blocking question stays)', () => {
    const noGeo = { ...e2, geometry: null };
    expect(relateSheets('SIMPLEX RECEPTACLE', e1, noGeo).kind).toBe('unclear');
  });
  it('similar content with non-overlapping marks is unclear (two parts of a level?), never summed silently', () => {
    const west: RelationSheet = { ...e1, key: 'w', label: 'W', viewports: null, marks: e1.marks.filter(m => m.typeKey !== 'SIMPLEX RECEPTACLE') };
    const east: RelationSheet = { ...west, key: 'e', label: 'E', marks: [...west.marks, ...e1.marks.filter(m => m.typeKey === 'SIMPLEX RECEPTACLE').slice(0, 2)] };
    const westSimplex: RelationSheet = { ...west, marks: [...west.marks, ...e1.marks.filter(m => m.typeKey === 'SIMPLEX RECEPTACLE').slice(2)] };
    expect(relateSheets('SIMPLEX RECEPTACLE', westSimplex, east).kind).toBe('unclear');
  });
});

describe('helpers', () => {
  it('cosine and one-to-one pairing', () => {
    expect(cosine(new Map([['A', 1]]), new Map([['B', 1]]))).toBe(0);
    expect(cosine(new Map([['A', 2]]), new Map([['A', 5]]))).toBeCloseTo(1);
    expect(cosine(new Map(), new Map([['A', 1]]))).toBeNull();
    expect(pairCount([{ x: 0.1, y: 0.1 }, { x: 0.11, y: 0.1 }], [{ x: 0.1, y: 0.1 }])).toBe(1);
  });
});
