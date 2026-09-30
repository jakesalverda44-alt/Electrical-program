// Remodel round A1-A3 — the live 36th Street Warehouse run (2026-09-29,
// remodel) replayed through the current code. No model is called.
//
// What is REAL (the live run's own stored output): Agent 1's analysis, the
// page inventory (17 pages, A2.0 / A3.0 classified "Interior Build-Out
// Floor Plan", excluded), the evidence readers' viewports and schedule
// tables, and every mark the live counter placed on E1.0 / E2.0.
//
// What is MOCKED (it is what the MODEL answers, and A1 / A2 change what the
// model is asked — only a live re-run can prove the model reads it):
//   * each E1.0 / E2.0 mark's status — E1.0 prints "SHADED SYMBOL DENOTES
//     NEW RECEPTACLE"; Chris's takeoff has 5 new duplex + 2 GFCI, so 5 of
//     the 14 duplex marks and the 2 WP GFI at the condensers answer "new",
//     the other receptacles "existing", everything else "new";
//   * the unlisted channel on E2.0 — 13 type-"H" strip lights (Agent 1's
//     own flag: "13 H strip lights shown, not in fixture schedule"), plus
//     tags the guard must drop (circuits A01 / A05 / A08, the room name
//     BREAKROOM, keyed note 12);
//   * the sheet-titles reader on A1.0 / A2.0 / A3.0 / A6.0 (the titles are
//     as printed on the real sheets: "EXISTING FLOOR PLAN - DEMOLITIONS",
//     "EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS");
//   * the counter on the two demolition sheets — Chris's BOM demolition
//     rows (52 2x4 fluorescent, 2 HID high bays, 2 exit/em, 18 receptacles,
//     6 single-pole + 2 3-way switches), the exit/em units drawn on BOTH
//     sheets at the same place (same-size sheets: counted once).
// The plan set is a blank raster set with the real sheets' geometry (17
// pages, 2592 x 1728 pt, unrotated), so tiles and mark positions are real.
import fs from 'fs';
import path from 'path';
import { buildRasterSet, type RasterPage } from '../evidence/buildRasterSheet';
import { screenPosition } from '../../../estimating/pageGeometry';
import { planCountTiles, planOffsetTiles } from '../../../ai/countRender';
import { counterTileSpec, retryTileIn } from '../../../ai/modelLimits';
import { normalizeTypeKey, buildCountTargets } from '../../../ai/countTargets';
import { consolidateTargets } from '../../../ai/evidence/consolidate';
import { rectInToBoxPt, type Viewport } from '../../../ai/evidence/viewports';
import type { EvidenceCache } from '../../../ai/evidence/evidenceStage';
import type { InventoryPage } from '../../../ai/countSheets';
import { fakeAnthropic, systemText, userText, type FakeReply, type FakeRequest } from '../takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from '../evidence/kissimmeeReplies';
import { runCountingStage, type CountingStageOutput } from '../../../ai/countingStage';
import { buildReviewItems, type ReviewItem } from '../../../ai/reviewItems';
import { DEFAULT_EVIDENCE_MODEL } from '../../../routes/preconstruction';

export const PLAN_36TH = '36th Street Warehouse - Plan Set.pdf';
const G = { widthPt: 2592, heightPt: 1728, originX: 0, originY: 0, rotation: 0 };
export const REPLAY_MODEL = 'claude-opus-5-5';

export interface Live36th {
  agent1: Record<string, unknown>;
  inventory: InventoryPage[];
  countResult: {
    marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number; circuit?: string }>;
    sheets: Array<{ key: string; label: string; page: number; viewports?: Viewport[] }>;
    types: Array<{ key: string; type: string; count: number; status: string }>;
    removedRows: Array<{ row: Record<string, unknown> }>;
    evidence: { tables: Array<{ sheetKey: string; viewportId?: string; title: string }> };
  };
  reviewItems: Array<{ id: string; title: string; group?: string; blocking?: boolean }>;
}

let cache: Live36th | null = null;
export function load36th(): Live36th {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(__dirname, '36th-street-live-2026-09-29.json'), 'utf8')) as Live36th;
  return JSON.parse(JSON.stringify(cache)) as Live36th;
}

export async function pdfs36th(): Promise<Map<string, Buffer>> {
  const pages: RasterPage[] = Array.from({ length: 17 }, () => ({ images: [], rotation: 0 }));
  return new Map([[PLAN_36TH, await buildRasterSet(pages)]]);
}

/** Agent 1's output as the counting stage first received it (counted rows
 *  out, the rows the live merge removed back in). */
