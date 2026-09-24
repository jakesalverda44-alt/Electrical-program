// Estimating labor engine — Task 5 routes, mounted at /api/estimating.
// Library reads are requireAuth; library writes are requireAdmin. Bid-level
// routes use the same loadAccessibleBid ownership check as routes/estimates.ts.
import { laborDuplicatePairs, describePair, type DupLine } from '../estimating/duplicateLines';
import { isRealReason } from '../ai/reviewItems';
import { Router } from 'express';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import {
  getLibrary, createItem, updateItem, createAssembly, updateAssembly, createFactor, updateFactor,
  ItemInput, ItemPatch, AssemblyInput, AssemblyPatch, FactorInput, FactorPatch,
} from '../estimating/library';
import {
  getBidLines, getBidSettings, getProposedLinesFromTakeoff, computeRecapForBid,
  priceUnsaved, syncTakeoff, saveBidEstimate, ClientLineInput, ClientSettingsInput,
  NonFiniteTotalError, getSavedGrandTotal,
} from '../estimating/bidEstimate';
import { normalizeUnit, MapConfidence } from '../estimating/mapper';
import { EstUnit, LineConfidence } from '../estimating/pricing';
import { computeCalibrationReport, applyCalibrationAdjustment } from '../estimating/calibration';
import { computeBomCalibrationForJobs } from '../estimating/bomCalibration';
import { pool } from '../db/pool';
import { listSheets, loadPlanDocumentForBid, streamPlanDocument, setSheetScale, setHalfSize, getPlanPdfDocuments } from '../estimating/sheets';
import { parseAccubidBom } from '../estimating/accubidBom';
import { buildImportPreview, applyImportPreview, derivePoleBaseAssembly, applyPoleBaseAssembly } from '../estimating/accubidImport';
import { extractPdfPageTexts } from '../ai/pdfText';
import { pdfUpload } from '../utils/upload';
import {
  computeAccubidRecapForBid, saveAccubidRecapForBid, getAccubidSettings, saveAccubidSettings, AccubidSettings,
  createQuote, updateQuote, deleteQuote, QuoteInput,
  createCostLine, updateCostLine, deleteCostLine, CostLineInput,
  createAlternate, updateAlternate, deleteAlternate, AlternateInput,
  listGcOverheadDefaults, setGcOverheadDefault, persistPriceForBid,
} from '../estimating/accubidBidData';
// Fix round 1 / S4 — reuse the exact same Content-Type/Content-Disposition/
// nosniff lockdown routes/documents.ts already applies (audit Security #6),
// instead of the plan-file route rolling its own (looser) header logic.
import { serveDocument } from './documents';
import { assignAiMarkersToLines } from '../estimating/aiMarkers';
import {
  getMarkups, batchMarkups, getRollup, applyMarkups, getMarkupLineKeysByIds,
  MarkupCreateInput, MarkupUpdateInput,
} from '../estimating/markups';
import { MarkupKind, MarkupStatus, MarkupPoint } from '../estimating/markupMath';

// Fix round 1 / B2 — a route handler awaiting saveBidEstimate/syncTakeoff
// catches this specific error and returns 400; any other error still bubbles
// to the default error handler (500), same as before this fix.
async function catchNonFiniteTotal<T>(work: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work };
  } catch (err) {
    if (err instanceof NonFiniteTotalError) return { ok: false };
    throw err;
  }
}

const router = Router();

const ALLOWED_UNITS: EstUnit[] = ['EA', 'LF', 'C', 'M'];
const ALLOWED_CONFIDENCE: LineConfidence[] = ['FIRM', 'APPROX', 'VERIFY'];
const ALLOWED_MATCH_CONFIDENCE: MapConfidence[] = ['exact', 'alias', 'fuzzy', 'none'];
const ALLOWED_MATCH_SOURCE = ['auto', 'manual'] as const;
const ALLOWED_QTY_SOURCE = ['takeoff', 'manual', 'markup'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fix round 1 / S5 — est_markups.drops is INTEGER, drop_ft is
// NUMERIC(10,2), slack_pct is NUMERIC(6,2) (migration 108). The DB's own
// CHECK constraints only enforce >= 0; a value that overflows the
// column's precision (slack_pct: 12000) throws a Postgres "numeric field
// overflow" error that was reaching the client as an unhandled 500 for
// the WHOLE batch. These caps are generous (well past anything a real
// run would ever need) and just keep a bad value inside the column's own
// range, turning a 500 into a clean per-item rejection.
const MAX_DROPS = 1000;
const MAX_DROP_FT = 10000;
const MAX_SLACK_PCT = 1000;

// ── Validation ───────────────────────────────────────────────────────────────

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SETTINGS_PCT_FIELDS = [
  'material_tax_pct', 'small_tools_pct', 'supervision_pct', 'consumables_pct', 'overhead_pct', 'profit_pct',
] as const;

function validateSettings(body: unknown): ValidationResult<ClientSettingsInput> {
  const s = (body ?? {}) as Record<string, unknown>;
  const laborRate = Number(s.labor_rate);
  if (!Number.isFinite(laborRate) || laborRate < 0) {
    return { ok: false, error: 'labor_rate must be a non-negative number' };
  }
  const crewSize = Number(s.crew_size);
  if (!Number.isFinite(crewSize) || crewSize < 0) {
    return { ok: false, error: 'crew_size must be a non-negative number' };
  }
  // Fix round 1 / N3 — defaults to 0 (no multi-story adjustment) when
  // omitted, same as every other numeric settings field's fallback pattern.
  const floorsAbove2 = s.floors_above_2 != null ? Number(s.floors_above_2) : 0;
  if (!Number.isFinite(floorsAbove2) || floorsAbove2 < 0) {
    return { ok: false, error: 'floors_above_2 must be a non-negative number' };
  }
  const pcts: Record<string, number> = {};
  for (const field of SETTINGS_PCT_FIELDS) {
    const v = Number(s[field]);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: `${field} must be a number between 0 and 100` };
    }
    pcts[field] = v;
  }
  const factorIds = Array.isArray(s.factor_ids) ? s.factor_ids.filter((x): x is string => typeof x === 'string') : [];
  // Next round B2 — omitted (undefined) means "leave whatever pricing mode
  // this bid already has" (saveBidEstimate's own COALESCE handles that); an
  // explicit, recognized value switches it.
  const pricingMode = s.pricing_mode === 'phase_a' || s.pricing_mode === 'accubid' ? s.pricing_mode : undefined;
  return {
    ok: true,
    value: {
      labor_rate: laborRate,
      factor_ids: factorIds,
      material_tax_pct: pcts.material_tax_pct,
      small_tools_pct: pcts.small_tools_pct,
      supervision_pct: pcts.supervision_pct,
      consumables_pct: pcts.consumables_pct,
      overhead_pct: pcts.overhead_pct,
      profit_pct: pcts.profit_pct,
      crew_size: crewSize,
      floors_above_2: floorsAbove2,
      pricing_mode: pricingMode,
    },
  };
}

