// Remodel + footage round, B1 + B2 — the rows bidEstimate.ts adds to every
// bid's takeoff before mapping:
//   B1: Agent 2's allowances[] (it used to drop them). footage > 0 → a priced
//       line; footage 0 → a visible "NEEDS FOOTAGE" row at 0, never lost.
//   B2: the footage allowance (footageAllowance.ts), from the takeoff's own
//       counts, the count's mark geometry on scaled sheets, and the editable
//       ratios in app_settings.
// Reads only; bidEstimate.ts's sync writes the lines like any takeoff row.
import { pool } from '../db/pool';
import { runSpecParts, NEEDS_FOOTAGE_PREFIX } from './footageSpecPricing';
import { composeWiringRows, ExistingLineLike, PartsResolver, WiringScope, ScopeDecision } from './wiringScopes';
import { classifyPointText, PointKind } from './footageCalibration';
import { computeBoxFittingRows, parseBoxFittingSettings, BoxFittingRow, BfRowLike } from './boxFittingAllowance';
import { isEstimatingBid } from './costLineDefaults';
import {
  computeFootageAllowance, parseFootageSettings, GeneratedTakeoffRow, TakeoffRowLike, GeometrySheet,
  Agent1Like, Agent2AllowanceLike, BRANCH_CATEGORY, FEEDER_CATEGORY, FootageSummary, parseFeederSpec,
} from './footageAllowance';
import { estimateFeeders, type FeederEstimateInput, type FeederEstimateResult } from './feederEstimate';
import { parseFeederEstimateSettings } from './feederRoute';
import { feederEstimateRows, noteReplacedFeederRows } from './feederRows';
import { normalizeNode } from './feederGraph';
import { loadFeederContext } from './feederEstimateDb';
import { siteGeometryRows } from './siteGeometry';

export const DEFAULT_ALLOWANCE_CATEGORY = 'Site / Underground / Allowances';

export interface Agent2Allowance extends Agent2AllowanceLike {
  unit?: string | null;
  category?: string | null;
}

/** Same JSON extraction as bidEstimate.ts's parseAgent2Takeoff, for the
 *  sibling allowances[] array. Never throws. */
export function parseAgent2Allowances(raw: string | null | undefined): Agent2Allowance[] {
  if (!raw) return [];
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const start = candidate.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as { allowances?: unknown };
    if (!Array.isArray(parsed.allowances)) return [];
    return parsed.allowances
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { item?: unknown }).item === 'string')
      .map(a => ({
        item: String(a.item).trim(),
        footage: a.footage as number | string | null,
        unit: typeof a.unit === 'string' ? a.unit : null,
        notes: typeof a.notes === 'string' ? a.notes : null,
        category: typeof a.category === 'string' ? a.category : null,
      }))
      .filter(a => a.item.length > 0);
  } catch {
    return [];
  }
}

/** B1 — one row per allowance. The label (item) never carries the footage,
 *  so the row keeps its takeoff key — and an estimator's typed footage —
 *  when a re-run finally reads a length off the plans. */
export function allowanceRows(allowances: Agent2Allowance[]): GeneratedTakeoffRow[] {
  return allowances.map(a => {
    const ft = Number(a.footage);
    const hasFootage = Number.isFinite(ft) && ft > 0;
    const note = (a.notes ?? '').trim();
    const unit = String(a.unit ?? 'LF').trim().toUpperCase();
    return {
      category: (a.category ?? '').trim() || DEFAULT_ALLOWANCE_CATEGORY,
      item: `Allowance — ${a.item}`,
      spec: hasFootage ? a.item : `${NEEDS_FOOTAGE_PREFIX}${a.item}`,
      qty: hasFootage ? ft : 0,
      unit: (unit === 'FT' || unit === 'FEET' || !unit ? 'LF' : unit) as 'LF',
      confidence: 'APPROX',
      evidence: hasFootage
        ? `Agent 2 allowance, ESTIMATED: ${ft} ${unit || 'LF'}${note ? ` — ${note}` : ''}`
        : `Agent 2 allowance with no footage on the plans — measure it or type a qty (not priced until then)${runSpecParts(`${NEEDS_FOOTAGE_PREFIX}${a.item}`) ? '; the conduit and the wire (run × conductors) price automatically from the typed run length' : ''}${note ? `. Agent 2: ${note}` : ''}`,
    };
  });
}

