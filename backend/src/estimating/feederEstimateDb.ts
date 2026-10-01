// Accuracy round C6/C7 — what the feeder estimate reads from the DB for one
// bid: every confirmed count pin (an estimator's "Panel B" / "Transformer"
// marker), the est_feeder_estimate setting, and the text runs of the bid's
// vector site / utility / photometric sheets (pdf.js, cached per file + page
// in sheet_evidence_cache as kind 'feeder-textruns'). Reads only, except the
// text-run cache. A failure never breaks a sync: the estimate just has less.
import { pool } from '../db/pool';
import { dbEvidenceCache } from '../services/evidenceCache';
import { readPagesText } from '../ai/evidence/evidenceStage';
import type { FeederEstimateInput } from './feederEstimate';

export const FEEDER_TEXT_CACHE_KIND = 'feeder-textruns';
export const FEEDER_TEXT_CACHE_KEY = 'v1';
const ANCHOR_RE = /SCALE|TRANSFORMER|XFMR|METER|SERVICE|BLDG|PANEL/i;
const SITE_TITLE_RE = /utility|\bsite\b|photometric|electrical site|civil/i;

type Run = { str: string; x: number; y: number; w: number; h: number };

/** The runs within 400 pt of an anchor word (the scale bar, equipment labels). */
export function anchorRuns(runs: Run[]): Run[] {
  const anchors = runs.filter(r => ANCHOR_RE.test(r.str));
  const c = (r: Run) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  return runs.filter(r => anchors.some(a => { const A = c(a), B = c(r); return Math.hypot(A.x - B.x, A.y - B.y) <= 400; }))
    .map(r => ({ str: r.str, x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) }));
}

interface InventoryLike { file: string; page: number; title?: string; sheetNo?: string; discipline?: string; cls?: string; textChars?: number }

/** Inventory pages worth a text read: vector site / utility / photometric plans. */
export function feederTextPages(inventory: InventoryLike[]): InventoryLike[] {
  return (inventory ?? []).filter(p => (p.textChars ?? 0) >= 2000 && p.cls === 'plan' && SITE_TITLE_RE.test(`${p.title ?? ''}`));
}