function validateLines(body: unknown): ValidationResult<ClientLineInput[]> {
  if (!Array.isArray(body)) return { ok: false, error: 'lines must be an array' };
  const out: ClientLineInput[] = [];
  for (const raw of body as Record<string, unknown>[]) {
    const label = typeof raw.description === 'string' ? raw.description : '(untitled line)';
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      return { ok: false, error: `qty must be a non-negative number for line "${label}"` };
    }
    if (raw.material_unit_override != null) {
      const v = Number(raw.material_unit_override);
      if (!Number.isFinite(v)) return { ok: false, error: `material_unit_override must be a number for line "${label}"` };
      if (v < 0) return { ok: false, error: `material_unit_override cannot be negative for line "${label}"` }; // S7
    }
    if (raw.labor_hours_override != null) {
      const v = Number(raw.labor_hours_override);
      if (!Number.isFinite(v)) return { ok: false, error: `labor_hours_override must be a number for line "${label}"` };
      if (v < 0) return { ok: false, error: `labor_hours_override cannot be negative for line "${label}"` }; // S7
    }
    if (raw.source !== 'takeoff' && raw.source !== 'manual') {
      return { ok: false, error: `line "${label}" source must be "takeoff" or "manual"` };
    }
    if (raw.assembly_id && raw.item_id) {
      return { ok: false, error: `line "${label}" cannot have both assembly_id and item_id` };
    }
    if (raw.confidence != null && !ALLOWED_CONFIDENCE.includes(raw.confidence as LineConfidence)) {
      return { ok: false, error: `line "${label}" confidence must be FIRM, APPROX, VERIFY, or absent` };
    }
    out.push({
      id: typeof raw.id === 'string' ? raw.id : undefined,
      // Phase B, Task 1 — only a well-formed UUID is trusted as an existing
      // line's stable key; anything else (absent, or a proposed-mapping
      // placeholder like "proposed-0") is dropped so bidEstimate.ts mints a
      // fresh one rather than trying to INSERT a non-UUID string.
      line_key: typeof raw.line_key === 'string' && UUID_RE.test(raw.line_key) ? raw.line_key : undefined,
      // Fix round 2 / R2-S1 — the RAW string, kept around ONLY so
      // saveBidEstimate can report back what a "proposed-N" placeholder's
      // real UUID turned out to be (remappedLineKeys) — see
      // ClientLineInput.line_key_as_sent's own comment.
      line_key_as_sent: typeof raw.line_key === 'string' ? raw.line_key : undefined,
      category: String(raw.category ?? ''),
      description: String(raw.description ?? ''),
      qty,
      // B2: canonicalize unit aliases (ea/each, ft/lf) here too — a manual
      // line typed straight into the UI never goes through the mapper's
      // adapters, which is where every OTHER path normalizes. An
      // unrecognized unit (LS/SET/LOT/blank) passes through unchanged;
      // resolveLines()/pricing.ts treat that as unit_unknown, never a crash.
      unit: normalizeUnit(raw.unit as string) as EstUnit,
      assembly_id: (raw.assembly_id as string | null) ?? null,
      item_id: (raw.item_id as string | null) ?? null,
      takeoff_key: (raw.takeoff_key as string | null) ?? null,
      takeoff_item_id: (raw.takeoff_item_id as string | null) ?? null,
      material_unit_override: raw.material_unit_override != null ? Number(raw.material_unit_override) : null,
      labor_hours_override: raw.labor_hours_override != null ? Number(raw.labor_hours_override) : null,
      confidence: (raw.confidence as LineConfidence | null) ?? null,
      excluded: !!raw.excluded,
      qty_overridden: !!raw.qty_overridden,
      // Fix round 2 / B2 — the client round-trips sync_excluded (received on
      // the last GET/sync-takeoff, carried forward on save); saveBidEstimate
      // still enforces the excluded-implies-sync_excluded-possible invariant.
      sync_excluded: !!raw.sync_excluded,
      // Fix round 2 / SF1 + SF4 — round-tripped the same way as sync_excluded.
      match_confidence: ALLOWED_MATCH_CONFIDENCE.includes(raw.match_confidence as MapConfidence)
        ? (raw.match_confidence as MapConfidence) : null,
      match_source: (ALLOWED_MATCH_SOURCE as readonly string[]).includes(raw.match_source as string)
        ? (raw.match_source as 'auto' | 'manual') : null,
      synced_description: typeof raw.synced_description === 'string' ? raw.synced_description : null,
      // Phase B, Task 1 — round-tripped like match_confidence/match_source;
      // absent (every caller before frontend Task 9 wires this field through)
      // falls back to bidEstimate.ts's own qty_overridden-implies-'manual'
      // default rather than being forced to 'takeoff' here.
      qty_source: (ALLOWED_QTY_SOURCE as readonly string[]).includes(raw.qty_source as string)
        ? (raw.qty_source as 'takeoff' | 'manual' | 'markup') : undefined,
      // Re-run reset — round-tripped; only a well-formed run id is kept.
      recheck_run_id: typeof raw.recheck_run_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.recheck_run_id)
        ? raw.recheck_run_id : null,
      recheck_reason: raw.recheck_reason === 'no_confident_match' || raw.recheck_reason === 'ambiguous_match'
        ? raw.recheck_reason : null,
      // Next round A7 — "different items — keep both", with a real reason.
      dup_ok: validDupOk(raw.dup_ok),
      source: raw.source as 'takeoff' | 'manual',
      sort: typeof raw.sort === 'number' ? raw.sort : undefined,
    });
  }
  return { ok: true, value: out };
}

function validDupOk(v: unknown): ClientLineInput['dup_ok'] {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const withKeys = Array.isArray(o.with) ? o.with.filter((k): k is string => typeof k === 'string' && k.length <= 80).slice(0, 20) : [];
  const reason = typeof o.reason === 'string' ? o.reason.trim().slice(0, 500) : '';
  if (!withKeys.length || !isRealReason(reason)) return null;
  return { with: withKeys, reason, ...(typeof o.by === 'string' ? { by: o.by.slice(0, 120) } : {}), ...(typeof o.at === 'string' ? { at: o.at.slice(0, 40) } : {}) };
}

// ── Markups validation (Phase B, Task 3) ────────────────────────────────────

const ALLOWED_MARKUP_KIND: MarkupKind[] = ['count', 'linear'];
const ALLOWED_MARKUP_STATUS: MarkupStatus[] = ['confirmed', 'suggested'];

/** Every point must have finite x/y (hard safety rule — never write a
 *  non-finite number to the DB). `kind` enforces the plan's own cardinality
 *  rule (count = exactly one point, linear = 2+) on CREATE only — an UPDATE
 *  (e.g. dragging a point) doesn't carry kind (it's immutable after
 *  creation), so cardinality there is left to whatever the existing markup
 *  already is. */
function validatePoints(raw: unknown, kind?: MarkupKind): ValidationResult<MarkupPoint[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'points must be a non-empty array' };
  const points: MarkupPoint[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    // Fix round 1 / S5 — `Number(p?.x)` turned `{x: null, y: null}` into
    // a "valid" (0, 0) point (Number(null) === 0, and 0 is finite): a
    // NaN/null/missing coordinate from the client silently became a real
    // point at the page origin instead of being rejected, adding a
    // spurious segment (and hundreds of LF on a long run) to the rollup.
    // typeof must be 'number' before Number.isFinite is even checked.
    const x = p?.x;
    const y = p?.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'every point needs finite numeric x/y' };
    }
    points.push({ x, y });
  }
  if (kind === 'count' && points.length !== 1) return { ok: false, error: 'a count markup must have exactly one point' };
  if (kind === 'linear' && points.length < 2) return { ok: false, error: 'a linear markup must have at least two points' };
  return { ok: true, value: points };
}

/** Fix round 1 / B2 — `line_key` absent/null means "unassigned", a real
 *  and always-valid state (Decision-signed-off in the review: unassigned
 *  markers never roll up, and the estimator can reassign them later). A
 *  PRESENT-but-malformed value (anything from a `proposed-N` placeholder
 *  line_key on a never-saved estimate, to a stray typo) used to be
 *  silently coerced to null too — the exact failure this fixes: the
 *  client never learns its create was quietly demoted, the marker just
 *  looks assigned forever while the server has it unassigned. Now it's a
 *  400, naming the field. */
function validateLineKeyField(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === 'string' && UUID_RE.test(raw)) return { ok: true, value: raw };
  return { ok: false, error: 'line_key must be a well-formed UUID, or null/absent for unassigned' };
}