export function agent1Input(run: Live36th): Record<string, unknown> {
  const q = (run.agent1.quantities as Array<Record<string, unknown>>) ?? [];
  const { countingSummary: _cs, ...rest } = run.agent1;
  return { ...rest, quantities: [...q.filter(r => !r.countType && r.countedBy !== 'schedule'), ...run.countResult.removedRows.map(r => r.row)] };
}

const PX = 36 / 1440;
/** E3.0's schedule viewports were stored only as tables: rebuilt from them
 *  (placeholder rectangles — only their titles matter here). */
function rebuiltViewports(run: Live36th, page: number): Viewport[] {
  return run.countResult.evidence.tables.filter(t => t.sheetKey === `${PLAN_36TH}#${page}` && t.viewportId).map((t, i) => {
    const rectIn = { left: (58 + i * 180) * PX, top: 500 * PX, width: 170 * PX, height: 200 * PX };
    return { id: t.viewportId!, number: '', title: t.title, scale: '', kind: 'schedule', rectIn, bboxPt: rectInToBoxPt(rectIn, G), source: 'vision', inPerFt: null } as Viewport;
  });
}

export function cache36th(run: Live36th): EvidenceCache & { misses: string[] } {
  const misses: string[] = [];
  return {
    misses,
    async get(_sha, page, kind) {
      const sheetKey = `${PLAN_36TH}#${page}`;
      if (kind === 'viewports') return run.countResult.sheets.find(s => s.page === page)?.viewports ?? rebuiltViewports(run, page);
      if (kind.startsWith('typicals:')) return [];
      if (kind.startsWith('table:')) {
        const num = kind.split(':')[1];
        return run.countResult.evidence.tables.find(x => x.sheetKey === sheetKey && x.viewportId?.endsWith(`@${num}`)) ?? null;
      }
      misses.push(`${kind}#${page}`);
      return null;
    },
    async set() { /* read-only replay */ },
  };
}

// ── Mocked model answers ────────────────────────────────────────────────────

export const TITLES: Record<number, string[]> = {
  2: ['INTERIOR BUILD-OUT FLOOR PLAN', 'INTERIOR BUILD-OUT FOR 36TH STREET WAREHOUSE'],
  4: ['EXISTING FLOOR PLAN - DEMOLITIONS', 'DEMOLITION NOTES', 'INTERIOR BUILD-OUT FOR 36TH STREET WAREHOUSE'],
  5: ['EXISTING REFLECTIVE CEILING PLAN - DEMOLITIONS', 'DEMOLITION NOTES', 'LIGHTING FIXTURE (LUMINAIRE) SCHEDULE'],
  8: ['INTERIOR BUILD-OUT FLOOR PLAN'],
};

export interface Mark { key: string; x: number; y: number; circuit?: string; status?: string }

/** A grid of positions (PDF points) inside the building area. */
function grid(n: number, x0: number, y0: number, dx: number, dy: number, perRow: number): Array<{ x: number; y: number }> {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % perRow) * dx, y: y0 + Math.floor(i / perRow) * dy }));
}

/** The demolition sheets' mocked marks (Chris's BOM demolition rows). */
export function demoMarks(page: number, key: (liveKey: string) => string, shiftA3 = 0, sitePoles = 0): Mark[] {
  const exits = grid(2, 700, 1300, 900, 0, 2).map(p => ({ key: 'DEMO-EXIT', ...p }));
  if (page === 4) {
    return [
      ...grid(18, 420, 420, 110, 160, 9).map(p => ({ key: key('DUPLEX RECEPTACLE'), ...p })),
      ...grid(6, 470, 1000, 150, 0, 6).map(p => ({ key: key('$'), ...p })),
      ...grid(2, 1500, 1000, 150, 0, 2).map(p => ({ key: key('$3'), ...p })),
      ...grid(sitePoles, 2300, 300, 0, 200, 1).map(p => ({ key: 'DEMO-SITE-POLE', ...p })),
      ...exits,
    ];
  }
  if (page === 5) {
    return [
      ...grid(52, 400, 380, 120, 110, 13).map(p => ({ key: 'DEMO-FIXTURE', ...p })),
      ...grid(2, 1900, 900, 200, 0, 2).map(p => ({ key: 'DEMO-HIGHBAY', ...p })),
      ...exits.map(e => ({ ...e, x: e.x + 4 + shiftA3, y: e.y - 3 })), // the same two units, drawn again
    ];
  }
  return [];
}