// ── Geometry (v2) off the stored count ──────────────────────────────────────

interface CountTypeLike { key?: string; type?: string; description?: string; category?: string; status?: string; host?: boolean }
interface CountMarkLike { x?: number; y?: number; typeKey?: string; sheetKey?: string; circuit?: string | null; status?: string | null }
interface CountResultLike {
  types?: CountTypeLike[];
  marks?: CountMarkLike[];
  sheets?: Array<{ key?: string; label?: string }>;
  markers?: { sheetDocuments?: Array<{ sheetKey?: string; documentId?: string; pageIndex?: number; label?: string }> };
}

const CATEGORY_HINT: Record<string, string> = {
  interior_lighting: 'Interior Lighting', exterior_lighting: 'Exterior / Site Lighting', site_lighting: 'Exterior / Site Lighting',
  lighting_control: 'Lighting Controls', device: 'Branch Power', equipment: 'Branch Power',
};

/** A panel's own marks (its position), never an equipment row that merely
 *  mentions its panel ("... Panel A ckts 15,17"). */
export function isPanelType(t: CountTypeLike): boolean {
  if (/\bpanel\b|panelboard|\bpnl\b/i.test(`${t.key ?? ''} ${t.type ?? ''}`)) return true;
  const d = t.description ?? '';
  return /\bpanel(?:board)?\b/i.test(d) && !/\bckts?\b|\bcircuits?\b|\bfed from\b|\bpanel(?:ed)? (?:wall|door)\b/i.test(d)
    && /^\s*(?:existing\s+)?(?:new\s+)?(?:\d+\s*a\b\s*)?(?:[\w/-]+\s+){0,3}(?:sub\s*)?panel(?:board)?\b/i.test(d);
}

export interface SheetScaleRow { document_id: string; page_index: number; ft_per_pt: string | number | null; scale_source: string | null }
export interface PanelPinRow { document_id: string; page_index: number; points: unknown }

/** Pure: count_result + sheet scales + manual panel pins → geometry sheets.
 *  Only a confirmed ('calibrated') or title-block scale counts; a
 *  suggested-only scale never does. Existing/demo marks (Builder A1's
 *  status, when present) are never new branch wiring. */