function validateMarkupCreate(raw: Record<string, unknown>): ValidationResult<MarkupCreateInput> {
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : null;
  if (!id) return { ok: false, error: 'id must be a well-formed, client-generated UUID' };
  const documentId = typeof raw.document_id === 'string' ? raw.document_id : '';
  if (!documentId) return { ok: false, error: 'document_id is required' };
  const pageIndex = Number(raw.page_index);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return { ok: false, error: 'page_index must be a non-negative integer' };
  const kind = raw.kind as MarkupKind;
  if (!ALLOWED_MARKUP_KIND.includes(kind)) return { ok: false, error: 'kind must be "count" or "linear"' };
  const pointsV = validatePoints(raw.points, kind);
  if (!pointsV.ok) return pointsV;

  let drops = 0;
  if (raw.drops != null) {
    drops = Number(raw.drops);
    // Fix round 1 / S5 — est_markups.drops is INTEGER; drops: 1.5 used to
    // pass Number.isFinite and reach the DB as a fractional value the
    // column can't actually hold (a Postgres type error -> 500 for the
    // whole batch).
    if (!Number.isInteger(drops) || drops < 0 || drops > MAX_DROPS) {
      return { ok: false, error: `drops must be a non-negative integer, ${MAX_DROPS} or less` };
    }
  }
  let dropFt: number | null = null;
  if (raw.drop_ft != null) {
    dropFt = Number(raw.drop_ft);
    if (!Number.isFinite(dropFt) || dropFt < 0 || dropFt > MAX_DROP_FT) {
      return { ok: false, error: `drop_ft must be a non-negative number, ${MAX_DROP_FT} or less` };
    }
  }
  let slackPct: number | null = null;
  if (raw.slack_pct != null) {
    slackPct = Number(raw.slack_pct);
    // Fix round 1 / S5 — slack_pct is NUMERIC(6,2) (max 9999.99); an
    // unbounded value (12000) overflowed the column at write time.
    if (!Number.isFinite(slackPct) || slackPct < 0 || slackPct > MAX_SLACK_PCT) {
      return { ok: false, error: `slack_pct must be a non-negative number, ${MAX_SLACK_PCT} or less` };
    }
  }
  let status: MarkupStatus = 'confirmed';
  if (raw.status != null) {
    if (!ALLOWED_MARKUP_STATUS.includes(raw.status as MarkupStatus)) return { ok: false, error: 'status must be "confirmed" or "suggested"' };
    status = raw.status as MarkupStatus;
  }
  const lineKeyV = validateLineKeyField(raw.line_key);
  if (!lineKeyV.ok) return lineKeyV;
  const label = typeof raw.label === 'string' ? raw.label : null;

  return { ok: true, value: { id, documentId, pageIndex, lineKey: lineKeyV.value, kind, points: pointsV.value, drops, dropFt, slackPct, status, label } };
}

function validateMarkupUpdate(raw: Record<string, unknown>): ValidationResult<MarkupUpdateInput> {
  // Fix round 1 / S5 — a non-UUID id here used to reach the DB layer as a
  // raw string parameter against a `uuid` column, which Postgres rejects
  // with "invalid input syntax for type uuid" — an unhandled 500 for the
  // whole batch, for what's really just one malformed item.
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : '';
  if (!id) return { ok: false, error: 'id must be a well-formed UUID' };
  const out: MarkupUpdateInput = { id };

  if (raw.line_key !== undefined) {
    const lineKeyV = validateLineKeyField(raw.line_key);
    if (!lineKeyV.ok) return lineKeyV;
    out.lineKey = lineKeyV.value;
  }
  if (raw.points !== undefined) {
    const pointsV = validatePoints(raw.points);
    if (!pointsV.ok) return pointsV;
    out.points = pointsV.value;
  }
  if (raw.drops !== undefined) {
    const v = Number(raw.drops);
    if (!Number.isInteger(v) || v < 0 || v > MAX_DROPS) {
      return { ok: false, error: `drops must be a non-negative integer, ${MAX_DROPS} or less` };
    }
    out.drops = v;
  }
  if (raw.drop_ft !== undefined) {
    if (raw.drop_ft === null) out.dropFt = null;
    else {
      const v = Number(raw.drop_ft);
      if (!Number.isFinite(v) || v < 0 || v > MAX_DROP_FT) {
        return { ok: false, error: `drop_ft must be a non-negative number, ${MAX_DROP_FT} or less` };
      }
      out.dropFt = v;
    }
  }
  if (raw.slack_pct !== undefined) {
    if (raw.slack_pct === null) out.slackPct = null;
    else {
      const v = Number(raw.slack_pct);
      if (!Number.isFinite(v) || v < 0 || v > MAX_SLACK_PCT) {
        return { ok: false, error: `slack_pct must be a non-negative number, ${MAX_SLACK_PCT} or less` };
      }
      out.slackPct = v;
    }
  }
  if (raw.status !== undefined) {
    if (!ALLOWED_MARKUP_STATUS.includes(raw.status as MarkupStatus)) return { ok: false, error: 'status must be "confirmed" or "suggested"' };
    out.status = raw.status as MarkupStatus;
  }
  if (raw.label !== undefined) out.label = typeof raw.label === 'string' ? raw.label : null;

  return { ok: true, value: out };
}

/** Fix round 1 / S5 — this used to be a `ValidationResult` that returned
 *  the FIRST format error for the whole request: one malformed item (a
 *  fractional `drops`, a stray non-UUID `id` in `updates`) 400'd or
 *  500'd the ENTIRE batch, including every other, perfectly valid item
 *  in it. Since autosave resends the whole outstanding diff until it
 *  succeeds (useMarkupAutosave.ts), one poisoned item blocked every
 *  later save forever. Now every item is validated independently: a bad
 *  one is set aside in `rejected` (surfaced back to the client through
 *  the SAME `skipped` shape batchMarkups already returns for a DB-level
 *  skip, e.g. "already belongs to a different bid" — one uniform shape
 *  for "this item didn't make it, and here's why"), and every other item
 *  in the request still goes through. `deletes` doesn't get a `rejected`
 *  entry for a non-UUID id — deleting a nonsense id is inherently a
 *  no-op (nothing in the DB could ever match it), so it's just filtered
 *  out silently rather than reported as a failure. */
function validateMarkupBatch(body: unknown): { creates: MarkupCreateInput[]; updates: MarkupUpdateInput[]; deletes: string[]; rejected: { id: string | null; reason: string }[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const rejected: { id: string | null; reason: string }[] = [];

  const creates: MarkupCreateInput[] = [];
  for (const raw of (Array.isArray(b.creates) ? b.creates : []) as Record<string, unknown>[]) {
    const v = validateMarkupCreate(raw);
    if (!v.ok) { rejected.push({ id: typeof raw?.id === 'string' ? raw.id : null, reason: v.error }); continue; }
    creates.push(v.value);
  }
  const updates: MarkupUpdateInput[] = [];
  for (const raw of (Array.isArray(b.updates) ? b.updates : []) as Record<string, unknown>[]) {
    const v = validateMarkupUpdate(raw);
    if (!v.ok) { rejected.push({ id: typeof raw?.id === 'string' ? raw.id : null, reason: v.error }); continue; }
    updates.push(v.value);
  }
  const deletes = (Array.isArray(b.deletes) ? b.deletes : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x));
  return { creates, updates, deletes, rejected };
}

