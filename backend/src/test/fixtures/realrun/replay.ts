// Real-run fix round — REPLAY the live Kissimmee run (2026-09-24) through the
// current code. No model is called and nothing is transcribed:
//   * the counter is answered with the live run's OWN marks (count_result
//     .marks, plus the marks it excluded on the enlarged-plan rule), each
//     reported in every tile that contains it, with the circuit tag the live
//     counter read — under the key the current code asks for (an alias the
//     consolidation folded is reported as its canonical entity; a name the
//     code no longer asks for is not reported);
//   * the evidence readers are answered from the live run's own parsed
//     output through the evidence cache (viewports of the counted sheets,
//     every typical package, every schedule table) — the readers' parsers
//     already ran on the real replies; the cache is how a re-run of
//     unchanged files gets them in production too;
//   * the plan set is a blank raster set with the real sheets' geometry
//     (1728 x 2592 pt, /Rotate 270; PH0.1 2592 x 1728), so tiles and mark
//     positions are the real ones.
// Limits (honest): the evidence-only sheets E-4 / E-5 had their viewports
// stored only as tables, so their schedule viewports are rebuilt from the
// tables (E-4's rectangles from the earlier measured transcription of the
// real sheet); the spec pages 136-138 are blank here (they had a text layer
// live, and gave no viewports either way).
import { buildRasterSet, type RasterPage } from '../evidence/buildRasterSheet';
import { screenPosition } from '../../../estimating/pageGeometry';
import sharp from 'sharp';
import { planCountTiles, planOffsetTiles } from '../../../ai/countRender';
import { counterTileSpec, imageTokens, retryTileIn } from '../../../ai/modelLimits';
import { normalizeTypeKey } from '../../../ai/countTargets';
import { rectInToBoxPt, type Viewport } from '../../../ai/evidence/viewports';
import type { EvidenceCache } from '../../../ai/evidence/evidenceStage';
import { systemText, userText, type FakeReply, type FakeRequest } from '../takeoff/fakeAnthropic';
import { LIVE_PLAN_FILE, LIVE_SPEC_FILE, type KissimmeeLiveRun } from './kissimmeeLive';

export const REPLAY_COUNTER_MODEL = 'claude-opus-5-5';
const E_GEOM = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };

export async function replayPdfs(): Promise<Map<string, Buffer>> {
  const plan: RasterPage[] = Array.from({ length: 55 }, (_, i) => (i + 1 === 19 ? { images: [], rotation: 0 } : { images: [] }));
  const spec: RasterPage[] = Array.from({ length: 142 }, () => ({ images: [], rotation: 0 }));
  return new Map([[LIVE_PLAN_FILE, await buildRasterSet(plan)], [LIVE_SPEC_FILE, await buildRasterSet(spec)]]);
}

/** E-4's schedule viewports, measured on the real sheet (the evidence
 *  round's transcription, 40 DPI overview px of 1440 x 960 -> inches). */
const E4_RECTS: Record<string, [number, number, number, number]> = {
  u4: [58, 700, 487, 905], u5: [493, 18, 912, 445], u6: [912, 18, 1330, 445],
};
const PX = 36 / 1440;

function rebuiltViewports(run: KissimmeeLiveRun, page: number): Viewport[] {
  const tables = run.countResult.evidence.tables.filter(t => t.sheetKey === `${LIVE_PLAN_FILE}#${page}`);
  return tables.filter(t => t.viewportId).map((t, i) => {
    const num = t.viewportId!.split('@').pop()!;
    const px = E4_RECTS[num] ?? [58 + i * 300, 500, 58 + i * 300 + 280, 700];
    const rectIn = { left: px[0] * PX, top: px[1] * PX, width: (px[2] - px[0]) * PX, height: (px[3] - px[1]) * PX };
    return {
      id: t.viewportId!, number: /^u\d+$/.test(num) ? '' : num, title: t.title, scale: '', kind: 'schedule', rectIn,
      bboxPt: rectInToBoxPt(rectIn, E_GEOM), source: 'vision', inPerFt: null,
    } as Viewport;
  });
}

/** The evidence cache, answered from the live run's parsed reader output. */
export function replayEvidenceCache(run: KissimmeeLiveRun): EvidenceCache & { hits: string[]; misses: string[] } {
  const hits: string[] = [];
  const misses: string[] = [];
  const ev = run.countResult.evidence;
  return {
    hits, misses,
    async get(_sha, page, kind) {
      const sheetKey = `${page > 55 || kind === 'spec' ? LIVE_SPEC_FILE : LIVE_PLAN_FILE}#${page}`;
      if (kind === 'viewports') {
        const counted = run.countResult.sheets.find(s => s.page === page && s.file === LIVE_PLAN_FILE && s.viewports);
        const vps = counted?.viewports ?? (page === 52 || page === 53 ? rebuiltViewports(run, page) : []);
        hits.push(`viewports#${page}`);
        return vps;
      }
      if (kind.startsWith('typicals:')) {
        hits.push(`typicals#${page}`);
        return ev.typicals.filter(t => t.sheetKey === sheetKey);
      }
      if (kind.startsWith('table:')) {
        const num = kind.split(':')[1];
        const t = ev.tables.find(x => x.sheetKey === sheetKey && x.viewportId?.endsWith(`@${num}`));
        (t ? hits : misses).push(`${kind}#${page}`);
        return t ?? null;
      }
      misses.push(`${kind}#${page}`);
      return null;
    },
    async set() { /* read-only replay */ },
  };
}

