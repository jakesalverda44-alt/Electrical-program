// Evidence round 1.1 — viewports: kinds, scales, the vision reply on the real
// Kissimmee sheets (/Rotate 270), mark attribution, and the text-layer path
// on a real PDF read through pdf.js.
import { describe, it, expect } from 'vitest';
import {
  kindFromTitle, parseScale, parseViewportReply, settleKinds, viewportAt, pdfToDisplayedIn, rectInToBoxPt,
  linesFromRuns, viewportsFromText, runsFromPdfItems, drawingTextChars, MIN_DRAWING_TEXT_CHARS, type Viewport, type SheetGeom,
} from './viewports';
import { VIEWPORT_REPLIES } from '../../test/fixtures/evidence/kissimmeeReplies';
import { loadKissimmeeBaseline } from '../../test/fixtures/evidence/kissimmeeBaseline';
const baseline = loadKissimmeeBaseline();
import { readPagesText } from './evidenceStage';
import { buildTestPdf } from '../../test/fixtures/buildTestPdf';

const E = (page: number) => `1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf#${page}`;
const G270: SheetGeom = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };

describe('titles, scales and kinds', () => {
  it('parses architectural and engineering scales; NTS is null', () => {
    expect(parseScale('1/8" = 1\'-0"')).toBe(0.125);
    expect(parseScale('1/4”=1’-0”')).toBe(0.25);
    expect(parseScale('3/32" = 1\'-0"')).toBeCloseTo(0.09375);
    expect(parseScale('1" = 20\'')).toBeCloseTo(0.05);
    expect(parseScale('Not to Scale')).toBeNull();
  });
  it('reads the kind a title implies (legend / schedule / notes win; plan titles are decided per sheet)', () => {
    expect(kindFromTitle('POWER POLE LEGEND')).toBe('legend');
    expect(kindFromTitle('POWER SCHEDULE')).toBe('schedule');
    expect(kindFromTitle('PANEL A')).toBe('schedule');
    expect(kindFromTitle('LOAD TOTALS')).toBe('schedule');
    expect(kindFromTitle('GENERAL WIRING AND POWER NOTES')).toBe('notes');
    expect(kindFromTitle('TESTER POWER POLE #4')).toBe('detail');
    expect(kindFromTitle('SCHEMATIC ONE LINE - ELECTRICAL SERVICE')).toBe('detail');
    expect(kindFromTitle('OFFICE AREA POWER PLAN')).toBe('plan');
    expect(kindFromTitle('RESTROOM POWER AND LIGHTING')).toBeNull();
  });
  it('the largest plan viewport is the main plan; a smaller one at a larger scale is enlarged; a legend titled as such never counts', () => {
    const v = (id: string, kind: Viewport['kind'], title: string, w: number, inPerFt: number | null): Viewport => ({
      id, number: id, title, scale: '', kind, rectIn: { left: 0, top: 0, width: w, height: w }, bboxPt: { x0: 0, y0: 0, x1: 1, y1: 1 }, source: 'vision', inPerFt,
    });
    const out = settleKinds([
      v('1', 'enlarged_plan', 'POWER PLAN', 20, 0.125), v('3', 'main_plan', 'RESTROOM POWER AND LIGHTING', 7, 0.25),
      v('5', 'enlarged_plan', 'POWER POLE LEGEND', 10, 0.125), v('9', 'main_plan', 'LEVEL 2 POWER PLAN', 19, 0.125),
    ]);
    expect(out.map(x => x.kind)).toEqual(['main_plan', 'enlarged_plan', 'legend', 'main_plan']);
  });
});