function validateItemInput(body: Record<string, unknown>): ValidationResult<ItemInput> {
  const code = String(body.code ?? '').trim();
  const name = String(body.name ?? '').trim();
  const category = String(body.category ?? '').trim();
  const unit = body.unit as EstUnit;
  if (!code) return { ok: false, error: 'code is required' };
  if (!name) return { ok: false, error: 'name is required' };
  if (!category) return { ok: false, error: 'category is required' };
  if (!ALLOWED_UNITS.includes(unit)) return { ok: false, error: 'unit must be one of EA, LF, C, M' };
  const materialCost = Number(body.material_cost);
  if (!Number.isFinite(materialCost) || materialCost < 0) return { ok: false, error: 'material_cost must be a non-negative number' };
  const laborHours = Number(body.labor_hours);
  if (!Number.isFinite(laborHours) || laborHours < 0) return { ok: false, error: 'labor_hours must be a non-negative number' };
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [];
  return {
    ok: true,
    value: {
      code, name, category, unit, material_cost: materialCost,
      material_price_date: (body.material_price_date as string | null) ?? null,
      labor_hours: laborHours, aliases,
    },
  };
}

function validateAssemblyInput(body: Record<string, unknown>): ValidationResult<AssemblyInput> {
  const code = String(body.code ?? '').trim();
  const name = String(body.name ?? '').trim();
  const category = String(body.category ?? '').trim();
  const unit = body.unit as EstUnit;
  if (!code) return { ok: false, error: 'code is required' };
  if (!name) return { ok: false, error: 'name is required' };
  if (!category) return { ok: false, error: 'category is required' };
  if (!ALLOWED_UNITS.includes(unit)) return { ok: false, error: 'unit must be one of EA, LF, C, M' };
  if (!Array.isArray(body.components) || body.components.length === 0) {
    return { ok: false, error: 'components must be a non-empty array' };
  }
  const components: { item_id: string; qty_per: number }[] = [];
  for (const c of body.components as Record<string, unknown>[]) {
    const itemId = String(c.item_id ?? '');
    const qtyPer = Number(c.qty_per);
    if (!itemId) return { ok: false, error: 'each component needs item_id' };
    if (!Number.isFinite(qtyPer) || qtyPer <= 0) return { ok: false, error: 'each component qty_per must be a positive number' };
    components.push({ item_id: itemId, qty_per: qtyPer });
  }
  const aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [];
  return { ok: true, value: { code, name, category, unit, aliases, components } };
}

function validateFactorInput(body: Record<string, unknown>): ValidationResult<FactorInput> {
  const code = String(body.code ?? '').trim();
  const label = String(body.label ?? '').trim();
  const groupKey = String(body.group_key ?? '').trim();
  const pct = Number(body.pct);
  if (!code) return { ok: false, error: 'code is required' };
  if (!label) return { ok: false, error: 'label is required' };
  if (!groupKey) return { ok: false, error: 'group_key is required' };
  if (!Number.isFinite(pct)) return { ok: false, error: 'pct must be a number' };
  return { ok: true, value: { code, label, pct, group_key: groupKey } };
}

// ── Library ──────────────────────────────────────────────────────────────────

router.get('/library', requireAuth, async (_req, res) => {
  res.json(await getLibrary());
});

router.post('/library/items', requireAuth, requireAdmin, async (req, res) => {
  const v = validateItemInput(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    res.json(await createItem(v.value));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(400).json({ error: `Item code "${v.value.code}" already exists` });
    throw err;
  }
});

router.put('/library/items/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: ItemPatch = {};
  if (body.code !== undefined) patch.code = String(body.code);
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.category !== undefined) patch.category = String(body.category);
  if (body.unit !== undefined) {
    if (!ALLOWED_UNITS.includes(body.unit as EstUnit)) return res.status(400).json({ error: 'unit must be one of EA, LF, C, M' });
    patch.unit = body.unit as EstUnit;
  }
  if (body.material_cost !== undefined) {
    const v = Number(body.material_cost);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'material_cost must be a non-negative number' });
    patch.material_cost = v;
  }
  if (body.material_price_date !== undefined) patch.material_price_date = body.material_price_date as string | null;
  if (body.labor_hours !== undefined) {
    const v = Number(body.labor_hours);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'labor_hours must be a non-negative number' });
    patch.labor_hours = v;
  }
  if (body.aliases !== undefined) patch.aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [];
  if (body.active !== undefined) patch.active = !!body.active;

  const updated = await updateItem(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

router.post('/library/assemblies', requireAuth, requireAdmin, async (req, res) => {
  const v = validateAssemblyInput(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    res.json(await createAssembly(v.value));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(400).json({ error: `Assembly code "${v.value.code}" already exists` });
    throw err;
  }
});

router.put('/library/assemblies/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: AssemblyPatch = {};
  if (body.code !== undefined) patch.code = String(body.code);
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.category !== undefined) patch.category = String(body.category);
  if (body.unit !== undefined) {
    if (!ALLOWED_UNITS.includes(body.unit as EstUnit)) return res.status(400).json({ error: 'unit must be one of EA, LF, C, M' });
    patch.unit = body.unit as EstUnit;
  }
  if (body.aliases !== undefined) patch.aliases = Array.isArray(body.aliases) ? body.aliases.filter((a): a is string => typeof a === 'string') : [];
  if (body.active !== undefined) patch.active = !!body.active;
  if (body.components !== undefined) {
    if (!Array.isArray(body.components) || body.components.length === 0) {
      return res.status(400).json({ error: 'components must be a non-empty array' });
    }
    const components: { item_id: string; qty_per: number }[] = [];
    for (const c of body.components as Record<string, unknown>[]) {
      const itemId = String(c.item_id ?? '');
      const qtyPer = Number(c.qty_per);
      if (!itemId || !Number.isFinite(qtyPer) || qtyPer <= 0) {
        return res.status(400).json({ error: 'each component needs a valid item_id and a positive qty_per' });
      }
      components.push({ item_id: itemId, qty_per: qtyPer });
    }
    patch.components = components;
  }

  const updated = await updateAssembly(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Assembly not found' });
  res.json(updated);
});

router.post('/library/factors', requireAuth, requireAdmin, async (req, res) => {
  const v = validateFactorInput(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    res.json(await createFactor(v.value));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(400).json({ error: `Factor code "${v.value.code}" already exists` });
    throw err;
  }
});

router.put('/library/factors/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: FactorPatch = {};
  if (body.code !== undefined) patch.code = String(body.code);
  if (body.label !== undefined) patch.label = String(body.label);
  if (body.group_key !== undefined) patch.group_key = String(body.group_key);
  if (body.pct !== undefined) {
    const v = Number(body.pct);
    if (!Number.isFinite(v)) return res.status(400).json({ error: 'pct must be a number' });
    patch.pct = v;
  }
  if (body.active !== undefined) patch.active = !!body.active;

  const updated = await updateFactor(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Factor not found' });
  res.json(updated);
});

// ── Accubid BOM import (Next round Part B, Task 1) ──────────────────────────
// Settings > Labor Library > "Import Accubid BOM": upload a BOM PDF -> preview
// diff -> apply. Declared before /:bidId so these paths are never captured as
// a bid id.

async function resolveBomText(req: AuthRequest & { file?: Express.Multer.File }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (req.file?.buffer) {
    try {
      const pages = await extractPdfPageTexts(req.file.buffer);
      return { ok: true, text: pages.join('\n') };
    } catch {
      return { ok: false, error: 'Could not extract text from the uploaded PDF (pdftotext failed or is unavailable).' };
    }
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.bomText === 'string' && body.bomText.trim()) return { ok: true, text: body.bomText };
  return { ok: false, error: 'Upload a BOM PDF, or pass bomText (pdftotext -layout output).' };
}

