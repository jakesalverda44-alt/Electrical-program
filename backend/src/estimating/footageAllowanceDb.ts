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
import { PRE_SUBMISSION_STAGES } from './costLineDefaults';
import {
  computeFootageAllowance, parseFootageSettings, GeneratedTakeoffRow, TakeoffRowLike, GeometrySheet,
  Agent1Like, Agent2AllowanceLike, BRANCH_CATEGORY, FootageSummary,
} from './footageAllowance';

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
  },
): Promise<GeneratedRowsResult> {
  const allowances = parseAgent2Allowances(src.agent2Raw);
  if (!src.agent2Raw) return { takeoff: src.takeoffRows, rows: allowanceRows(allowances), summary: null };
  try {
    const [{ rows: settingRows }, { rows: bidRows }, { rows: existing }] = await Promise.all([
      pool.query(`SELECT key, value FROM app_settings WHERE key IN ('est_footage_ratios','est_default_drop_ft','est_default_slack_pct','est_box_fitting_allowance')`),
      pool.query('SELECT sq_ft, stage FROM bids WHERE id = $1', [bidId]),
      pool.query(
        `SELECT l.category, l.description, l.unit, l.qty, l.source, l.qty_overridden, l.qty_source, l.takeoff_key, l.excluded, l.match_source, i.name AS item_name
           FROM est_bid_lines l LEFT JOIN est_items i ON i.id = l.item_id WHERE l.bid_id = $1`, [bidId]),
    ]);
    const setting = (k: string) => settingRows.find(r => r.key === k)?.value as string | undefined;
    const settings = parseFootageSettings(setting('est_footage_ratios'));
    const dropFt = Number.isFinite(Number(setting('est_default_drop_ft'))) && setting('est_default_drop_ft') !== undefined ? Number(setting('est_default_drop_ft')) : 10;
    const slackPct = Number.isFinite(Number(setting('est_default_slack_pct'))) && setting('est_default_slack_pct') !== undefined ? Number(setting('est_default_slack_pct')) : 10;

    const count = parseJsonMaybe<CountResultLike>(src.countResult);
    let geometry: GeometrySheet[] = [];
    const docs = count?.markers?.sheetDocuments ?? [];
    if (docs.length) {
      const docIds = [...new Set(docs.map(d => d.documentId).filter(Boolean))] as string[];
      const [{ rows: scales }, { rows: pins }] = await Promise.all([
        pool.query('SELECT document_id, page_index, ft_per_pt, scale_source FROM est_sheets WHERE bid_id = $1 AND document_id = ANY($2::uuid[])', [bidId, docIds]),
        pool.query(
          `SELECT document_id, page_index, points FROM est_markups
            WHERE bid_id = $1 AND kind = 'count' AND deleted_at IS NULL AND status = 'confirmed' AND label ~* '^\\s*panel\\b'`,
          [bidId],
        ),
      ]);
      geometry = geometryFromCount(count, scales as SheetScaleRow[], pins as PanelPinRow[]);
    }
    const sqFt = bidRows[0]?.sq_ft != null && bidRows[0].sq_ft !== '' ? Number(bidRows[0].sq_ft) : null;
    const result = computeFootageAllowance({
      takeoffRows: src.takeoffRows, agent1: extractAgent1(src.agent1Raw), agent2Allowances: allowances,
      geometry, settings, dropFt, slackPct, sqFt,
    });
    const composed = composeWiringRows({
      takeoff: src.takeoffRows, allowances, ratioRows: result.rows,
      existing: existing.map(r => ({ ...r, qty: Number(r.qty) })) as ExistingLineLike[],
      resolveParts: src.resolveParts ?? (() => false), settings, conductors: result.summary.conductors,
      allowanceCategory: DEFAULT_ALLOWANCE_CATEGORY,
    });
    // Price accuracy round C3 — boxes / fittings / support hardware, only on
    // a bid still being estimated (a submitted / awarded / lost bid's price
    // never moves on a sync).
    let boxRows: BoxFittingRow[] = [];
    if ((PRE_SUBMISSION_STAGES as readonly string[]).includes(String(bidRows[0]?.stage ?? ''))) {
      boxRows = computeBoxFittingRows({
        rows: [...composed.takeoff, ...composed.generated] as BfRowLike[],
        existing: existing.map(r => ({ ...r, qty: Number(r.qty) })) as never,
        settings: parseBoxFittingSettings(setting('est_box_fitting_allowance')),
        pointHasBox: src.pointHasBox ?? (() => false),
      }).rows;
    }
    return { takeoff: composed.takeoff, rows: [...composed.generated, ...boxRows], summary: result.summary, scopes: composed.scopes };
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