describe('the viewport reader\'s reply on the real Kissimmee sheets (rotated 270)', () => {
  const e1 = parseViewportReply(VIEWPORT_REPLIES[49], E(49), G270)!;
  const e2 = parseViewportReply(VIEWPORT_REPLIES[50], E(50), G270)!;
  it('E-1: main plan, restroom enlarged plan with its area on the main plan, the POWER SCHEDULE legend is a schedule', () => {
    expect(e1.rejected).toEqual([]);
    const byNo = new Map(e1.viewports.map(v => [v.number, v]));
    expect(byNo.get('1')!.kind).toBe('main_plan');
    expect(byNo.get('3')!.kind).toBe('enlarged_plan');
    expect(byNo.get('3')!.inPerFt).toBe(0.25);
    expect(byNo.get('3')!.areaOnMain).toBeTruthy();
    expect(byNo.get('5')!.kind).toBe('schedule');
    expect(byNo.get('7')!.kind).toBe('detail');
    // 36 x 24 displayed: the main plan spans ~21" x 15".
    expect(byNo.get('1')!.rectIn.width).toBeCloseTo(20.9, 0);
    expect(byNo.get('1')!.rectIn.height).toBeCloseTo(15.35, 0);
  });
  it('boxes land in PDF points on the rotated page, round-tripping through pdfToDisplayedIn', () => {
    const vp = e2.viewports.find(v => v.number === '11')!;
    const b = vp.bboxPt;
    const c1 = pdfToDisplayedIn(b.x0, b.y0, G270), c2 = pdfToDisplayedIn(b.x1, b.y1, G270);
    const xs = [c1.x, c2.x].sort((a, z) => a - z), ys = [c1.y, c2.y].sort((a, z) => a - z);
    expect(xs[0]).toBeCloseTo(vp.rectIn.left, 1);
    expect(ys[1]).toBeCloseTo(vp.rectIn.top + vp.rectIn.height, 1);
    expect(rectInToBoxPt(vp.rectIn, G270)).toEqual(b);
  });
  it('attributes the Opus counter\'s REAL marks: E-2 office receptacles fall in #11, the poles on the main plan; E-1 restroom GFCIs in #3', () => {
    const marks = baseline.marks;
    const at = (page: number, vps: Viewport[], type: string) => marks.filter(m => m.sheetKey === E(page) && m.typeKey === type)
      .map(m => { const p = pdfToDisplayedIn(m.x, m.y, G270); return viewportAt(vps, p.x, p.y)?.number ?? '-'; });
    expect(at(50, e2.viewports, 'SIMPLEX RECEPTACLE')).toEqual(['11', '11', '11', '11', '11']);
    expect(at(50, e2.viewports, 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE')).toEqual(['11']);
    expect(new Set(at(50, e2.viewports, 'P'))).toEqual(new Set(['1']));
    expect(at(49, e1.viewports, 'GFCI').sort()).toEqual(['1', '1', '1', '3', '3', '3', '3']);
  });
  it('rejects malformed entries with a reason and never invents a kind', () => {
    const bad = JSON.stringify({ viewports: [
      { number: '1', title: 'POWER PLAN', kind: 'main_plan', box: [0.1, 0.1, 0.6, 0.6] },
      { number: '2', title: 'X', kind: 'bogus', box: [0.7, 0.1, 0.9, 0.3] },
      { number: '3', title: 'Y', kind: 'detail', box: [0.5, 0.5, 0.5, 0.9] },
      { number: '4', title: 'DUP', kind: 'detail', box: [0.1, 0.1, 0.6, 0.61] },
      'nonsense',
    ] });
    const p = parseViewportReply(bad, 'k', G270)!;
    expect(p.viewports.map(v => [v.number, v.kind])).toEqual([['1', 'main_plan'], ['2', 'other']]);
    expect(p.rejected).toHaveLength(3);
    expect(parseViewportReply('{"regions":[]}', 'k', G270)).toBeNull();
  });
});

describe('the text layer path (a real PDF through pdf.js)', () => {
  it('reads a real text layer; a text page with no titled drawings is one drawing (no viewports)', async () => {
    const pdf = buildTestPdf([
      [
        'NOTES: ' + 'THE CONTRACTOR SHALL VERIFY ALL CONDITIONS IN THE FIELD. '.repeat(8),
      ].join(''),
    ]);
    const texts = await readPagesText(pdf, [1]);
    const page = texts.get(1)!;
    expect(page.runs.length).toBeGreaterThan(0);
    expect(drawingTextChars(page.runs, page.geometry)).toBeGreaterThan(MIN_DRAWING_TEXT_CHARS);
    // No "<n> TITLE" lines on this page: one drawing, no viewports.
    expect(viewportsFromText(page.runs, 'p1', page.geometry)).toEqual([]);
  });
  it('partitions a two-row layout from its title and scale runs (displayed points)', () => {
    const g: SheetGeom = { widthPt: 2592, heightPt: 1728, originX: 0, originY: 0, rotation: 0 };
    const t = (str: string, x: number, y: number, h = 18) => ({ str, x, y, w: str.length * h * 0.6, h });
    const runs = [
      t('1/8" = 1\'-0"', 60, 1080, 10), t('1 POWER PLAN', 60, 1100), t('3/4" = 1\'-0"', 1500, 1080, 10), t('4 GENERAL NOTES', 1500, 1100),
      t('1/4" = 1\'-0"', 60, 1640, 10), t('2 RESTROOM POWER PLAN', 60, 1660), t('3 POWER SCHEDULE', 900, 1660),
      t('ALL WORK PER NEC', 200, 300, 9), t('TYP.', 400, 500, 9),
    ];
    const vps = viewportsFromText(runs, 's', g);
    const by = new Map(vps.map(v => [v.number, v]));
    expect([...by.keys()].sort()).toEqual(['1', '2', '3', '4']);
    expect(by.get('1')!.kind).toBe('main_plan');
    expect(by.get('2')!.kind).toBe('enlarged_plan');
    expect(by.get('3')!.kind).toBe('schedule');
    expect(by.get('4')!.kind).toBe('notes');
    // #2 sits under #1: its top is #1's title bar; #1 runs up to the margin.
    expect(by.get('2')!.rectIn.top).toBeCloseTo((1100 + 18) / 72, 1);
    expect(by.get('1')!.rectIn.top).toBeCloseTo(0.25, 2);
    // #1 ends where #4's column starts.
    expect(by.get('1')!.rectIn.left + by.get('1')!.rectIn.width).toBeCloseTo((1500 - 0.4 * 72) / 72, 1);
    expect(linesFromRuns([t('POWER', 10, 10), t('PLAN', 10 + 5 * 18 * 0.6 + 6, 10)])[0].str).toBe('POWER PLAN');
  });
  it('maps pdf.js items through /Rotate 270: vertical user-space text reads left to right', () => {
    // On a 270 page, displayed +x is user-space +y... a run drawn along +y.
    const runs = runsFromPdfItems([{ str: 'POWER PLAN', transform: [0, -12, 12, 0, 500, 300], width: 70 }], G270);
    expect(runs).toHaveLength(1);
    expect(runs[0].w).toBeCloseTo(70, 0);
  });
});