export function geometryFromCount(count: CountResultLike | null, scales: SheetScaleRow[], pins: PanelPinRow[]): GeometrySheet[] {
  if (!count?.marks?.length || !count.markers?.sheetDocuments?.length) return [];
  const typeByKey = new Map<string, CountTypeLike>();
  for (const t of count.types ?? []) if (t.key) typeByKey.set(t.key, t);
  const scaleByPage = new Map<string, number>();
  for (const s of scales) {
    const f = Number(s.ft_per_pt);
    // ft_per_pt/scale_source are written only by an explicit confirm click
    // or a two-point calibration (migration 109) — 'titleblock' here is a
    // title-block scale the estimator ACCEPTED. The merely suggested scale
    // lives in suggested_ft_per_pt and is never read.
    if ((s.scale_source === 'calibrated' || s.scale_source === 'titleblock') && Number.isFinite(f) && f > 0) scaleByPage.set(`${s.document_id}#${s.page_index}`, f);
  }
  const pinsByPage = new Map<string, Array<{ x: number; y: number }>>();
  for (const p of pins) {
    const pts = Array.isArray(p.points) ? p.points as unknown[] : [];
    const first = pts[0] as unknown;
    if (Array.isArray(first) && Number.isFinite(Number(first[0])) && Number.isFinite(Number(first[1]))) {
      const k = `${p.document_id}#${p.page_index}`;
      const list = pinsByPage.get(k) ?? [];
      list.push({ x: Number(first[0]), y: Number(first[1]) });
      pinsByPage.set(k, list);
    }
  }
  const sheets: GeometrySheet[] = [];
  for (const doc of count.markers.sheetDocuments) {
    if (!doc.sheetKey || !doc.documentId || doc.pageIndex == null) continue;
    const pageKey = `${doc.documentId}#${doc.pageIndex}`;
    const marks = count.marks.filter(m => m.sheetKey === doc.sheetKey && Number.isFinite(m.x) && Number.isFinite(m.y));
    const panels: GeometrySheet['panels'] = [...(pinsByPage.get(pageKey) ?? [])];
    const points: GeometrySheet['points'] = [];
    for (const m of marks) {
      const t = typeByKey.get(m.typeKey ?? '');
      if (!t || t.host || (t.status && t.status !== 'counted')) continue;
      if (m.status && !/^(new|relocated)$/i.test(m.status)) continue;
      if (isPanelType(t)) { panels.push({ x: m.x as number, y: m.y as number, label: t.key }); continue; }
      const kind: PointKind | null = classifyPointText(`${t.type ?? t.key ?? ''} ${t.description ?? ''}`, CATEGORY_HINT[t.category ?? ''] ?? '');
      if (!kind) continue;
      points.push({ x: m.x as number, y: m.y as number, kind, circuit: m.circuit ?? null });
    }
    if (!points.length) continue;
    const label = doc.label ?? count.sheets?.find(s => s.key === doc.sheetKey)?.label ?? doc.sheetKey;
    sheets.push({ sheetKey: doc.sheetKey, label, ftPerPt: scaleByPage.get(pageKey) ?? null, panels, points });
  }
  return sheets;
}

function parseJsonMaybe<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return null; }
}

function extractAgent1(raw: unknown): Agent1Like | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Agent1Like;
  const s = String(raw).trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fenced ? fenced[1].trim() : s;
  const start = c.indexOf('{');
  try { return JSON.parse(start >= 0 ? c.slice(start) : c) as Agent1Like; } catch { return null; }
}

export interface GeneratedRowsResult {
  /** Agent 2's takeoff[] rows after the one-source-per-scope rule. */
  takeoff: Array<TakeoffRowLike & { evidence?: string | null }>;
  /** B1 allowance rows + the footage allowance rows (+ C3's box / fitting /
   *  hardware allowance rows on a bid still being estimated). */
  rows: Array<GeneratedTakeoffRow | BoxFittingRow>;
  summary: FootageSummary | null;
  scopes?: Record<WiringScope, ScopeDecision>;
  /** Accuracy round C6 — the feeder estimate (estimating bids only). */
  feeders?: FeederEstimateResult | null;
}

/** Accuracy round Task 0 — everything B1/B2/C3 read from the DB for one bid,
 *  already loaded (the replay eval builds this from a live export; the
 *  loader below builds it from the DB). Settings are the raw app_settings
 *  strings (undefined = not set). */
export interface GeneratedRowsInputs {
  agent2Raw: string; agent1Raw: unknown; countResult: unknown; takeoffRows: TakeoffRowLike[];
  resolveParts?: PartsResolver;
  pointHasBox?: (row: BfRowLike) => boolean;
  settings: { footageRatios?: string; dropFt?: string; slackPct?: string; boxFitting?: string };
  bid: { sq_ft?: unknown; stage?: unknown; calibration?: unknown } | null;
  existing: ExistingLineLike[];
  /** est_sheets rows of the count's documents, and the confirmed panel pins
   *  (only read when the count has sheetDocuments). */
  scales: SheetScaleRow[];
  pins: PanelPinRow[];
  /** Accuracy round C6 — what the feeder estimate reads (on a bid still
   *  being estimated / a calibration job): every confirmed count pin, the
   *  vector sheets' text runs, the est_feeder_estimate setting. */
  feeders?: {
    pins: FeederEstimateInput['pins'];
    textSheets: FeederEstimateInput['textSheets'];
    settingsRaw?: string;
    deckFt?: number | null;
  } | null;
  /** Resolves one library name exactly (item or alias) — the feeder rows' all-or-nothing check. */
  resolveName?: (name: string) => boolean;
}

