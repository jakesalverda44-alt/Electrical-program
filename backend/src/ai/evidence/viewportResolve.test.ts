// Evidence round 1.2 / 1.3 — marks attributed to viewports and enlarged plans
// reconciled with the main plan, on the Opus counter's REAL Kissimmee marks.
import { describe, it, expect } from 'vitest';
import { parseViewportReply, type SheetGeom, type Viewport } from './viewports';
import { resolveSheetMarks, viewportPromptBlock } from './viewportResolve';
import { VIEWPORT_REPLIES, E1_RESTROOM_REPEATS } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';
const baseline = loadKissimmeeBaseline();

const E = (page: number) => `1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf#${page}`;
const G: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
const marks = (page: number) => baseline.marks
  .filter(m => m.sheetKey === E(page)).map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y }));
const vps = (page: number) => parseViewportReply(VIEWPORT_REPLIES[page], E(page), G)!.viewports;
const count = (ms: Array<{ typeKey: string }>, t: string) => ms.filter(m => m.typeKey === t).length;

describe('E-1 — the restroom enlarged plan (#3) and its dashed area on the main plan', () => {
  // The new counter instruction reports the two GFCIs the enlarged plan
  // repeats (B-26, B-13) as well as the four only it shows.
  const input = [...marks(49), ...E1_RESTROOM_REPEATS.map(r => ({ typeKey: r.type, x: r.x, y: r.y }))];
  const res = resolveSheetMarks(input, vps(49), G);
  it('GFCI: main plan shows 2 in the area, the enlarged plan 6 — the enlarged plan\'s 6 are used there, never summed', () => {
    const d = res.enlarged.find(x => x.typeKey === 'GFCI')!;
    expect(d.decision).toBe('enlarged_replaces_area');
    expect(d.mainInArea).toBe(2);
    expect(d.enlarged).toBe(6);
    // 1 GFCI on the main plan outside the restroom area + 6.
    expect(count(res.counted, 'GFCI')).toBe(7);
    expect(res.excluded.filter(m => m.typeKey === 'GFCI')).toHaveLength(2);
    expect(res.excluded.find(m => m.typeKey === 'GFCI')!.reason).toMatch(/counted there/);
  });
  it('types only the enlarged plan shows are taken from it; nothing lands in a legend', () => {
    expect(res.enlarged.find(x => x.typeKey === 'EXHAUST FAN RECESSED')!.decision).toBe('take_enlarged');
    expect(res.pending).toEqual([]);
    expect(count(res.counted, 'WP GFI')).toBe(4);
  });
  it('the Opus-baseline shape (detail-only GFCIs only) still gives 5, and says why', () => {
    const r2 = resolveSheetMarks(marks(49), vps(49), G);
    expect(count(r2.counted, 'GFCI')).toBe(1 + 4);
  });
});

describe('E-2 — the office area plan (#11) where the main plan shows no receptacles', () => {
  const res = resolveSheetMarks(marks(50), vps(50), G);
  it('takes the enlarged plan\'s receptacles ("see detail")', () => {
    expect(res.enlarged.filter(x => x.decision === 'take_enlarged').map(x => x.typeKey).sort()).toEqual(['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 'SIMPLEX RECEPTACLE']);
    expect(count(res.counted, 'SIMPLEX RECEPTACLE')).toBe(5);
    expect(count(res.counted, 'P')).toBe(6);
    expect(res.counted.every(m => m.viewportId)).toBe(true);
  });
});

describe('legend / schedule / detail marks are never devices', () => {
  const g = G;
  const v = vps(50);
  const legend = v.find(x => x.number === '9')!;
  const detail = v.find(x => x.number === '4')!;
  const centre = (vp: Viewport) => ({ x: vp.bboxPt.x0 + (vp.bboxPt.x1 - vp.bboxPt.x0) / 2, y: vp.bboxPt.y0 + (vp.bboxPt.y1 - vp.bboxPt.y0) / 2 });
  it('excludes them with the viewport and the reason', () => {
    const res = resolveSheetMarks([{ typeKey: 'SIMPLEX RECEPTACLE', ...centre(legend) }, { typeKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', ...centre(detail) }], v, g);
    expect(res.counted).toEqual([]);
    expect(res.excluded.map(e => e.viewportKind)).toEqual(['legend', 'detail']);
    expect(res.excluded[0].reason).toMatch(/POWER POLE LEGEND — a legend symbol is not a device/);
  });
  it('without a main plan viewport nothing changes (the sheet counts as one plan, as before)', () => {
    const res = resolveSheetMarks(marks(50), v.filter(x => x.kind !== 'main_plan'), g);
    expect(res.counted).toHaveLength(marks(50).length);
    expect(res.notes[0]).toMatch(/No main plan viewport/);
    expect(resolveSheetMarks(marks(50), null, g).counted).toHaveLength(marks(50).length);
  });
});

describe('an enlarged plan whose area on the main plan is unknown', () => {
  it('main plan shows the type elsewhere -> kept for now and ASKED (both counts), never summed silently', () => {
    const v = vps(49).map(x => (x.number === '3' ? { ...x, areaOnMain: undefined } : x));
    const input = [...marks(49), ...E1_RESTROOM_REPEATS.map(r => ({ typeKey: r.type, x: r.x, y: r.y }))];
    const res = resolveSheetMarks(input, v, G);
    const d = res.enlarged.find(x => x.typeKey === 'GFCI')!;
    expect(d.decision).toBe('ask');
    expect(count(res.counted, 'GFCI')).toBe(3);
    expect(res.pending.find(p => p.typeKey === 'GFCI')!.marks).toHaveLength(6);
  });
});

describe('the counter is told the sheet\'s viewports', () => {
  it('lists each viewport and says to count every plan viewport, never a legend', () => {
    const block = viewportPromptBlock(vps(50), s => s);
    expect(block).toContain('#11 OFFICE AREA POWER PLAN — enlarged plan');
    expect(block).toContain('#9 POWER POLE LEGEND — legend');
    expect(block).toMatch(/Never count symbols inside a legend, schedule or notes block/);
    expect(viewportPromptBlock([], s => s)).toBe('');
  });
});