export async function loadFeederContext(bidId: string): Promise<NonNullable<import('./footageAllowanceDb').GeneratedRowsInputs['feeders']>> {
  const [{ rows: pins }, { rows: settingRows }, { rows: tr }] = await Promise.all([
    pool.query(`SELECT document_id, page_index, label, points FROM est_markups
                 WHERE bid_id = $1 AND kind = 'count' AND deleted_at IS NULL AND status = 'confirmed' AND label IS NOT NULL`, [bidId]),
    pool.query(`SELECT value FROM app_settings WHERE key = 'est_feeder_estimate'`),
    pool.query('SELECT prep_inventory FROM takeoff_results WHERE bid_id = $1', [bidId]),
  ]);
  const textSheets: FeederEstimateInput['textSheets'] = [];
  try {
    const pages = feederTextPages((tr[0]?.prep_inventory as InventoryLike[] | null) ?? []);
    const byFile = new Map<string, InventoryLike[]>();
    for (const p of pages) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
    for (const [file, ps] of byFile) {
      const { rows: docs } = await pool.query(
        `SELECT id, content_sha256 FROM documents WHERE linked_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [bidId, file]);
      const doc = docs[0];
      if (!doc?.content_sha256) continue;
      const need: InventoryLike[] = [];
      for (const p of ps) {
        const hit = await dbEvidenceCache.get(doc.content_sha256, p.page, FEEDER_TEXT_CACHE_KIND, FEEDER_TEXT_CACHE_KEY) as { geometry: TextSheetGeom; runs: Run[] } | null;
        if (hit) textSheets.push(toSheet(file, p, doc.id, hit));
        else need.push(p);
      }
      if (!need.length) continue;
      const { rows: data } = await pool.query('SELECT file_data FROM documents WHERE id = $1', [doc.id]);
      if (!data[0]?.file_data) continue;
      const read = await readPagesText(Buffer.from(data[0].file_data as string, 'base64'), need.map(p => p.page));
      for (const p of need) {
        const got = read.get(p.page);
        if (!got) continue;
        const value = { geometry: got.geometry, runs: anchorRuns(got.runs) };
        await dbEvidenceCache.set(doc.content_sha256, p.page, FEEDER_TEXT_CACHE_KIND, FEEDER_TEXT_CACHE_KEY, value).catch(() => undefined);
        textSheets.push(toSheet(file, p, doc.id, value));
      }
    }
  } catch (err) {
    console.error('[feeders] text runs could not be read', err);
  }
  return {
    pins: pins as FeederEstimateInput['pins'],
    textSheets,
    settingsRaw: settingRows[0]?.value as string | undefined,
    deckFt: null,
  };
}

type TextSheetGeom = { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number };
function toSheet(file: string, p: InventoryLike, documentId: string, v: { geometry: TextSheetGeom; runs: Run[] }): FeederEstimateInput['textSheets'][number] {
  return { sheetKey: `${file}#${p.page}`, label: `${p.sheetNo || `p${p.page}`} "${p.title ?? ''}"`, geometry: v.geometry, runs: v.runs, documentId, pageIndex: p.page - 1, site: true };
}

// ── C7 — GET /api/estimating/:bidId/feeders ────────────────────────────────

export interface FeederApiEdge {
  id: string; from: string; to: string; kind: string; spec: string | null;
  status: 'estimated' | 'hold'; lengthFt: number | null; tier: string | null; underground: boolean;
  math: string; holds: string[]; quotes: string[];
  endpoints: Array<{ node: string; located: boolean; sheetKey?: string; documentId?: string | null; pageIndex?: number | null; x?: number; y?: number; source?: string; confidence?: string; note?: string; hold?: string }>;
  /** The suggested route on its sheet (PDF points), for the Plans layer. */
  route: { documentId: string | null; pageIndex: number | null; sheetKey: string | null; points: Array<{ x: number; y: number }> } | null;
  quantities: { conduitFt: number; conductors: Array<{ size: string; ground: boolean; count: number; ft: number }> } | null;
  /** For "Adopt as run": vertical + makeup ft inside the length, before slack. */
  verticalFt: number | null;
  makeupFt: number | null;
}

export interface FeederApiResult {
  /** True on a bid still being estimated or a calibration job: estimates price. */
  priced: boolean;
  stage: string | null;
  calibration: boolean;
  slackPct: number;
  edges: FeederApiEdge[];
  taps: Array<{ from: string; to: string; quote: string }>;
  skipped: Array<{ to: string; quote: string; reason: string }>;
  scales: Array<{ label: string; tier: string; ftPerPt: number | null; basis: string }>;
  summary: { suggested: number; confirmed: number; holds: number };
}

export async function loadFeederEstimate(bidId: string): Promise<FeederApiResult> {
  const { estimateFeeders } = await import('./feederEstimate');
  const { parseFeederEstimateSettings } = await import('./feederRoute');
  const { isEstimatingBid } = await import('./costLineDefaults');
  const { parseAgent2Takeoff } = await import('./bidEstimate');
  const [{ rows: tr }, { rows: bidRows }, { rows: slack }] = await Promise.all([
    pool.query('SELECT agent1_output, agent2_output, count_result FROM takeoff_results WHERE bid_id = $1', [bidId]),
    pool.query('SELECT stage, calibration, sq_ft FROM bids WHERE id = $1', [bidId]),
    pool.query(`SELECT value FROM app_settings WHERE key = 'est_default_slack_pct'`),
  ]);
  const slackPct0 = Number.isFinite(Number(slack[0]?.value)) && slack[0]?.value != null ? Number(slack[0].value) : 10;
  const empty: FeederApiResult = { priced: isEstimatingBid(bidRows[0]), stage: bidRows[0]?.stage ?? null, calibration: bidRows[0]?.calibration === true, slackPct: slackPct0, edges: [], taps: [], skipped: [], scales: [], summary: { suggested: 0, confirmed: 0, holds: 0 } };
  if (!tr[0]) return empty;
  const parse = (v: unknown) => { if (v == null) return null; if (typeof v === 'object') return v; const s = String(v); const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i); const c = f ? f[1] : s; const i = c.indexOf('{'); try { return JSON.parse(i >= 0 ? c.slice(i) : c); } catch { return null; } };
  const count = parse(tr[0].count_result) as Record<string, unknown> | null;
  const docIds = [...new Set((((count?.markers as { sheetDocuments?: Array<{ documentId?: string }> } | undefined)?.sheetDocuments) ?? []).map(d => d.documentId).filter(Boolean))] as string[];
  const ctx = await loadFeederContext(bidId);
  const textDocIds = ctx.textSheets.map(t => t.documentId).filter(Boolean) as string[];
  const { rows: estSheets } = await pool.query(
    'SELECT document_id, page_index, ft_per_pt, scale_source, suggested_ft_per_pt, suggested_label, half_size FROM est_sheets WHERE bid_id = $1 AND document_id = ANY($2::uuid[])',
    [bidId, [...new Set([...docIds, ...textDocIds])]]);
  const sqFt = bidRows[0]?.sq_ft != null ? Number(bidRows[0].sq_ft) : null;
  const slackPct = Number.isFinite(Number(slack[0]?.value)) && slack[0]?.value != null ? Number(slack[0].value) : 10;
  const r = estimateFeeders({
    graph: { agent1: parse(tr[0].agent1_output) as never, takeoffRows: parseAgent2Takeoff(tr[0].agent2_output as string | null) as never },
    countResult: count as never, estSheets: estSheets as never, pins: ctx.pins, textSheets: ctx.textSheets,
    knownAreas: sqFt ? [{ sqFt, source: 'bid SF' }] : [],
    settings: parseFeederEstimateSettings(ctx.settingsRaw), slackPct, deckFt: ctx.deckFt ?? null,
  });
  const at = (k: string | null) => (k ? r.sheetOf[k] : undefined);
  const edges: FeederApiEdge[] = r.estimates.map(e => ({
    id: e.edge.id, from: e.edge.from, to: e.edge.to, kind: e.edge.kind, spec: e.edge.spec?.key ?? null,
    status: e.route.status, lengthFt: e.route.lengthFt, tier: e.route.tier, underground: e.route.underground,
    math: e.route.math, holds: e.route.holds, quotes: e.edge.quotes,
    endpoints: [e.from, e.to].map((p, i) => (p && 'sheetKey' in p
      ? { node: p.node, located: true, sheetKey: p.sheetKey, documentId: at(p.sheetKey)?.documentId ?? null, pageIndex: at(p.sheetKey)?.pageIndex ?? null, x: p.x, y: p.y, source: p.source, confidence: p.confidence, note: p.note }
      : { node: i === 0 ? e.edge.from : e.edge.to, located: false, hold: p?.hold ?? `Pin ${i === 0 ? e.edge.from : e.edge.to} on the Plans view` })),
    route: e.route.routePoints.length ? { documentId: at(e.route.frameSheetKey)?.documentId ?? null, pageIndex: at(e.route.frameSheetKey)?.pageIndex ?? null, sheetKey: e.route.frameSheetKey, points: e.route.routePoints } : null,
    quantities: e.route.quantities,
    verticalFt: e.route.verticalFt ?? null, makeupFt: e.route.makeupFt ?? null,
  }));
  return {
    priced: empty.priced, stage: empty.stage, calibration: empty.calibration, slackPct, edges, taps: r.graph.taps, skipped: r.graph.skipped,
    scales: r.scales.map(s => ({ label: s.label, tier: s.tier, ftPerPt: s.ftPerPt, basis: s.basis })),
    summary: {
      suggested: edges.filter(e => e.status === 'estimated' && e.tier === 'suggested').length,
      confirmed: edges.filter(e => e.status === 'estimated' && e.tier === 'confirmed').length,
      holds: edges.filter(e => e.status === 'hold').length,
    },
  };
}