// Review round 2 / S11 — "update prices" is the admin's own checkbox intent;
// the BOM's own header date (never a caller-supplied bomDate, never a
// hardcoded one) is what buildImportPreview actually gates prices on.
router.post('/library/accubid-import/preview', requireAuth, requireAdmin, pdfUpload.single('file'), async (req: AuthRequest, res) => {
  const resolved = await resolveBomText(req as AuthRequest & { file?: Express.Multer.File });
  if (!resolved.ok) return res.status(400).json({ error: resolved.error });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updatePrices = body.updatePrices === true || body.updatePrices === 'true';
  const library = await getLibrary();
  const preview = buildImportPreview(resolved.text, library, { updatePrices });
  const poleBase = derivePoleBaseAssembly(parseAccubidBom(resolved.text).rows);
  res.json({ ...preview, poleBase });
});

router.post('/library/accubid-import/apply', requireAuth, requireAdmin, pdfUpload.single('file'), async (req: AuthRequest, res) => {
  const resolved = await resolveBomText(req as AuthRequest & { file?: Express.Multer.File });
  if (!resolved.ok) return res.status(400).json({ error: resolved.error });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updatePrices = body.updatePrices === true || body.updatePrices === 'true';
  const force = body.force === true || body.force === 'true';
  const library = await getLibrary();
  const preview = buildImportPreview(resolved.text, library, { updatePrices });
  // Review round 2 / S12 — apply follows the preview's own reconciliation
  // and warnings exactly: a BOM whose computed totals don't foot to its own
  // printed footer, or that has ANY unparseable line, is never applied
  // silently — the admin sees the preview's numbers/warnings and either
  // fixes the BOM or explicitly passes force:true to apply it anyway.
  if (!force && (!preview.reconciles || preview.warnings.length > 0)) {
    return res.status(409).json({
      error: preview.reconciles
        ? `This BOM has ${preview.warnings.length} line${preview.warnings.length === 1 ? '' : 's'} that could not be read — review the preview, or pass force:true to apply anyway.`
        : `This BOM's computed totals don't match its own printed footer — review the preview, or pass force:true to apply anyway.`,
      reconciles: preview.reconciles,
      warnings: preview.warnings,
    });
  }
  const result = await applyImportPreview(preview);

  const rows = parseAccubidBom(resolved.text).rows;
  const poleBasePlan = derivePoleBaseAssembly(rows);
  let poleBase: { itemsCreated: number; itemsUpdated: number } | null = null;
  if (poleBasePlan) {
    // Re-read the library — applyImportPreview may have just created some of
    // these same component items as plain BOM rows.
    const libraryAfter = await getLibrary();
    poleBase = await applyPoleBaseAssembly(poleBasePlan, libraryAfter);
  }

  res.json({ ...result, poleBase });
});

// ── Settings: per-GC overhead default table (Decision 5) ────────────────────
// Declared before /:bidId so "gc-overhead-defaults" is never captured as a bid id.

router.get('/gc-overhead-defaults', requireAuth, async (_req, res) => {
  res.json(await listGcOverheadDefaults());
});

router.put('/gc-overhead-defaults/:gcName', requireAuth, requireAdmin, async (req, res) => {
  const overheadPct = Number((req.body ?? {}).overheadPct);
  if (!Number.isFinite(overheadPct) || overheadPct < 0) return res.status(400).json({ error: 'overheadPct must be a non-negative number' });
  await setGcOverheadDefault(req.params.gcName, overheadPct);
  res.json({ gcName: req.params.gcName, overheadPct });
});

// ── Calibration (Task 6) ─────────────────────────────────────────────────────
// Declared before /:bidId so "calibration" is never captured as a bid id.

router.get('/calibration', requireAuth, requireAdmin, async (_req, res) => {
  res.json(await computeCalibrationReport());
});

// Part 2, Task 11 — Settings > Labor Library > Calibration > "Apply suggested
// adjustment". Declared before /:bidId for the same reason as GET /calibration.
router.post('/calibration/apply', requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.scope !== 'global' && body.scope !== 'category') {
    return res.status(400).json({ error: 'scope must be "global" or "category"' });
  }
  const adjustmentPct = Number(body.adjustmentPct);
  if (!Number.isFinite(adjustmentPct)) return res.status(400).json({ error: 'adjustmentPct must be a number' });
  const category = body.scope === 'category' ? String(body.category ?? '') : undefined;
  if (body.scope === 'category' && !category) return res.status(400).json({ error: 'category is required when scope is "category"' });
  try {
    const result = await applyCalibrationAdjustment({ scope: body.scope, category, adjustmentPct });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not apply adjustment' });
  }
});

// Next round Part B, Task 4 — calibration against Chris's real BOMs
// (per-category hours, using HIS quantities, against the CURRENT library).
// Read-only, same as GET /calibration — never writes anything (a suggestion
// only; applyCalibrationAdjustment above is the one write path, and it's
// always an explicit, separate action).
router.post('/calibration/bom', requireAuth, requireAdmin, pdfUpload.array('files', 10), async (req: AuthRequest, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const body = (req.body ?? {}) as Record<string, unknown>;
  const bomTextsRaw = Array.isArray(body.bomTexts) ? body.bomTexts : (typeof body.bomTexts === 'string' ? [body.bomTexts] : []);
  const bomTexts: string[] = [...bomTextsRaw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)];
  for (const f of files) {
    try {
      bomTexts.push((await extractPdfPageTexts(f.buffer)).join('\n'));
    } catch {
      return res.status(400).json({ error: `Could not extract text from "${f.originalname}" (pdftotext failed or is unavailable).` });
    }
  }
  if (!bomTexts.length) return res.status(400).json({ error: 'Upload at least one BOM PDF, or pass bomTexts.' });

  // Review round 2 / N16 — fetch full item data (name/category/aliases/
  // source), not just code+unit+hours: the calibration comparison now
  // resolves each BOM row through the SAME mapper a real takeoff line uses,
  // never by the row's own deterministic import code (which finds nothing,
  // or the wrong thing, once an import has reconciled the row onto an
  // EXISTING seed item rather than minting its own).
  const { rows } = await pool.query("SELECT code, name, category, unit, aliases, source, labor_hours FROM est_items WHERE active = true");
  const items = rows.map(r => ({
    code: r.code as string, name: r.name as string, category: r.category as string, unit: r.unit as EstUnit,
    aliases: (r.aliases as string[]) ?? [], source: r.source as string, laborHours: Number(r.labor_hours),
  }));
  res.json(computeBomCalibrationForJobs(bomTexts, items));
});

// ── Per-bid ──────────────────────────────────────────────────────────────────

router.get('/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const existingLines = await getBidLines(bidId);
  const settings = await getBidSettings(bidId);

  if (existingLines.length === 0) {
    const proposed = await getProposedLinesFromTakeoff(bidId);
    if (proposed.hasTakeoff) {
      const recap = await priceUnsaved(bidId, proposed.lines, settings);
      return res.json({ lines: proposed.lines, settings, recap, proposed: true, savedGrandTotal: null });
    }
  }

  const [recap, savedGrandTotal] = await Promise.all([computeRecapForBid(bidId), getSavedGrandTotal(bidId)]);
  // Fix round 2 / SF3 — savedGrandTotal is what's actually persisted in
  // bid_estimates.grand_total; `recap` is always freshly recomputed against
  // the CURRENT library/settings. They can legitimately differ (a library
  // edit or calibration apply since the last save) — the frontend surfaces
  // that drift as "Estimate changed since last save" rather than silently
  // showing a number that no longer matches bids.amount.
  res.json({ lines: existingLines, settings, recap, proposed: false, savedGrandTotal, duplicates: laborDuplicatePairs(existingLines) });
});