/** Pure core of loadGeneratedTakeoffRows (same result for the same inputs). */
export function computeGeneratedTakeoffRows(inp: GeneratedRowsInputs): GeneratedRowsResult {
  const allowances = parseAgent2Allowances(inp.agent2Raw);
  const { settings: raw } = inp;
  const settings = parseFootageSettings(raw.footageRatios);
  const dropFt = Number.isFinite(Number(raw.dropFt)) && raw.dropFt !== undefined ? Number(raw.dropFt) : 10;
  const slackPct = Number.isFinite(Number(raw.slackPct)) && raw.slackPct !== undefined ? Number(raw.slackPct) : 10;

  const count = parseJsonMaybe<CountResultLike>(inp.countResult);
  const geometry: GeometrySheet[] = count?.markers?.sheetDocuments?.length ? geometryFromCount(count, inp.scales, inp.pins) : [];
  const sqFt = inp.bid?.sq_ft != null && inp.bid.sq_ft !== '' ? Number(inp.bid.sq_ft) : null;
  const agent1 = extractAgent1(inp.agent1Raw);
  // Accuracy round C6 — feeder lengths, on a bid still being estimated or a
  // calibration job only (every other bid keeps today's 0-qty MEASURE rows).
  const estimating = isEstimatingBid(inp.bid);
  const feederEst = estimating ? estimateFeeders({
    graph: { agent1: agent1 as never, takeoffRows: inp.takeoffRows as never },
    countResult: count as never,
    estSheets: inp.scales as never,
    pins: inp.feeders?.pins ?? [],
    textSheets: inp.feeders?.textSheets ?? [],
    knownAreas: sqFt ? [{ sqFt, source: 'bid SF' }] : [],
    settings: parseFeederEstimateSettings(inp.feeders?.settingsRaw), slackPct, deckFt: inp.feeders?.deckFt ?? null,
  }) : null;
  const pricedEdges = (feederEst?.estimates ?? []).filter(e => e.route.status === 'estimated' && e.edge.kind === 'equipment');
  // C6 — an estimated equipment circuit carries its own wiring: that
  // equipment's connection / disconnect points come off the branch ratio.
  const FAMILY_WORDS: Record<string, RegExp> = {
    RTU: /\brtu\b|\bhvac\b|roof ?top/i, AHU: /\bahu\b|air handler|\bhvac\b/i, COMP: /\bcomp(?:ressor)?\b|condens|\bhvac\b/i,
    CU: /\bcu\b|condens|\bhvac\b/i, EF: /exhaust fan|\bef\b/i, WH: /water heater|\bwh\b/i,
  };
  const carried = (r: TakeoffRowLike) => pricedEdges.some(e => {
    if (normalizeNode(String((r as { countType?: string }).countType ?? '')) === e.edge.to || normalizeNode(String(r.item ?? '').split(/\s+[—–-]\s+/)[0]) === e.edge.to) return true;
    const fam = FAMILY_WORDS[e.edge.to.split('-')[0]];
    const text = `${r.item ?? ''} ${r.spec ?? ''}`;
    return !!fam && fam.test(text) && /disconnect|connection/i.test(text) && classifyPointText(text, r.category ?? '') === 'equipment';
  });
  const pointRows = pricedEdges.length ? inp.takeoffRows.filter(r => !carried(r)) : inp.takeoffRows;
  const result = computeFootageAllowance({
    takeoffRows: pointRows, agent1, agent2Allowances: allowances,
    geometry, settings, dropFt, slackPct, sqFt,
  });
  let ratioRows = result.rows;
  let takeoffRows = inp.takeoffRows;
  if (feederEst) {
    const todayFeeders = result.rows.filter(r => r.category === FEEDER_CATEGORY && r.feeder);
    const feederRows = feederEstimateRows(feederEst.estimates, todayFeeders, { priced: true, resolveName: inp.resolveName ?? (() => false), existing: inp.existing });
    ratioRows = [...result.rows.filter(r => !(r.category === FEEDER_CATEGORY && r.feeder)), ...feederRows];
    takeoffRows = noteReplacedFeederRows(inp.takeoffRows as Array<TakeoffRowLike & { evidence?: string | null; note?: string | null }>, feederEst.estimates, parseFeederSpec);
  }
  const composed = composeWiringRows({
    takeoff: takeoffRows, allowances, ratioRows,
    existing: inp.existing,
    resolveParts: inp.resolveParts ?? (() => false), settings, conductors: result.summary.conductors,
    allowanceCategory: DEFAULT_ALLOWANCE_CATEGORY,
  });
  // Accuracy round E1–E3 — site circuits by geometry, pole bases, trenching.
  let siteRows: GeneratedTakeoffRow[] = [];
  let generatedRows = composed.generated;
  if (feederEst) {
    const a2 = parseJsonMaybe<Record<string, unknown>>(inp.agent2Raw.replace(/^[\s\S]*?```(?:json)?\s*|```[\s\S]*$/g, '')) ?? {};
    const a1 = (agent1 ?? {}) as Record<string, unknown>;
    const texts = [
      ...((a1.scopeNotes as string[] | undefined) ?? []), ...((a1.flags as unknown[] | undefined) ?? []).map(String),
      ...((a1.furnishStatements as unknown[] | undefined) ?? []).map(x => (typeof x === 'string' ? x : JSON.stringify(x))),
      ...[a2.scopeOfWork, a2.exclusions].flat().filter(Boolean).map(x => (typeof x === 'string' ? x : JSON.stringify(x))),
      ...inp.takeoffRows.map(r => `${r.item ?? ''} ${r.spec ?? ''} ${(r as { notes?: string }).notes ?? ''}`),
    ];
    const site = siteGeometryRows({
      feeders: feederEst, countResult: count as never, agent1: a1 as never, texts,
      takeoffRows: inp.takeoffRows as never, settings: parseFeederEstimateSettings(inp.feeders?.settingsRaw), resolveName: inp.resolveName ?? (() => false),
      siteScope: { source: composed.scopes.site.source as 1 | 2 | 3, detail: composed.scopes.site.detail },
    });
    siteRows = site.rows as unknown as GeneratedTakeoffRow[];
    if (site.replacesRatioPvc) {
      generatedRows = generatedRows.map(r => (r.item === 'Site lighting conduit allowance — PVC' ? { ...r, qty: 0, evidence: `Replaced by the site geometry estimate (Site lighting circuits — 1" PVC underground) — set to 0 so it is never counted twice. The ratio was: ${r.evidence}` } : r));
    }
  }
  // Price accuracy round C3 — boxes / fittings / support hardware, only on
  // a bid still being estimated (a submitted / awarded / lost bid's price
  // never moves on a sync).
  let boxRows: BoxFittingRow[] = [];
  if (isEstimatingBid(inp.bid)) {
    boxRows = computeBoxFittingRows({
      rows: [...composed.takeoff, ...generatedRows, ...siteRows.filter(r => r.unit === 'LF' && !(r as { excluded?: boolean }).excluded)] as BfRowLike[],
      existing: inp.existing as never,
      settings: parseBoxFittingSettings(raw.boxFitting),
      pointHasBox: inp.pointHasBox ?? (() => false),
    }).rows;
  }
  return { takeoff: composed.takeoff, rows: [...generatedRows, ...boxRows, ...siteRows], summary: result.summary, scopes: composed.scopes, feeders: feederEst };
}

