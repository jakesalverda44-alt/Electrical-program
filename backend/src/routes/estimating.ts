// Estimating labor engine — Task 5 routes, mounted at /api/estimating.
// Library reads are requireAuth; library writes are requireAdmin. Bid-level
// routes use the same loadAccessibleBid ownership check as routes/estimates.ts.
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
      source: raw.source as 'takeoff' | 'manual',
      sort: typeof raw.sort === 'number' ? raw.sort : undefined,
    });
  }
  return { ok: true, value: out };
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
  res.json({ lines: existingLines, settings, recap, proposed: false, savedGrandTotal });
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
  res.json({ ...result.value, recap });
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

  const result = await catchNonFiniteTotal(saveBidEstimate(bidId, linesV.value, settingsV.value));
  if (!result.ok) return res.status(400).json({ error: 'Computed totals are not finite — refusing to save' });
  res.json(result.value);
});

export default router;