/** E1.0's receptacle statuses (the rest of both sheets: new). */
function liveStatus(sheetPage: number, liveKey: string, index: number): string {
  if (sheetPage !== 15) return 'new';
  if (liveKey === 'DUPLEX RECEPTACLE') return index < 5 ? 'new' : 'existing';
  if (liveKey === 'WP') return 'new';
  if (liveKey === 'GFI' || liveKey === '42') return 'existing';
  return 'new';
}

export const H_POSITIONS = grid(13, 1300, 450, 130, 260, 5);

export function toTiles(req: FakeRequest, text: string, marks: Mark[]): { marks: unknown[]; rects: Map<string, { leftIn: number; topIn: number; widthIn: number; heightIn: number }> } {
  const spec = counterTileSpec(REPLAY_MODEL);
  const w = G.widthPt / 72, h = G.heightPt / 72;
  const rects = new Map<string, { leftIn: number; topIn: number; widthIn: number; heightIn: number }>();
  for (const r of [...planCountTiles(w, h, { tileIn: spec.tileIn }), ...planOffsetTiles(w, h, { tileIn: retryTileIn(spec.tileIn, spec.limits) })]) {
    if (text.includes(`Tile ${r.id} (row`)) rects.set(r.id, r);
  }
  const asked = new Set(text.split('\n').filter(l => l.startsWith('- ') && l.includes(' | ')).map(l => normalizeTypeKey(l.slice(2).split(' | ')[0])));
  const status = text.includes('STATUS (remodel job)');
  // Price accuracy D3 — a demolition sheet's "marked for removal" flag.
  const demoSheet = text.includes('DEMOLITION SHEET');
  const out: unknown[] = [];
  for (const m of marks) {
    if (!asked.has(m.key)) continue;
    const d = screenPosition(m.x, m.y, G.originX, G.originY, G.widthPt, G.heightPt, G.rotation);
    for (const [id, t] of rects) {
      const nx = (d.x / 72 - t.leftIn) / t.widthIn, ny = (d.y / 72 - t.topIn) / t.heightIn;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) out.push([m.key, id, Number(nx.toFixed(4)), Number(ny.toFixed(4)), m.circuit ?? '', ...(status ? [m.status ?? 'new'] : demoSheet && m.status === 'demo' ? ['demo'] : [])]);
    }
  }
  void req;
  return { marks: out, rects };
}

export function unlistedIn(rects: Map<string, { leftIn: number; topIn: number; widthIn: number; heightIn: number }>, tag: string, symbol: string, pts: Array<{ x: number; y: number }>) {
  const marks: unknown[] = [];
  for (const p of pts) {
    const d = screenPosition(p.x, p.y, G.originX, G.originY, G.widthPt, G.heightPt, G.rotation);
    for (const [id, t] of rects) {
      const nx = (d.x / 72 - t.leftIn) / t.widthIn, ny = (d.y / 72 - t.topIn) / t.heightIn;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) marks.push([id, Number(nx.toFixed(4)), Number(ny.toFixed(4))]);
    }
  }
  return marks.length ? [{ tag, symbol, marks }] : [];
}

export const isCounter = (req: FakeRequest) => systemText(req).includes('counting symbols on ONE electrical plan sheet');
export const isTitles = (req: FakeRequest) => systemText(req).includes('You read the DRAWING TITLES');