/** Loads everything B1/B2 need for one bid and returns the takeoff rows plus
 *  the extra rows, after the one-source-per-scope rule (wiringScopes.ts). A
 *  failure never breaks a sync — it becomes a visible 0-qty row saying so. */
export async function loadGeneratedTakeoffRows(
  bidId: string,
  src: {
    agent2Raw: string | null; agent1Raw: unknown; countResult: unknown; takeoffRows: TakeoffRowLike[]; resolveParts?: PartsResolver;
    /** C3 — true when a takeoff row prices as an assembly that already
     *  includes its box (the box allowance skips that point). */
    pointHasBox?: (row: BfRowLike) => boolean;
    /** Accuracy round C6 — one library name resolves exactly. */
    resolveName?: (name: string) => boolean;
  },
): Promise<GeneratedRowsResult> {
  const allowances = parseAgent2Allowances(src.agent2Raw);
  if (!src.agent2Raw) return { takeoff: src.takeoffRows, rows: allowanceRows(allowances), summary: null };
  const agent2Raw = src.agent2Raw;
  try {
    const [{ rows: settingRows }, { rows: bidRows }, { rows: existing }] = await Promise.all([
      pool.query(`SELECT key, value FROM app_settings WHERE key IN ('est_footage_ratios','est_default_drop_ft','est_default_slack_pct','est_box_fitting_allowance')`),
      pool.query('SELECT sq_ft, stage, calibration FROM bids WHERE id = $1', [bidId]),
      pool.query(
        `SELECT l.category, l.description, l.unit, l.qty, l.source, l.qty_overridden, l.qty_source, l.takeoff_key, l.excluded, l.match_source, i.name AS item_name
           FROM est_bid_lines l LEFT JOIN est_items i ON i.id = l.item_id WHERE l.bid_id = $1`, [bidId]),
    ]);
    const setting = (k: string) => settingRows.find(r => r.key === k)?.value as string | undefined;

    const count = parseJsonMaybe<CountResultLike>(src.countResult);
    let scales: SheetScaleRow[] = [];
    let pins: PanelPinRow[] = [];
    const docs = count?.markers?.sheetDocuments ?? [];
    if (docs.length) {
      const docIds = [...new Set(docs.map(d => d.documentId).filter(Boolean))] as string[];
      const [{ rows: scaleRows }, { rows: pinRows }] = await Promise.all([
        pool.query('SELECT document_id, page_index, ft_per_pt, scale_source, suggested_ft_per_pt, suggested_label, half_size FROM est_sheets WHERE bid_id = $1 AND document_id = ANY($2::uuid[])', [bidId, docIds]),
        pool.query(
          `SELECT document_id, page_index, points FROM est_markups
            WHERE bid_id = $1 AND kind = 'count' AND deleted_at IS NULL AND status = 'confirmed' AND label ~* '^\\s*panel\\b'`,
          [bidId],
        ),
      ]);
      scales = scaleRows as SheetScaleRow[];
      pins = pinRows as PanelPinRow[];
    }
    const feeders = isEstimatingBid(bidRows[0]) ? await loadFeederContext(bidId) : null;
    return computeGeneratedTakeoffRows({
      agent2Raw, agent1Raw: src.agent1Raw, countResult: src.countResult, takeoffRows: src.takeoffRows,
      resolveParts: src.resolveParts, pointHasBox: src.pointHasBox, resolveName: src.resolveName, feeders,
      settings: {
        footageRatios: setting('est_footage_ratios'), dropFt: setting('est_default_drop_ft'),
        slackPct: setting('est_default_slack_pct'), boxFitting: setting('est_box_fitting_allowance'),
      },
      bid: bidRows[0] ?? null,
      existing: existing.map(r => ({ ...r, qty: Number(r.qty) })) as ExistingLineLike[],
      scales, pins,
    });
  } catch (err) {
    console.error('[footageAllowance] could not compute the footage allowance', err);
    return {
      takeoff: src.takeoffRows,
      rows: [...allowanceRows(allowances), {
        category: BRANCH_CATEGORY, item: 'Branch wiring allowance — could not be computed', spec: 'NEEDS FOOTAGE — branch wiring',
        qty: 0, unit: 'LF', confidence: 'APPROX',
        evidence: `The footage allowance failed to compute (${(err as Error)?.message ?? 'unknown error'}). Enter branch conduit/wire by hand or re-sync.`,
      }],
      summary: null,
    };
  }
}
