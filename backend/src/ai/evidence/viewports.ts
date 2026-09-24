// Evidence round 1.1 — drawing viewports on a sheet. Pure.
//
// A plan sheet is several drawings: the main plan, enlarged plans ("3
// RESTROOM POWER AND LIGHTING 1/4" = 1'-0""), details, schedules, legends
// and note blocks, each with a title bar (bubble number + title + scale) at
// its bottom-left. The counter's marks are attributed to these viewports
// (1.2): a symbol in a legend or schedule is never a device, an enlarged
// plan's symbols are reconciled with the main plan (1.3), and a legend's
// per-unit packages become typicals (Part 2).
//
// Two sources, one shape:
//   * the TEXT LAYER when the drawing area has one (most CAD PDFs):
//     viewportsFromText — title lines + scale lines, cells partitioned from
//     the title positions (a viewport's title sits at its bottom-left);
//   * VISION on the sheet overview when it has none (Kissimmee E-1/E-2:
//     only the title-block text is real text): parseViewportReply reads
//     the model's strict JSON, validated here.
// Rectangles are kept in DISPLAYED inches (what the renderer and the model
// see, origin top-left) and in PDF user-space points (est_markups space).
import { displayedSize, displayedToPdf, screenPosition } from '../../estimating/pageGeometry';
import { parseAIJSON } from '../json';

export type ViewportKind = 'main_plan' | 'enlarged_plan' | 'detail' | 'schedule' | 'legend' | 'notes' | 'other';

export const VIEWPORT_KINDS: ViewportKind[] = ['main_plan', 'enlarged_plan', 'detail', 'schedule', 'legend', 'notes', 'other'];

/** Kinds whose symbols are drawn devices (counted). */
export const PLAN_KINDS = new Set<ViewportKind>(['main_plan', 'enlarged_plan']);
/** Kinds whose symbols are NEVER devices (1.2). */
export const NEVER_COUNTED_KINDS = new Set<ViewportKind>(['schedule', 'legend', 'notes']);
/** Kinds that may hold per-unit packages / schedule rows (Parts 2-3). */
export const TEXTUAL_KINDS = new Set<ViewportKind>(['schedule', 'legend', 'notes']);

export interface RectIn { left: number; top: number; width: number; height: number }
export interface BoxPt { x0: number; y0: number; x1: number; y1: number }

export interface SheetGeom {
  widthPt: number; heightPt: number; originX: number; originY: number; rotation: number;
}

export interface Viewport {
  /** `${sheetKey}@${number}` or `${sheetKey}@u<i>` for an unnumbered one. */
  id: string;
  number: string;
  title: string;
  scale: string;
  kind: ViewportKind;
  /** Displayed inches from the displayed page's top-left. */
  rectIn: RectIn;
  /** PDF user-space points (min/max), origin- and rotation-aware. */
  bboxPt: BoxPt;
  source: 'text' | 'vision';
  /** enlarged_plan only: the region of the MAIN plan it enlarges (displayed
   *  inches), when the drawing shows it (a callout bubble / dashed boundary). */
  areaOnMain?: RectIn;
  /** main / enlarged plan: the building footprint (displayed inches), for
   *  the coarse sheet-to-sheet alignment of 1.4. */
  buildingIn?: RectIn;
  /** Inches of drawing per foot of building (1/8" = 1'-0" -> 0.125), null
   *  when not stated / NTS. */
  inPerFt: number | null;
}

export interface SheetViewports {
  sheetKey: string;
  source: 'text' | 'vision' | 'none';
  viewports: Viewport[];
  /** Why detection produced nothing usable (the counter then counts the
   *  whole sheet as one plan, as before). */
  note?: string;
}

/** "#3 RESTROOM POWER AND LIGHTING" / "PANEL A". */
export function viewportLabel(v: Pick<Viewport, 'number' | 'title'>): string {
  return `${v.number ? `#${v.number} ` : ''}${v.title || 'untitled viewport'}`.trim();
}

// ── Titles, scales and kinds ───────────────────────────────────────────────

