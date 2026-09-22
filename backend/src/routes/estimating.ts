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
} from '../estimating/bidEstimate';
import { EstUnit, LineConfidence } from '../estimating/pricing';
import { computeCalibrationReport } from '../estimating/calibration';

const router = Router();

const ALLOWED_UNITS: EstUnit[] = ['EA', 'LF', 'C', 'M'];
const ALLOWED_CONFIDENCE: LineConfidence[] = ['FIRM', 'APPROX', 'VERIFY'];

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
    if (raw.material_unit_override != null && !Number.isFinite(Number(raw.material_unit_override))) {
      return { ok: false, error: `material_unit_override must be a number for line "${label}"` };
    }
    if (raw.labor_hours_override != null && !Number.isFinite(Number(raw.labor_hours_override))) {
      return { ok: false, error: `labor_hours_override must be a number for line "${label}"` };
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
      category: String(raw.category ?? ''),
      description: String(raw.description ?? ''),
      qty,
      unit: raw.unit as EstUnit,
      assembly_id: (raw.assembly_id as string | null) ?? null,
      item_id: (raw.item_id as string | null) ?? null,
      takeoff_key: (raw.takeoff_key as string | null) ?? null,
      takeoff_item_id: (raw.takeoff_item_id as string | null) ?? null,
      material_unit_override: raw.material_unit_override != null ? Number(raw.material_unit_override) : null,
      labor_hours_override: raw.labor_hours_override != null ? Number(raw.labor_hours_override) : null,
      confidence: (raw.confidence as LineConfidence | null) ?? null,
      excluded: !!raw.excluded,
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
      return res.json({ lines: proposed.lines, settings, recap, proposed: true });
    }
  }

  const recap = await computeRecapForBid(bidId);
  res.json({ lines: existingLines, settings, recap, proposed: false });
});

router.post('/:bidId/sync-takeoff', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const result = await syncTakeoff(bidId);
  const recap = await computeRecapForBid(bidId);
  res.json({ ...result, recap });
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

  const { recap, bidEstimate } = await saveBidEstimate(bidId, linesV.value, settingsV.value);
  res.json({ recap, bidEstimate });
});

export default router;