router.post('/:bidId/sync-takeoff', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  // Fix round 1 / B2 — sync-takeoff must never 500 just because a takeoff
  // line has a missing/unrecognized unit; syncTakeoff/pricing.ts already
  // price that line at $0 with a warning rather than throwing, so the only
  // failure mode left here is the (very unlikely) non-finite-total guard.
  const result = await catchNonFiniteTotal(syncTakeoff(bidId));
  if (!result.ok) return res.status(400).json({ error: 'Computed totals are not finite — refusing to sync' });
  const recap = await computeRecapForBid(bidId);
  res.json({ ...result.value, recap, duplicates: laborDuplicatePairs(await getBidLines(bidId)) });
});

router.post('/:bidId/price', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const linesV = validateLines(req.body?.lines);
  if (!linesV.ok) return res.status(400).json({ error: linesV.error });
  const settingsV = validateSettings(req.body?.settings);
  if (!settingsV.ok) return res.status(400).json({ error: settingsV.error });

  const recap = await priceUnsaved(bidId, linesV.value, settingsV.value);
  res.json({ recap });
});

router.put('/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const linesV = validateLines(req.body?.lines);
  if (!linesV.ok) return res.status(400).json({ error: linesV.error });
  const settingsV = validateSettings(req.body?.settings);
  if (!settingsV.ok) return res.status(400).json({ error: settingsV.error });

  // Next round A7 — a possible double count (a kept line from the previous
  // run next to a fresh takeoff line for the same item) blocks the save
  // until the estimator resolves it.
  const dups = laborDuplicatePairs(linesV.value.map(l => ({ ...l, line_key: l.line_key ?? l.line_key_as_sent ?? '' })) as DupLine[]);
  if (dups.length) {
    return res.status(409).json({
      error: `Possible duplicate: ${describePair(dups[0])}${dups.length > 1 ? ` (and ${dups.length - 1} more)` : ''}. Remove one of the two, or keep both with a reason, before saving.`,
      duplicates: dups,
    });
  }
  const result = await catchNonFiniteTotal(saveBidEstimate(bidId, linesV.value, settingsV.value));
  if (!result.ok) return res.status(400).json({ error: 'Computed totals are not finite — refusing to save' });
  res.json(result.value);
});

// ── Accubid-style recap (Next round Part B, Task 2/3) ───────────────────────

function validateAccubidSettings(body: unknown): ValidationResult<AccubidSettings> {
  const s = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown, field: string, opts: { min?: number } = {}): number | { error: string } => {
    const n = Number(v);
    if (!Number.isFinite(n) || (opts.min != null && n < opts.min)) return { error: `${field} must be a number${opts.min != null ? ` >= ${opts.min}` : ''}` };
    return n;
  };
  const fields: Record<string, number> = {};
  const numericFields: Array<[keyof AccubidSettings, string]> = [
    ['journeymanCount', 'journeymanCount'], ['journeymanRate', 'journeymanRate'],
    ['apprenticeCount', 'apprenticeCount'], ['apprenticeRate', 'apprenticeRate'],
    ['foremanCount', 'foremanCount'], ['foremanRate', 'foremanRate'],
    ['burdenPct', 'burdenPct'], ['fringePerHr', 'fringePerHr'], ['materialTaxPct', 'materialTaxPct'],
    ['laborOverheadPct', 'laborOverheadPct'], ['materialMarkupPct', 'materialMarkupPct'], ['laborMarkupPct', 'laborMarkupPct'],
    ['quoteMarkupDefaultPct', 'quoteMarkupDefaultPct'], ['adjustmentMarkupPct', 'adjustmentMarkupPct'], ['salesMarkupPct', 'salesMarkupPct'],
  ];
  for (const [key, field] of numericFields) {
    const r = num(s[key], field, { min: 0 });
    if (typeof r !== 'number') return { ok: false, error: r.error };
    fields[key] = r;
  }
  const shift = s.shift === 'night' ? 'night' : 'day';
  const nightField = (v: unknown): number | null => (v == null || v === '') ? null : Number(v);
  return {
    ok: true,
    value: {
      shift,
      journeymanCount: fields.journeymanCount, journeymanRate: fields.journeymanRate,
      apprenticeCount: fields.apprenticeCount, apprenticeRate: fields.apprenticeRate,
      foremanCount: fields.foremanCount, foremanRate: fields.foremanRate,
      nightJourneymanRate: nightField(s.nightJourneymanRate), nightApprenticeRate: nightField(s.nightApprenticeRate), nightForemanRate: nightField(s.nightForemanRate),
      burdenPct: fields.burdenPct, fringePerHr: fields.fringePerHr, materialTaxPct: fields.materialTaxPct,
      laborOverheadPct: fields.laborOverheadPct, materialMarkupPct: fields.materialMarkupPct, laborMarkupPct: fields.laborMarkupPct,
      quoteMarkupDefaultPct: fields.quoteMarkupDefaultPct, adjustmentMarkupPct: fields.adjustmentMarkupPct, salesMarkupPct: fields.salesMarkupPct,
    },
  };
}

router.get('/:bidId/accubid', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const data = await computeAccubidRecapForBid(bidId);
  res.json(data);
});

router.put('/:bidId/accubid/settings', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateAccubidSettings(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await saveAccubidSettings(bidId, v.value);
  const data = await saveAccubidRecapForBid(bidId);
  res.json(data);
});

function validateQuoteInput(body: unknown): ValidationResult<QuoteInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) return { ok: false, error: 'description is required' };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'amount must be a non-negative number' };
  const markupPct = Number(b.markupPct);
  if (!Number.isFinite(markupPct) || markupPct < 0) return { ok: false, error: 'markupPct must be a non-negative number' };
  const taxPct = b.taxPct != null ? Number(b.taxPct) : 0;
  if (!Number.isFinite(taxPct) || taxPct < 0) return { ok: false, error: 'taxPct must be a non-negative number' };
  const status = b.status === 'firm' ? 'firm' : 'budget_pending';
  return { ok: true, value: { description, amount, taxPct, markupPct, status, vendor: typeof b.vendor === 'string' ? b.vendor : null, sort: b.sort != null ? Number(b.sort) : 0 } };
}

// Fix round 2 / B6 — a PATCH-style PUT only sends the fields it's changing,
// but every field it DOES send must still be well-formed: the reviewer's
// repro sent `{amount:'abc'}` straight through to a numeric SQL column and
// got a 500. Each field here is validated only when present; an absent
// field is left for accubidBidData.ts's own `patch.field ?? existing`
// fallback to carry forward untouched.
function validatePartial<T extends object>(
  body: unknown,
  checks: Record<string, (v: unknown) => string | null>
): ValidationResult<Partial<T>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(checks)) {
    if (!(key in b) || b[key] === undefined) continue;
    const err = check(b[key]);
    if (err) return { ok: false, error: err };
    value[key] = b[key];
  }
  return { ok: true, value: value as Partial<T> };
}

const nonNegNumber = (field: string) => (v: unknown): string | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? null : `${field} must be a non-negative number`;
};
const nonEmptyString = (field: string) => (v: unknown): string | null =>
  (typeof v === 'string' && v.trim().length > 0) ? null : `${field} must be a non-empty string`;

function validateQuotePatch(body: unknown): ValidationResult<Partial<QuoteInput>> {
  const r = validatePartial<QuoteInput>(body, {
    description: nonEmptyString('description'),
    amount: nonNegNumber('amount'),
    taxPct: nonNegNumber('taxPct'),
    markupPct: nonNegNumber('markupPct'),
    status: (v) => (v === 'firm' || v === 'budget_pending') ? null : 'status must be "firm" or "budget_pending"',
    vendor: (v) => (v === null || typeof v === 'string') ? null : 'vendor must be a string or null',
    sort: (v) => Number.isFinite(Number(v)) ? null : 'sort must be a number',
  });
  if (!r.ok) return r;
  const value = { ...r.value } as Partial<QuoteInput>;
  if (value.amount != null) value.amount = Number(value.amount);
  if (value.taxPct != null) value.taxPct = Number(value.taxPct);
  if (value.markupPct != null) value.markupPct = Number(value.markupPct);
  if (value.sort != null) value.sort = Number(value.sort);
  return { ok: true, value };
}