/** Agent 1's output as the counting stage first received it: the stored
 *  agent1_output is post-merge (counted / schedule rows in, Agent 1's own
 *  rows out), so the counted rows come out and the rows the live merge
 *  removed (count_result.removedRows) go back in. */
export function liveAgent1Input(run: KissimmeeLiveRun): Record<string, unknown> {
  const q = (run.agent1.quantities as Array<Record<string, unknown>>) ?? [];
  const agentRows = q.filter(r => !r.countType && r.countedBy !== 'schedule');
  const removed = (run.countResult.removedRows as Array<{ row: Record<string, unknown> }>).map(r => r.row);
  const { countingSummary: _cs, ...rest } = run.agent1;
  return { ...rest, quantities: [...agentRows, ...removed] };
}

export interface ReplayMark { sheetKey: string; typeKey: string; x: number; y: number; circuit?: string }

/** Every mark the live counter placed, including the ones the enlarged-plan
 *  rule excluded afterwards (the counter did report them). */
export function liveCounterMarks(run: KissimmeeLiveRun): ReplayMark[] {
  const out: ReplayMark[] = run.countResult.marks.map(m => ({ ...m }));
  for (const s of run.countResult.sheets) {
    for (const e of s.excluded ?? []) for (const m of e.marks) out.push({ sheetKey: s.key, typeKey: e.typeKey, x: m.x, y: m.y });
  }
  return out;
}

/** A counter that reports the given marks in every tile of the call that
 *  contains them, for the types the call asked for. `keyOf` maps a live key
 *  to the key the current code asks for (null = not reported). */
export function replayCounter(
  run: KissimmeeLiveRun,
  marks: ReplayMark[],
  keyOf: (liveKey: string) => string | null,
  opts: { extraTiles?: (wIn: number, hIn: number) => Array<{ id: string; leftIn: number; topIn: number; widthIn: number; heightIn: number }> } = {},
) {
  const spec = counterTileSpec(REPLAY_COUNTER_MODEL);
  const labels = new Map(run.countResult.sheets.map(s => [s.label, s]));
  return async (req: FakeRequest): Promise<FakeReply> => {
    const text = userText(req);
    const sheet = [...labels.values()].find(s => text.includes(`SHEET: ${s.label}`));
    if (!sheet?.geometry) return { text: JSON.stringify({ marks: [], unreadable: [], notes: [] }) };
    const g = sheet.geometry;
    const asked = new Set(text.split('\n').filter(l => l.startsWith('- ') && l.includes(' | ')).map(l => normalizeTypeKey(l.slice(2).split(' | ')[0])));
    const shown = g.rotation === 90 || g.rotation === 270 ? { w: g.heightPt / 72, h: g.widthPt / 72 } : { w: g.widthPt / 72, h: g.heightPt / 72 };
    const rects = new Map<string, { leftIn: number; topIn: number; widthIn: number; heightIn: number }>();
    for (const r of [...planCountTiles(shown.w, shown.h, { tileIn: spec.tileIn }), ...planOffsetTiles(shown.w, shown.h, { tileIn: retryTileIn(spec.tileIn, spec.limits) }), ...(opts.extraTiles?.(shown.w, shown.h) ?? [])]) {
      if (text.includes(`Tile ${r.id} (row`)) rects.set(r.id, r);
    }
    const out: unknown[] = [];
    for (const s of marks.filter(x => x.sheetKey === sheet.key)) {
      const k = keyOf(s.typeKey);
      if (!k || !asked.has(k)) continue;
      const d = screenPosition(s.x, s.y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
      for (const [id, t] of rects) {
        const nx = (d.x / 72 - t.leftIn) / t.widthIn, ny = (d.y / 72 - t.topIn) / t.heightIn;
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) out.push([k, id, Number(nx.toFixed(4)), Number(ny.toFixed(4)), ...(s.circuit ? [s.circuit] : [])]);
      }
    }
    return { text: JSON.stringify({ marks: out, unreadable: [], notes: [] }), usage: await estimatedUsage(req, out.length) };
  };
}

/** An honest ESTIMATE of what the real call costs (no model is called): the
 *  image tokens of every tile actually sent (their real pixel sizes), the
 *  text at ~4 characters a token, and ~25 output tokens a mark plus 1,500
 *  for the reasoning around them. */
export async function estimatedUsage(req: FakeRequest, marks: number): Promise<{ input_tokens: number; output_tokens: number }> {
  const blocks = Array.isArray(req.messages[0]?.content) ? req.messages[0].content as Array<{ type: string; text?: string; source?: { data: string } }> : [];
  let input = Math.ceil((systemTextLen(req) + blocks.filter(b => b.type === 'text').reduce((n, b) => n + (b.text?.length ?? 0), 0)) / 4);
  for (const b of blocks) {
    if (b.type !== 'image' || !b.source) continue;
    const m = await sharp(Buffer.from(b.source.data, 'base64')).metadata();
    input += imageTokens(m.width ?? 0, m.height ?? 0);
  }
  return { input_tokens: input, output_tokens: 1500 + 25 * marks };
}

function systemTextLen(req: FakeRequest): number {
  return systemText(req).length;
}

export const isCounterRequest = (req: FakeRequest) => systemText(req).includes('counting symbols on ONE electrical plan sheet');