export function counter36th(run: Live36th, key: (liveKey: string) => string | null, opts: { conventions?: boolean; shiftA3?: number; sitePoles?: number } = {}) {
  const seen = new Map<string, number>();
  const live = run.countResult.marks.map(m => {
    const n = seen.get(`${m.sheetKey}|${m.typeKey}`) ?? 0;
    seen.set(`${m.sheetKey}|${m.typeKey}`, n + 1);
    const page = Number(m.sheetKey.split('#').pop());
    // No printed rule read (conventions: false): fix round B2 — the model
    // still tags every 3rd mark "existing" (dashed / light-line items); the
    // counts must not move without a rule.
    return { page, liveKey: m.typeKey, x: m.x, y: m.y, circuit: m.circuit, status: opts.conventions === false ? (n % 3 === 0 ? 'existing' : 'new') : liveStatus(page, m.typeKey, n) };
  });
  return (req: FakeRequest): FakeReply => {
    const text = userText(req);
    const sheet = /SHEET: (\S+)/.exec(text)?.[1] ?? '';
    const page = ({ 'E1.0': 15, 'E2.0': 16, 'A2.0': 4, 'A3.0': 5 } as Record<string, number>)[sheet] ?? 0;
    const k = (s: string) => key(s) ?? s;
    const marks: Mark[] = page === 4 || page === 5
      ? demoMarks(page, k, opts.shiftA3 ?? 0, opts.sitePoles ?? 0)
      : live.filter(m => m.page === page).flatMap(m => { const kk = key(m.liveKey); return kk ? [{ key: kk, x: m.x, y: m.y, circuit: m.circuit, status: m.status }] : []; });
    const { marks: out, rects } = toTiles(req, text, marks);
    const unlisted = page === 16 && !text.includes('CONSISTENCY PASS') ? [
      ...unlistedIn(rects, 'H', "4' surface strip light", H_POSITIONS),
      ...unlistedIn(rects, 'A05', 'circuit tag', [{ x: 1400, y: 500 }]),
      ...unlistedIn(rects, 'A01', 'circuit tag at a fixture', [{ x: 1500, y: 700 }]),
      ...unlistedIn(rects, 'BREAKROOM', 'room name', [{ x: 1800, y: 600 }]),
      ...unlistedIn(rects, '12', 'keyed note in a hexagon', [{ x: 1900, y: 700 }]),
      // Fix round S4 / re-check S-new-2 — real 36th circuit / equipment /
      // modifier tokens a model can misread as tags (A08 and A26 are real
      // circuit tags on 36th's E-sheets; F2 is an equipment row).
      ...unlistedIn(rects, 'A08', 'tag at fixture', [{ x: 1350, y: 900 }]),
      ...unlistedIn(rects, 'A26', 'tag at fixture', [{ x: 1450, y: 900 }]),
      ...unlistedIn(rects, 'F2', 'fan symbol', [{ x: 1650, y: 900 }]),
      ...unlistedIn(rects, 'EM', 'tag at fixture', [{ x: 1750, y: 900 }]),
      ...unlistedIn(rects, 'X', 'tag at fixture', [{ x: 1850, y: 900 }]),
    ] : [];
    const conventions = page === 15 && opts.conventions !== false && text.includes('STATUS (remodel job)')
      ? [{ status: 'new', rule: 'shaded symbol = new', quote: 'SHADED SYMBOL DENOTES NEW RECEPTACLE' }] : [];
    return { text: JSON.stringify({ marks: out, unreadable: [], unlisted, notes: [], ...(conventions.length ? { conventions } : {}) }) };
  };
}

export function titles36th(truncate: string[] = []) {
  return (req: FakeRequest): FakeReply => {
    const label = /SHEET: (\S+)/.exec(userText(req))?.[1] ?? '';
    if (truncate.includes(label)) return { text: '{"titles":["EXISTING FLOOR PLAN - DEM', stop_reason: 'max_tokens' };
    const page = ({ 'A1.0': 2, 'A2.0': 4, 'A3.0': 5, 'A6.0': 8 } as Record<string, number>)[label];
    if (!page) return { text: JSON.stringify({ titles: [], conventions: [] }) }; // nothing read: the inventory title decides
    return { text: JSON.stringify({ titles: TITLES[page] ?? [], conventions: [] }) };
  };
}

/** The current code's key for a live key (an alias folded by the
 *  consolidation is reported as its canonical entity). */
export function keyMap36th(run: Live36th): (k: string) => string | null {
  const cons = consolidateTargets(buildCountTargets(agent1Input(run)).targets);
  return (k: string) => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
}

export async function replay36th(opts: { remodel?: { buildType?: string | null; answer?: string | null } | null; conventions?: boolean; mutate?: (run: Live36th) => void; shiftA3?: number; truncateTitles?: string[]; sitePoles?: number } = {}): Promise<{ stage: CountingStageOutput; review: ReviewItem[]; calls: FakeRequest[]; misses: string[] }> {
  const run = load36th();
  opts.mutate?.(run);
  const key = keyMap36th(run);
  const counter = counter36th(run, key, { conventions: opts.conventions, shiftA3: opts.shiftA3, sitePoles: opts.sitePoles });
  const titles = titles36th(opts.truncateTitles);
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isCounter(req) ? counter(req)
    : isTitles(req) ? titles(req)
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
  const cacheObj = cache36th(run);
  const stage = await runCountingStage({
    client, model: REPLAY_MODEL, maxTokens: 32000,
    agent1: agent1Input(run), inventory: run.inventory, pdfs: await pdfs36th(),
    evidence: { model: DEFAULT_EVIDENCE_MODEL, maxTokens: 16000, cache: cacheObj },
    ...(opts.remodel === null ? {} : { remodel: opts.remodel ?? { buildType: null, answer: null } }),
  });
  return { stage, review: buildReviewItems(stage.countResult), calls, misses: cacheObj.misses };
}