router.post('/:bidId/accubid/quotes', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateQuoteInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const created = await createQuote(bidId, v.value);
  await persistPriceForBid(bidId);
  res.json(created);
});

router.put('/:bidId/accubid/quotes/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateQuotePatch(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const updated = await updateQuote(req.params.id, bidId, v.value);
  if (!updated) return res.status(404).json({ error: 'Quote not found' });
  await persistPriceForBid(bidId);
  res.json(updated);
});

router.delete('/:bidId/accubid/quotes/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const ok = await deleteQuote(req.params.id, bidId);
  if (!ok) return res.status(404).json({ error: 'Quote not found' });
  await persistPriceForBid(bidId);
  res.status(204).end();
});

function validateCostLineInput(body: unknown): ValidationResult<CostLineInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind === 'general_expense' ? 'general_expense' : b.kind === 'equipment' ? 'equipment' : null;
  if (!kind) return { ok: false, error: 'kind must be "equipment" or "general_expense"' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) return { ok: false, error: 'description is required' };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'amount must be a non-negative number' };
  const taxPct = b.taxPct != null ? Number(b.taxPct) : 0;
  if (!Number.isFinite(taxPct) || taxPct < 0) return { ok: false, error: 'taxPct must be a non-negative number' };
  return { ok: true, value: { kind, description, amount, taxPct, sort: b.sort != null ? Number(b.sort) : 0 } };
}

function validateCostLinePatch(body: unknown): ValidationResult<Partial<CostLineInput>> {
  const r = validatePartial<CostLineInput>(body, {
    kind: (v) => (v === 'equipment' || v === 'general_expense') ? null : 'kind must be "equipment" or "general_expense"',
    description: nonEmptyString('description'),
    amount: nonNegNumber('amount'),
    taxPct: nonNegNumber('taxPct'),
    sort: (v) => Number.isFinite(Number(v)) ? null : 'sort must be a number',
  });
  if (!r.ok) return r;
  const value = { ...r.value } as Partial<CostLineInput>;
  if (value.amount != null) value.amount = Number(value.amount);
  if (value.taxPct != null) value.taxPct = Number(value.taxPct);
  if (value.sort != null) value.sort = Number(value.sort);
  return { ok: true, value };
}

router.post('/:bidId/accubid/cost-lines', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateCostLineInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const created = await createCostLine(bidId, v.value);
  await persistPriceForBid(bidId);
  res.json(created);
});

router.put('/:bidId/accubid/cost-lines/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateCostLinePatch(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const updated = await updateCostLine(req.params.id, bidId, v.value);
  if (!updated) return res.status(404).json({ error: 'Cost line not found' });
  await persistPriceForBid(bidId);
  res.json(updated);
});

router.delete('/:bidId/accubid/cost-lines/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const ok = await deleteCostLine(req.params.id, bidId);
  if (!ok) return res.status(404).json({ error: 'Cost line not found' });
  await persistPriceForBid(bidId);
  res.status(204).end();
});

function validateAlternateInput(body: unknown): ValidationResult<AlternateInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind === 'deduct' ? 'deduct' : b.kind === 'add' ? 'add' : null;
  if (!kind) return { ok: false, error: 'kind must be "add" or "deduct"' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) return { ok: false, error: 'description is required' };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'amount must be a non-negative number' };
  return { ok: true, value: { kind, description, amount, sort: b.sort != null ? Number(b.sort) : 0 } };
}

function validateAlternatePatch(body: unknown): ValidationResult<Partial<AlternateInput>> {
  const r = validatePartial<AlternateInput>(body, {
    kind: (v) => (v === 'add' || v === 'deduct') ? null : 'kind must be "add" or "deduct"',
    description: nonEmptyString('description'),
    amount: nonNegNumber('amount'),
    sort: (v) => Number.isFinite(Number(v)) ? null : 'sort must be a number',
  });
  if (!r.ok) return r;
  const value = { ...r.value } as Partial<AlternateInput>;
  if (value.amount != null) value.amount = Number(value.amount);
  if (value.sort != null) value.sort = Number(value.sort);
  return { ok: true, value };
}

router.post('/:bidId/accubid/alternates', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateAlternateInput(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const created = await createAlternate(bidId, v.value);
  await persistPriceForBid(bidId);
  res.json(created);
});

router.put('/:bidId/accubid/alternates/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateAlternatePatch(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const updated = await updateAlternate(req.params.id, bidId, v.value);
  if (!updated) return res.status(404).json({ error: 'Alternate not found (or it is a system-computed one — those cannot be hand-edited)' });
  await persistPriceForBid(bidId);
  res.json(updated);
});

router.delete('/:bidId/accubid/alternates/:id', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const ok = await deleteAlternate(req.params.id, bidId);
  if (!ok) return res.status(404).json({ error: 'Alternate not found (or it is a system-computed one)' });
  await persistPriceForBid(bidId);
  res.status(204).end();
});

// ── Sheets (Phase B, Task 2) ─────────────────────────────────────────────────

// Fix round 1 / B9 — never blocks on indexing (see sheets.ts's listSheets
// doc comment): responds immediately with whatever's already indexed plus
// each plan document's status, after firing off (not awaiting) any
// indexing job it just became eligible to claim. `?refresh=1` (the
// frontend's "Refresh sheets" button) also re-claims already-'done'
// documents, not just pending/failed ones.
router.get('/:bidId/sheets', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const refresh = req.query.refresh === '1';
  const { sheets, statuses, indexErrors, documentNames } = await listSheets(bidId, { refresh });
  res.json({ sheets, statuses, indexErrors, documentNames });
});