/** "1/8" = 1'-0"" -> 0.125; "1" = 20'" -> 0.05; NTS / unreadable -> null. */
export function parseScale(raw: string): number | null {
  const s = raw.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/\s+/g, '');
  let m = /^(\d+)\/(\d+)"=1'(?:-0"?)?$/i.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  m = /^(\d+(?:\.\d+)?)"=1'(?:-0"?)?$/i.exec(s);
  if (m) return Number(m[1]);
  m = /^1"=(\d+(?:\.\d+)?)'(?:-0"?)?$/i.exec(s);
  if (m) return 1 / Number(m[1]);
  return null;
}

export const SCALE_RE = /(\d+\/\d+|\d+(?:\.\d+)?)\s*["”″]\s*=\s*\d+\s*['’′]\s*(?:-\s*\d+\s*["”″]?)?|\bN\.?T\.?S\.?\b|NOT TO SCALE/i;

/** The kind a title implies, or null when the title alone can't say (a plan
 *  title — main vs enlarged is decided per sheet, see settleKinds). */
export function kindFromTitle(title: string): ViewportKind | 'plan' | null {
  const t = title.toUpperCase();
  if (/\bLEGEND\b|\bSYMBOLS?\b|\bABBREVIATIONS\b/.test(t)) return 'legend';
  if (/\bSCHEDULES?\b|\bPANEL\s+[A-Z0-9]{1,4}\b|\bPANELBOARD\b|\bLOAD\s+(?:TOTALS?|SUMMARY|CALC)/.test(t)) return 'schedule';
  if (/\bNOTES?\b/.test(t) && !/\bPLAN\b/.test(t)) return 'notes';
  if (/\bDETAILS?\b|\bSECTIONS?\b|\bELEVATIONS?\b|\bRISER\b|\bONE[\s-]?LINE\b|\bDIAGRAMS?\b|\bREQS\b|\bREQUIREMENTS\b|\bTYPICAL\b|\bPOWER\s+POLE\s*#?\s*\d/.test(t)) return 'detail';
  if (/\bPLANS?\b|\bLOCATIONS\b|\bLAYOUT\b/.test(t)) return 'plan';
  return null;
}

function area(r: RectIn): number { return Math.max(0, r.width) * Math.max(0, r.height); }

/** Pure: final kinds for one sheet's viewports.
 *  * A title that says legend / schedule / notes wins over what the model
 *    said (those are never counted — the safe direction).
 *  * Exactly the plan viewports keep plan kinds; the LARGEST is the main
 *    plan. Another plan viewport stays main only when it is nearly as big
 *    (>= 60%) at the same scale (two halves / two levels on one sheet);
 *    otherwise it is an enlarged plan. */
export function settleKinds(vps: Viewport[]): Viewport[] {
  const out = vps.map(v => {
    const byTitle = kindFromTitle(v.title);
    if (byTitle && byTitle !== 'plan' && NEVER_COUNTED_KINDS.has(byTitle)) return { ...v, kind: byTitle };
    if (byTitle === 'detail' && !PLAN_KINDS.has(v.kind)) return { ...v, kind: 'detail' as const };
    if (byTitle === 'plan' && !PLAN_KINDS.has(v.kind) && v.kind !== 'detail') return { ...v, kind: 'enlarged_plan' as const };
    return v;
  });
  const plans = out.filter(v => PLAN_KINDS.has(v.kind));
  if (!plans.length) return out;
  const main = plans.reduce((a, b) => (area(b.rectIn) > area(a.rectIn) ? b : a));
  return out.map(v => {
    if (!PLAN_KINDS.has(v.kind)) return v;
    if (v === main) return { ...v, kind: 'main_plan' as const };
    const sameScale = v.inPerFt != null && main.inPerFt != null && Math.abs(v.inPerFt - main.inPerFt) < 1e-9;
    const big = area(v.rectIn) >= 0.6 * area(main.rectIn);
    return { ...v, kind: (big && (sameScale || v.inPerFt == null)) ? 'main_plan' as const : 'enlarged_plan' as const };
  });
}

// ── Geometry helpers ───────────────────────────────────────────────────────

export function displayedInches(g: SheetGeom): { width: number; height: number } {
  const s = displayedSize(g.widthPt, g.heightPt, g.rotation);
  return { width: s.width / 72, height: s.height / 72 };
}

/** Displayed-inch rectangle -> PDF user-space box. */
export function rectInToBoxPt(r: RectIn, g: SheetGeom): BoxPt {
  const a = displayedToPdf(r.left * 72, r.top * 72, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  const b = displayedToPdf((r.left + r.width) * 72, (r.top + r.height) * 72, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { x0: r2(Math.min(a.x, b.x)), y0: r2(Math.min(a.y, b.y)), x1: r2(Math.max(a.x, b.x)), y1: r2(Math.max(a.y, b.y)) };
}

/** PDF point -> displayed inches. */
export function pdfToDisplayedIn(x: number, y: number, g: SheetGeom): { x: number; y: number } {
  const p = screenPosition(x, y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  return { x: p.x / 72, y: p.y / 72 };
}

export function rectContains(r: RectIn, x: number, y: number, pad = 0): boolean {
  return x >= r.left - pad && x <= r.left + r.width + pad && y >= r.top - pad && y <= r.top + r.height + pad;
}

/** Pure (1.2): the viewport a point (displayed inches) belongs to — the
 *  SMALLEST containing viewport (an enlarged plan drawn inside the main
 *  plan's rectangle belongs to the enlarged plan), within 0.05". */
export function viewportAt(vps: Viewport[], x: number, y: number): Viewport | null {
  let best: Viewport | null = null;
  for (const v of vps) {
    if (!rectContains(v.rectIn, x, y, 0.05)) continue;
    if (!best || area(v.rectIn) < area(best.rectIn)) best = v;
  }
  return best;
}

// ── Vision: reply parsing ──────────────────────────────────────────────────

function normBox(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map(Number);
  if (n.some(x => !Number.isFinite(x))) return null;
  const [x0, y0, x1, y1] = n.map(x => Math.min(1, Math.max(0, x)));
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
  if (n.some(x => x < -0.02 || x > 1.02)) return null;
  return [x0, y0, x1, y1];
}

function boxToRect(b: [number, number, number, number], page: { width: number; height: number }): RectIn {
  return { left: b[0] * page.width, top: b[1] * page.height, width: (b[2] - b[0]) * page.width, height: (b[3] - b[1]) * page.height };
}

function iou(a: RectIn, b: RectIn): number {
  const x0 = Math.max(a.left, b.left), y0 = Math.max(a.top, b.top);
  const x1 = Math.min(a.left + a.width, b.left + b.width), y1 = Math.min(a.top + a.height, b.top + b.height);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = area(a) + area(b) - inter;
  return u > 0 ? inter / u : 0;
}

function clean(s: unknown, max = 120): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface ParsedViewportReply { viewports: Viewport[]; rejected: string[] }

/** Pure: the viewport model's strict JSON -> validated viewports. Boxes are
 *  fractions of the overview image (= the whole displayed page). Anything
 *  malformed is rejected WITH a reason; a reply with no usable plan
 *  viewport returns null (the caller falls back to "whole sheet"). */
export function parseViewportReply(text: string, sheetKey: string, g: SheetGeom): ParsedViewportReply | null {
  const parsed = parseAIJSON(text);
  const raw = parsed && Array.isArray(parsed.viewports) ? parsed.viewports as unknown[] : null;
  if (!raw) return null;
  const page = displayedInches(g);
  const rejected: string[] = [];
  const out: Viewport[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') { rejected.push(`#${i}: not an object`); return; }
    const r = item as Record<string, unknown>;
    const box = normBox(r.box);
    if (!box) { rejected.push(`#${i}: bad box`); return; }
    const title = clean(r.title);
    const kindRaw = clean(r.kind, 20).toLowerCase() as ViewportKind;
    const kind: ViewportKind = VIEWPORT_KINDS.includes(kindRaw) ? kindRaw : 'other';
    const number = clean(r.number, 6).replace(/[^A-Za-z0-9.]/g, '');
    const scale = clean(r.scale, 40);
    const rectIn = boxToRect(box, page);
    if (out.some(o => iou(o.rectIn, rectIn) > 0.8)) { rejected.push(`#${i}: duplicate of an earlier viewport`); return; }
    const area0 = r.area_on_main !== undefined && r.area_on_main !== null ? normBox(r.area_on_main) : null;
    const bld = r.building !== undefined && r.building !== null ? normBox(r.building) : null;
    out.push({
      id: `${sheetKey}@${number || `u${i + 1}`}`,
      number, title, scale, kind, rectIn,
      bboxPt: rectInToBoxPt(rectIn, g),
      source: 'vision',
      ...(area0 ? { areaOnMain: boxToRect(area0, page) } : {}),
      ...(bld ? { buildingIn: boxToRect(bld, page) } : {}),
      inPerFt: parseScale(scale),
    });
  });
  // Ids must be unique on the sheet (two unnumbered "PANEL A" / "PANEL B").
  const seen = new Map<string, number>();
  for (const v of out) {
    const n = (seen.get(v.id) ?? 0) + 1;
    seen.set(v.id, n);
    if (n > 1) v.id = `${v.id}.${n}`;
  }
  return { viewports: settleKinds(out), rejected };
}

// ── Text layer ─────────────────────────────────────────────────────────────

/** One text run in DISPLAYED points (origin top-left, y down). */
export interface TextRun { str: string; x: number; y: number; w: number; h: number }

/** Pure: runs -> lines (same baseline within 30% of the text height, gaps
 *  under 1.5 text heights joined with a space). */
export function linesFromRuns(runs: TextRun[]): TextRun[] {
  const sorted = runs.filter(r => r.str.trim()).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextRun[] = [];
  for (const r of sorted) {
    const line = lines.find(l => Math.abs(l.y - r.y) <= 0.3 * Math.max(l.h, r.h) && r.x >= l.x + l.w - 0.5 * r.h && r.x - (l.x + l.w) <= 1.5 * Math.max(l.h, r.h));
    if (line) {
      const gap = r.x - (line.x + line.w);
      line.str = `${line.str}${gap > 0.15 * r.h ? ' ' : ''}${r.str}`;
      line.w = Math.max(line.w, r.x + r.w - line.x);
      line.h = Math.max(line.h, r.h);
    } else {
      lines.push({ ...r });
    }
  }
  return lines.map(l => ({ ...l, str: l.str.replace(/\s+/g, ' ').trim() }));
}

const TITLE_LINE_RE = /^(\d{1,2})\s*[|:.-]?\s+([A-Z][A-Z0-9 ,&/'"#().\-]{3,90})$/;

/** Pure: viewports from the text layer. A title line is "<n> <TITLE>" in
 *  capitals, or an unnumbered "PANEL x" / "...SCHEDULE" / "...LEGEND"
 *  heading, and it must be larger than the sheet's typical note text or sit
 *  next to a scale note. Cells: a viewport spans from its title's left edge
 *  to the next title to the right on the same row (or the content edge),
 *  and from its title up to the nearest title row above that overlaps it
 *  horizontally (or the top margin). Returns [] when no title is found. */
export function viewportsFromText(runs: TextRun[], sheetKey: string, g: SheetGeom, opts: { titleBlockFrac?: number } = {}): Viewport[] {
  const page = displayedInches(g);
  const contentRight = page.width * (1 - (opts.titleBlockFrac ?? 0.1)) * 72;
  const lines = linesFromRuns(runs).filter(l => l.x < contentRight);
  if (!lines.length) return [];
  const heights = lines.map(l => l.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const scaleLines = lines.filter(l => SCALE_RE.test(l.str) && l.str.length <= 40);
  type Title = { line: TextRun; number: string; title: string; scale: string };
  const titles: Title[] = [];
  for (const l of lines) {
    const m = TITLE_LINE_RE.exec(l.str);
    const unnumbered = !m && /^(PANEL\s+[A-Z0-9]{1,4}|[A-Z][A-Z0-9 &/\-]{2,60}\b(SCHEDULE|LEGEND|NOTES|TOTALS))$/.test(l.str);
    if (!m && !unnumbered) continue;
    // A scale note within 2.5 title heights (above or below), overlapping horizontally.
    const scale = scaleLines.find(s => Math.abs(s.y - l.y) <= 2.5 * Math.max(l.h, s.h) && s.x <= l.x + l.w && s.x + s.w >= l.x - 3 * l.h);
    if (!scale && l.h < 1.4 * median) continue;
    titles.push({ line: l, number: m ? m[1] : '', title: (m ? m[2] : l.str).trim(), scale: scale ? (SCALE_RE.exec(scale.str)?.[0] ?? '') : '' });
  }
  if (!titles.length) return [];
  const rowTol = 0.5 * 72;
  const out: Viewport[] = titles.map((t, i) => {
    const left = Math.max(0, t.line.x - 0.4 * 72);
    const right = Math.min(contentRight, ...titles.filter(o => o !== t && Math.abs(o.line.y - t.line.y) <= rowTol && o.line.x > t.line.x).map(o => o.line.x - 0.4 * 72));
    const bottom = t.line.y + t.line.h;
    const aboveTops = titles.filter(o => o !== t && o.line.y + o.line.h < t.line.y - rowTol / 2)
      .filter(o => {
        const oLeft = o.line.x - 0.4 * 72;
        const oRight = Math.min(contentRight, ...titles.filter(p => p !== o && Math.abs(p.line.y - o.line.y) <= rowTol && p.line.x > o.line.x).map(p => p.line.x - 0.4 * 72));
        return oLeft < right && oRight > left;
      })
      .map(o => o.line.y + o.line.h);
    const top = aboveTops.length ? Math.max(...aboveTops) : 0.25 * 72;
    const rectIn: RectIn = { left: left / 72, top: top / 72, width: (right - left) / 72, height: (bottom - top) / 72 };
    const byTitle = kindFromTitle(t.title);
    const kind: ViewportKind = byTitle === 'plan' ? 'enlarged_plan' : byTitle ?? 'other';
    return {
      id: `${sheetKey}@${t.number || `u${i + 1}`}`,
      number: t.number, title: t.title, scale: t.scale, kind, rectIn,
      bboxPt: rectInToBoxPt(rectIn, g), source: 'text' as const, inPerFt: parseScale(t.scale),
    };
  }).filter(v => v.rectIn.width > 0.5 && v.rectIn.height > 0.5);
  return settleKinds(out);
}

/** Pure: raw pdf.js text items -> displayed-point runs. The run's baseline
 *  segment is mapped through the page rotation, so text drawn vertically in
 *  user space on a /Rotate 270 sheet reads as a horizontal run. */
export function runsFromPdfItems(
  items: Array<{ str: string; transform: number[]; width?: number; height?: number }>,
  g: SheetGeom,
): TextRun[] {
  const out: TextRun[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const len = it.width ?? size * 0.5 * it.str.length;
    const dir = Math.hypot(a, b) || 1;
    const p0 = screenPosition(e, f, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
    const p1 = screenPosition(e + (a / dir) * len, f + (b / dir) * len, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
    // Only runs that read left-to-right on the displayed page are titles/notes.
    if (p1.x - p0.x < Math.abs(p1.y - p0.y)) continue;
    out.push({ str: it.str, x: p0.x, y: p0.y - size, w: p1.x - p0.x, h: size });
  }
  return out;
}

/** Characters of real text inside the drawing area (title block excluded):
 *  under this the sheet is treated as having NO text layer (vision path). */
export const MIN_DRAWING_TEXT_CHARS = 150;

export function drawingTextChars(runs: TextRun[], g: SheetGeom, titleBlockFrac = 0.1): number {
  const right = displayedInches(g).width * (1 - titleBlockFrac) * 72;
  return runs.filter(r => r.x + r.w <= right).reduce((s, r) => s + r.str.trim().length, 0);
}