// Authenticated PDF stream — never a public Drive link (env facts). Access is
// checked TWICE, deliberately: loadAccessibleBid gates this USER against this
// BID (same as every other route here), and loadPlanDocumentForBid separately
// requires the document to be linked_id=bidId — closing the gap where a user
// with legitimate access to bid A requests bid B's document id in bid A's URL.
router.get('/:bidId/sheets/:documentId/file', requireAuth, async (req: AuthRequest, res) => {
  const { bidId, documentId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const doc = await loadPlanDocumentForBid(bidId, documentId);
  if (!doc) return res.status(404).json({ error: 'Plan document not found for this bid' });

  // Fix round 1 / S4 — loadPlanDocumentForBid above now filters to
  // plans-category PDFs only (it used to accept ANY document linked to
  // the bid), but this is a second, independent guard: never trust
  // whatever Content-Type a re-fetched storage provider reports (Drive's
  // own mimeType, or a stale file_type column) for what gets sent to the
  // browser. A document that somehow isn't a real PDF gets 415, not a
  // 200 with an attacker-influenced Content-Type.
  if (doc.file_type && doc.file_type !== 'application/pdf') {
    return res.status(415).json({ error: 'This document is not a PDF' });
  }

  const streamed = await streamPlanDocument(doc);
  if (!streamed) return res.status(502).json({ error: 'Could not fetch the plan file. Try again later.' });

  // Always application/pdf — never streamed.contentType (which can carry
  // Drive's own reported mimeType) — plus the same Content-Disposition/
  // nosniff lockdown every other document-serving route in this app uses
  // (routes/documents.ts's serveDocument, audit Security #6). 'inline' is
  // safe here because the type is hard-pinned to application/pdf, one of
  // the two types serveDocument ever allows inline.
  serveDocument(res, 'application/pdf', doc.name, 'inline');
  // Never a shared/public cache — this bytes-over-the-wire response is
  // gated by requireAuth + the two ownership checks above, on every request.
  res.setHeader('Cache-Control', 'private, no-store');
  if (streamed.contentLength != null) res.setHeader('Content-Length', String(streamed.contentLength));
  streamed.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  streamed.stream.pipe(res);
});

router.put('/:bidId/sheets/:documentId/:pageIndex/scale', requireAuth, async (req: AuthRequest, res) => {
  const { bidId, documentId } = req.params;
  const pageIndex = Number(req.params.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return res.status(400).json({ error: 'pageIndex must be a non-negative integer' });
  }
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const ftPerPt = Number(body.ft_per_pt);
  if (!Number.isFinite(ftPerPt) || ftPerPt <= 0) {
    return res.status(400).json({ error: 'ft_per_pt must be a finite positive number' });
  }
  if (body.source !== 'calibrated' && body.source !== 'titleblock') {
    return res.status(400).json({ error: 'source must be "calibrated" or "titleblock"' });
  }

  const ok = await setSheetScale(bidId, documentId, pageIndex, {
    ft_per_pt: ftPerPt,
    source: body.source,
    label: typeof body.label === 'string' ? body.label : null,
  });
  // setSheetScale's UPDATE is scoped to (bid_id, document_id, page_index) —
  // this also 404s a documentId that belongs to a different bid, the same
  // cross-bid protection the file route gets from loadPlanDocumentForBid.
  if (!ok) return res.status(404).json({ error: 'Sheet not found for this bid/document/page' });
  res.json({ ok: true });
});

// Fix round 1 / B7 — "Half-size set?" toggle, per document.
router.put('/:bidId/sheets/:documentId/half-size', requireAuth, async (req: AuthRequest, res) => {
  const { bidId, documentId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.half_size !== 'boolean') {
    return res.status(400).json({ error: 'half_size must be a boolean' });
  }
  const ok = await setHalfSize(bidId, documentId, body.half_size);
  if (!ok) return res.status(404).json({ error: 'Document not found for this bid (no sheets indexed yet)' });
  res.json({ ok: true });
});

// ── Markups (Phase B, Task 3) ────────────────────────────────────────────────

router.get('/:bidId/markups', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const rawDocumentId = typeof req.query.document_id === 'string' ? req.query.document_id : undefined;
  // Fix round 1 / N5 — a non-UUID document_id used to reach
  // `WHERE document_id = $2` against a `uuid` column as-is: Postgres
  // rejects that with "invalid input syntax for type uuid", an unhandled
  // 500. A malformed filter is a client bug, not "no matches" — 400,
  // same as every other malformed-id case in this router (S5).
  if (rawDocumentId !== undefined && !UUID_RE.test(rawDocumentId)) {
    return res.status(400).json({ error: 'document_id must be a well-formed UUID' });
  }
  const pageIndex = req.query.page_index != null ? Number(req.query.page_index) : undefined;
  const markups = await getMarkups(bidId, { documentId: rawDocumentId, pageIndex: Number.isFinite(pageIndex as number) ? pageIndex : undefined });
  res.json({ markups });
});

router.post('/:bidId/markups/batch', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const v = validateMarkupBatch(req.body);
  const rejected = [...v.rejected];

  // Fix round 1 / B2 + S5 — a line_key that's well-formed but does not
  // belong to THIS bid's own est_bid_lines is rejected, same as before,
  // but now PER-ITEM (S5's fix) instead of 400ing the entire batch over
  // one bad reference — a well-formed UUID from a stale client cache (a
  // line deleted, or from a different bid entirely) no longer blocks
  // every OTHER item in the same save.
  const bidLines = await getBidLines(bidId);
  const validLineKeys = new Set(bidLines.map(l => l.line_key));
  const creates = v.creates.filter(c => {
    if (c.lineKey != null && !validLineKeys.has(c.lineKey)) {
      rejected.push({ id: c.id, reason: `line_key does not belong to this bid: ${c.lineKey}` });
      return false;
    }
    return true;
  });
  // Fix round 2 / R2-S3 — toWireMarkup (frontend) echoes every markup's
  // current line_key on EVERY update, not just ones that actually change
  // it (moving a point, confirming a suggested marker, etc. all resend the
  // unchanged line_key alongside whatever field really changed). If that
  // line was deleted out from under an already-placed marker, the marker
  // is legitimately "orphaned" but still fully editable — only a line_key
  // that's CHANGING to something invalid is a real problem. Compare each
  // update's line_key against what the marker already has on record: an
  // update that keeps its existing (possibly now-orphaned) line_key passes
  // through untouched; only a line_key that differs from the stored value
  // and isn't a valid line on this bid gets rejected. This is also what
  // lets an orphaned marker be moved, confirmed, or reassigned — a
  // reassignment sends a NEW, valid line_key, which was already accepted
  // before this fix; it's the "resend the same orphaned one" case that was
  // wrongly blocking every other field on the same update.
  const existingLineKeyById = await getMarkupLineKeysByIds(bidId, v.updates.map(u => u.id));
  const updates = v.updates.filter(u => {
    if (u.lineKey != null && !validLineKeys.has(u.lineKey)) {
      if (existingLineKeyById.get(u.id) === u.lineKey) return true; // unchanged — allow
      rejected.push({ id: u.id, reason: `line_key does not belong to this bid: ${u.lineKey}` });
      return false;
    }
    return true;
  });

  // Fix round 1 / S5 — document_id was never checked against this bid at
  // all: a count/linear markup could reference ANOTHER bid's document id
  // and still roll up on this one (getRollup joins on bid_id + line_key,
  // never cross-checks document_id). Only `creates` carry a document_id —
  // it's immutable after creation, so updates never send one. Checked
  // against every plans-category PDF LINKED to this bid (not just the
  // ones already indexed into est_sheets — B9's background indexing
  // means a just-uploaded document can be a legitimate target before its
  // own est_sheets rows exist yet).
  const planDocs = await getPlanPdfDocuments(bidId);
  const validDocumentIds = new Set(planDocs.map(d => d.id));
  const scopedCreates = creates.filter(c => {
    if (!validDocumentIds.has(c.documentId)) {
      rejected.push({ id: c.id, reason: `document_id does not belong to this bid: ${c.documentId}` });
      return false;
    }
    return true;
  });

  const result = await batchMarkups(bidId, req.user!.name ?? null, { creates: scopedCreates, updates, deletes: v.deletes });
  // One uniform shape for "this item didn't make it, and here's why" —
  // format/scope rejections (computed above, never reach the DB) and
  // batchMarkups' own DB-level skips (an id already claimed by another
  // bid, not found, etc.) both surface through the same `skipped` array
  // the client already knows how to read (useMarkupAutosave.ts's B3(a)
  // handling: any skipped item flips autosave to an explicit error
  // state rather than a silent 'saved').
  res.json({ ...result, skipped: [...rejected, ...result.skipped] });
});

router.get('/:bidId/markups/rollup', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const rollup = await getRollup(bidId);
  res.json({ rollup });
});

// Takeoff accuracy Task 6 — assign still-unassigned AI-suggested markers to
// the one saved line their type maps to (never reassigns, never touches a
// confirmed marker). The Plans view offers this once the estimate is saved.
router.post('/:bidId/markups/assign-ai', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;
  res.json(await assignAiMarkersToLines(bid.id));
});

router.post('/:bidId/apply-markups', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const lineKeys = Array.isArray(body.line_keys) ? body.line_keys.filter((x): x is string => typeof x === 'string') : [];
  if (lineKeys.length === 0) return res.status(400).json({ error: 'line_keys must be a non-empty array' });

  const result = await catchNonFiniteTotal(applyMarkups(bidId, lineKeys));
  if (!result.ok) return res.status(400).json({ error: 'Computed totals are not finite — refusing to apply' });
  res.json(result.value);
});

export default router;
