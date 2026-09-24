// Next round Part B, Task 1 — import a parsed Accubid BOM into the Labor
// Library (est_items / est_assemblies). Pure planning (buildImportPreview) +
// a thin DB-apply step (applyImportPreview), same split as library.ts's own
// create/update functions, which this module calls.
//
// Rules (Decision B1):
//  - Every row contributes its LABOR HOURS (Accubid's own units are stable
//    across jobs — the whole reason this import exists).
//  - Only the 2026 Kissimmee BOM (the one dated 2026-06-18) is the current
//    price source — a caller sets `applyPrices: true` for that import only.
//    An older BOM still creates a never-before-seen item (so its labor hours
//    aren't lost), but leaves material_cost at 0/unset rather than writing a
//    stale 2024 price.
//  - A `source='manual'` item is NEVER touched — Jake's edits always win.
//    An existing `source='accubid'|'seed'|'calibrated'` item is updated in
//    place (by its stable code) rather than duplicated.
//  - LED-proxy rows ("Luminaire ... - Fluorescent/HID/Metal Halide/
//    Incandescent Lamp Line Voltage") import under the LED-equivalent name —
//    Chris's crew installs LED fixtures; his 2024 Accubid catalog just
//    didn't have LED line items yet, so the fluorescent/HID catalog rows are
//    reused as this job's LABOR PROXY, never surfaced as "fluorescent" in a
//    2026+ shop.
import { TAKEOFF_CATEGORIES } from '../bidstd/boilerplate';
import { parseAccubidBom, BomRow, BomParseWarning, BOM_UNIT_DIVISOR } from './accubidBom';
import { EstUnit } from './pricing';
import { Library, LibraryItem, createItem, updateItem, createAssembly, updateAssembly } from './library';

const CAT = {
  SERVICE: TAKEOFF_CATEGORIES[0],
  INTLGT: TAKEOFF_CATEGORIES[1],
  EXTLGT: TAKEOFF_CATEGORIES[2],
  CONTROLS: TAKEOFF_CATEGORIES[3],
  BRANCH: TAKEOFF_CATEGORIES[4],
  SITE: TAKEOFF_CATEGORIES[5],
  LOWV: TAKEOFF_CATEGORIES[6],
  GROUND: TAKEOFF_CATEGORIES[7],
} as const;

// ── LED-proxy mapping ────────────────────────────────────────────────────────

const LED_PROXY_RE = /^(.*\bLuminaire\b.+?)\s*-\s*(Fluorescent|HID|Metal Halide|Incandescent Lamp Line Voltage)\b.*$/i;

/** Maps a 2024-era labor-proxy luminaire description to its LED-equivalent
 *  catalog name, keeping the labor hours exactly as printed (they ARE the
 *  proxy's whole purpose — Accubid's fixture install labor barely changed
 *  going from fluorescent/HID lamp+ballast to an LED integral driver). A
 *  non-luminaire row (a bulb, "Lamp T8 ... - Fluorescent") is never proxied —
 *  a shop that installs only LED-integral fixtures has no such item to
 *  replace, and importing it as-is (inactive/unmatched) is honest. */
export function ledProxyName(description: string): { canonical: string; wasProxy: boolean } {
  const m = description.match(LED_PROXY_RE);
  if (!m) return { canonical: description, wasProxy: false };
  return { canonical: `${m[1].trim()} - LED Integral Lamp`, wasProxy: true };
}

// ── Category classification (organizational only — see module note: this
// never affects a BID LINE's own category, only how the Labor Library groups
// the catalog row) ───────────────────────────────────────────────────────────

const CATEGORY_RULES: Array<{ re: RegExp; cat: string }> = [
  { re: /^Demolition -/i, cat: '' }, // resolved recursively below, against the demolished item's own text
  { re: /luminaire|lamp\b|exit light|unit equipment|emergency lighting/i, cat: CAT.INTLGT },
  { re: /pole (round|square)|wall pack|canopy|bollard|flood|area light/i, cat: CAT.EXTLGT },
  { re: /occupancy sensor|photocell|photo control|lighting contactor|relay panel|time clock/i, cat: CAT.CONTROLS },
  { re: /panelboard|safety switch|disconnect|transformer|meter socket|switchgear|switchboard|surge protective|automatic transfer|busway|service gutter/i, cat: CAT.SERVICE },
  { re: /pole base|auger|sono tube|re-?bar|anchor bolt|concrete|trench|handhole|pull box|directional bore/i, cat: CAT.SITE },
  { re: /ground (rod|bar|ring)|bonding jumper|ufer|exothermic|lightning protection/i, cat: CAT.GROUND },
  { re: /communication|control cable|data|fire alarm|catv|access control|camera|intercom/i, cat: CAT.LOWV },
];

/** Best-effort category for the Labor Library's own grouping — never used
 *  for a bid line's pricing category (see module note above). */
export function classifyBomCategory(description: string): string {
  const demo = description.match(/^Demolition\s*-\s*(.*)$/i);
  const text = demo ? demo[1] : description;
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text) && rule.cat) return rule.cat;
  }
  return CAT.BRANCH; // devices, wire, conduit, boxes, fittings — the catch-all, same as the seed library's own default
}

// ── Stable item code (idempotent re-import) ─────────────────────────────────

function slug(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** A code is derived from the CANONICAL description (post LED-proxy mapping)
 *  + unit, so the SAME physical item always lands on the same row no matter
 *  which job's BOM it was first seen on, and re-importing the same or an
 *  updated BOM updates that row instead of duplicating it. */
export function bomItemCode(canonicalDescription: string, unit: EstUnit): string {
  return `ACB-${slug(canonicalDescription)}-${unit}`;
}

function bomUnitToEstUnit(u: BomRow['unit']): EstUnit {
  return u === 'E' ? 'EA' : u;
}

// ── Per-row import plan ──────────────────────────────────────────────────────

export type ImportAction = 'create' | 'update' | 'skip_manual' | 'skip_no_labor' | 'skip_unparsed';

export interface ImportedItemPlan {
  action: ImportAction;
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  /** Hours per unit (per EA / per C / per M) — Accubid's own unit, carried
   *  through unchanged; this is the whole point of the import. */
  laborHours: number | null;
  /** $/unit — only set when this import is the price-authoritative BOM AND
   *  the row itself has a net cost. null means "don't touch material_cost". */
  materialCost: number | null;
  wasLedProxy: boolean;
  isDemolition: boolean;
  /** Present only for action 'update' — what the row would change from. */
  previous?: { laborHours: number; materialCost: number | null; source: string };
}

export interface ImportPreview {
  bomDate: string | null;
  applyPrices: boolean;
  rowCount: number;
  warnings: BomParseWarning[];
  items: ImportedItemPlan[];
  footerMaterialTotal: number | null;
  footerLaborHours: number | null;
  computedMaterialTotal: number;
  computedLaborHours: number;
  /** Reconciliation check: computed vs footer, within a cent / a thousandth
   *  hour — a caller can warn the estimator if a BOM's rows don't add up
   *  (a bad PDF export, or a parsing gap this module doesn't yet cover). */
  reconciles: boolean;
}

export interface BuildImportPreviewOptions {
  /** True only for the current-price BOM (the 2026-06-18 Kissimmee export). */
  applyPrices: boolean;
  bomDate?: string | null;
}

/** Builds a diff between a parsed BOM and the CURRENT library — never writes.
 *  Every row that carries labor hours becomes one item plan; a row with
 *  neither labor hours nor a name (never observed, but never assumed) is
 *  skipped rather than creating a zero-everything item. */
export function buildImportPreview(bomText: string, library: Library, opts: BuildImportPreviewOptions): ImportPreview {
  const parsed = parseAccubidBom(bomText);
  const byCode = new Map<string, LibraryItem>(library.items.map(i => [i.code, i]));

  const items: ImportedItemPlan[] = [];
  const seenCodes = new Set<string>();
  for (const row of parsed.rows) {
    const { canonical, wasProxy } = ledProxyName(row.description);
    const unit = bomUnitToEstUnit(row.unit);
    const code = bomItemCode(canonical, unit);
    // Two BOM rows can legitimately map to the same canonical item within
    // ONE import (e.g. the same fixture appearing on two floors of the plan
    // with different attribute text that happened to normalize the same) —
    // never plan the same code twice in one preview; the later occurrence's
    // labor hours would just overwrite the earlier one identically anyway
    // since they're the same catalog row.
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    const isDemolition = /^Demolition\s*-/i.test(row.description);
    const laborHours = row.laborUnit;
    if (laborHours == null) {
      items.push({
        action: 'skip_no_labor', code, name: canonical, category: classifyBomCategory(canonical),
        unit, laborHours: null, materialCost: null, wasLedProxy: wasProxy, isDemolition,
      });
      continue;
    }

    const materialCost = opts.applyPrices ? (row.netCost ?? (row.matCondition === 'No Cost' ? 0 : null)) : null;
    const existing = byCode.get(code);
    if (!existing) {
      items.push({
        action: 'create', code, name: canonical, category: classifyBomCategory(canonical),
        unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
      });
    } else if (existing.source === 'manual') {
      items.push({
        action: 'skip_manual', code, name: existing.name, category: existing.category,
        unit: existing.unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
        previous: { laborHours: existing.labor_hours, materialCost: existing.material_cost, source: existing.source },
      });
    } else {
      items.push({
        action: 'update', code, name: canonical, category: classifyBomCategory(canonical),
        unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
        previous: { laborHours: existing.labor_hours, materialCost: existing.material_cost, source: existing.source },
      });
    }
  }

  const reconciles = parsed.footerMaterialTotal == null
    || (Math.abs(parsed.computedMaterialTotal - parsed.footerMaterialTotal) < 0.02
        && Math.abs(parsed.computedLaborHours - (parsed.footerLaborHours ?? parsed.computedLaborHours)) < 0.002);

  return {
    bomDate: opts.bomDate ?? null,
    applyPrices: opts.applyPrices,
    rowCount: parsed.rows.length,
    warnings: parsed.warnings,
    items,
    footerMaterialTotal: parsed.footerMaterialTotal,
    footerLaborHours: parsed.footerLaborHours,
    computedMaterialTotal: parsed.computedMaterialTotal,
    computedLaborHours: parsed.computedLaborHours,
    reconciles,
  };
}

export interface ApplyImportResult { created: number; updated: number; skipped: number }

/** Writes a preview's create/update plans to the DB. Never touches a
 *  'skip_manual' row (Jake's edit stands) or a 'skip_no_labor' row (nothing
 *  usable to import). Idempotent: running the SAME preview twice updates the
 *  same rows to the same values the second time, it doesn't duplicate them —
 *  because the plan's `code` is deterministic (bomItemCode). */
export async function applyImportPreview(preview: ImportPreview): Promise<ApplyImportResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const plan of preview.items) {
    if (plan.action === 'skip_manual' || plan.action === 'skip_no_labor' || plan.action === 'skip_unparsed') {
      skipped++;
      continue;
    }
    if (plan.action === 'create') {
      try {
        await createItem({
          code: plan.code, name: plan.name, category: plan.category, unit: plan.unit,
          material_cost: plan.materialCost ?? 0,
          material_price_date: plan.materialCost != null ? (preview.bomDate ?? new Date().toISOString().slice(0, 10)) : null,
          labor_hours: plan.laborHours ?? 0,
        });
        // createItem always writes source='manual' by its own generic
        // contract (Task 5's admin-write path) — the accubid import needs
        // source='accubid' so a LATER import can update it and a manual
        // edit can still be told apart. Fixed up immediately, same
        // transaction cost as any other single-row UPDATE.
        await markAccubidSource(plan.code);
        created++;
      } catch (err) {
        // A concurrent import (two admins, or two BOMs sharing a row) can
        // race two creates for the SAME deterministic code — the loser
        // hits the unique constraint. Self-heal into an update rather than
        // failing the whole import: the code is idempotent by construction
        // (bomItemCode), so "someone already created this exact row" is
        // never wrong to treat as "update it".
        if ((err as { code?: string }).code !== '23505') throw err;
        const byCode = await findByCode(plan.code);
        if (byCode && byCode.source !== 'manual') {
          await updateItem(byCode.id, { labor_hours: plan.laborHours ?? byCode.labor_hours, ...(plan.materialCost != null ? { material_cost: plan.materialCost, material_price_date: preview.bomDate ?? new Date().toISOString().slice(0, 10) } : {}) });
          await markAccubidSource(plan.code);
          updated++;
        } else {
          skipped++;
        }
      }
    } else if (plan.action === 'update') {
      const byCode = await findByCode(plan.code);
      if (!byCode) { skipped++; continue; }
      await updateItem(byCode.id, {
        labor_hours: plan.laborHours ?? byCode.labor_hours,
        ...(plan.materialCost != null ? { material_cost: plan.materialCost, material_price_date: preview.bomDate ?? new Date().toISOString().slice(0, 10) } : {}),
      });
      await markAccubidSource(plan.code); // updateItem sets source='manual' on any field change — restore 'accubid'
      updated++;
    }
  }
  return { created, updated, skipped };
}

// updateItem/createItem (library.ts) always set source='manual' on a write —
// correct for an estimator's own edit, wrong for this import, which must
// stay 'accubid' so it's still update-able by a LATER import and still
// flagged as unverified/import-sourced in the UI. Both helpers below are
// tiny, deliberate exceptions to "go through library.ts's public API only",
// scoped to this one column. Safe to set unconditionally: the only caller
// (applyImportPreview/applyPoleBaseAssembly, above) calls this immediately
// after ITS OWN createItem/updateItem call for a plan whose action was never
// 'skip_manual' in the first place — buildImportPreview already filtered out
// any row a real source='manual' item exists for before this is ever reached.
import { pool } from '../db/pool';
async function markAccubidSource(code: string): Promise<void> {
  await pool.query(`UPDATE est_items SET source='accubid' WHERE code=$1`, [code]);
}
async function markAssemblyAccubidSource(code: string): Promise<void> {
  await pool.query(`UPDATE est_assemblies SET source='accubid' WHERE code=$1`, [code]);
}
async function findByCode(code: string): Promise<LibraryItem | null> {
  const { rows } = await pool.query('SELECT * FROM est_items WHERE code=$1', [code]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, code: r.code, name: r.name, category: r.category, unit: r.unit,
    material_cost: Number(r.material_cost), material_price_date: r.material_price_date,
    labor_hours: Number(r.labor_hours), aliases: r.aliases ?? [], source: r.source, active: r.active,
  };
}

// ── Pole-base assembly (auger, sono tube, rebar ring, rebar, concrete,
// anchor bolts — Decision B1: "pole-base assembly ... as library items/
// assemblies") ───────────────────────────────────────────────────────────────

const POLE_COUNT_RE = /\bPole (Round|Square)( Straight)? - /i;
const POLE_BASE_COMPONENT_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: 'Anchor Bolt Template', re: /Anchor Bolt Template/i },
  { key: 'Anchor Bolt', re: /Anchor Bolt - /i },
  { key: 'Re-Bar Ring', re: /Re-?Bar Ring/i },
  { key: 'Pole Base Auger', re: /Pole Base Auger \(Linear Foot\)/i },
  { key: 'Sono Tube', re: /Sono Tube/i },
  { key: 'Re-Bar (Linear Foot)', re: /Re-?Bar \(Linear Foot\)/i },
  { key: 'Concrete', re: /Concrete\s+[\d,]+\s*Lb\b/i },
  { key: 'Pole Base Auger Setup', re: /Pole Base Auger Setup/i },
  { key: 'Setup Concrete Pour', re: /Setup Concrete Pour/i },
];

export interface PoleBaseComponentPlan {
  key: string;
  description: string;
  unit: EstUnit;
  /** Total qty on the job, in the row's own unit basis (raw, not divided). */
  totalQty: number;
  /** totalQty / poleCount, in the library assembly's qty_per convention
   *  (item's own unit basis — e.g. 0.48 for 48 ft of a per-C item). */
  qtyPerPole: number;
  laborHoursUnit: number | null;
}

export interface PoleBaseAssemblyPlan {
  poleCount: number;
  components: PoleBaseComponentPlan[];
}

/** Finds a job's pole count and pole-base foundation components, and
 *  expresses each component as a qty-per-pole ratio — the inputs an
 *  assembly needs (assembly_components.qty_per is "qty of this item per 1
 *  assembly unit", in the ITEM's OWN unit basis; see library.ts /
 *  resolveAssemblyCost). Returns null when the job has no poles (most jobs)
 *  or no matching foundation line items (a job with poles but a
 *  by-others base, e.g. AutoZone Kissimmee — "base by others" per the seed
 *  library's own LTG-POLE note). */
export function derivePoleBaseAssembly(rows: BomRow[]): PoleBaseAssemblyPlan | null {
  const poleRow = rows.find(r => POLE_COUNT_RE.test(r.description));
  const poleCount = poleRow?.qty ?? 0;
  if (!poleCount) return null;

  const components: PoleBaseComponentPlan[] = [];
  for (const { key, re } of POLE_BASE_COMPONENT_PATTERNS) {
    const row = rows.find(r => re.test(r.description));
    if (!row) continue;
    const unit = bomUnitToEstUnit(row.unit);
    // qty_per must be in the item's OWN unit basis: a C-priced item's qty_per
    // is "hundreds of its raw count per pole" (divide the per-pole raw count
    // by the same C=100/M=1000 divisor pricing.ts and library.ts already
    // use), an EA/E item's qty_per is the raw per-pole count directly.
    const divisor = BOM_UNIT_DIVISOR[row.unit];
    const qtyPerPole = (row.qty / poleCount) / divisor;
    components.push({
      key, description: row.description, unit, totalQty: row.qty,
      qtyPerPole, laborHoursUnit: row.laborUnit,
    });
  }
  if (!components.length) return null;
  return { poleCount, components };
}

export const POLE_BASE_ASSEMBLY_CODE = 'ACB-POLE-BASE-FOUNDATION';

/** Writes (creates or updates) the pole-base items and the bundling
 *  assembly. Each component item is imported the same way a normal BOM row
 *  would be (idempotent by bomItemCode); the assembly itself is
 *  create-or-replace-components by its fixed code. */
export async function applyPoleBaseAssembly(
  plan: PoleBaseAssemblyPlan, library: Library, opts: { applyPrices: boolean; bomDate?: string | null }
): Promise<{ itemsCreated: number; itemsUpdated: number }> {
  const byCode = new Map(library.items.map(i => [i.code, i]));
  let itemsCreated = 0;
  let itemsUpdated = 0;
  const componentIds: { item_id: string; qty_per: number }[] = [];

  for (const c of plan.components) {
    const code = bomItemCode(c.description, c.unit);
    const existing = byCode.get(code);
    if (!existing) {
      const created = await createItem({
        code, name: c.description, category: CAT.SITE, unit: c.unit,
        material_cost: 0, material_price_date: null, labor_hours: c.laborHoursUnit ?? 0,
      });
      await markAccubidSource(code);
      componentIds.push({ item_id: created.id, qty_per: c.qtyPerPole });
      itemsCreated++;
    } else {
      if (existing.source !== 'manual') {
        await updateItem(existing.id, { labor_hours: c.laborHoursUnit ?? existing.labor_hours });
        await markAccubidSource(code);
        itemsUpdated++;
      }
      componentIds.push({ item_id: existing.id, qty_per: c.qtyPerPole });
    }
  }

  const existingAssembly = library.assemblies.find(a => a.code === POLE_BASE_ASSEMBLY_CODE);
  if (existingAssembly) {
    if (existingAssembly.source !== 'manual') {
      await updateAssembly(existingAssembly.id, { components: componentIds });
      await markAssemblyAccubidSource(POLE_BASE_ASSEMBLY_CODE); // updateAssembly also resets source to 'manual' on any change
    }
  } else {
    await createAssembly({
      code: POLE_BASE_ASSEMBLY_CODE,
      name: 'Pole Base — Concrete Foundation (per pole)',
      category: CAT.SITE, unit: 'EA',
      aliases: ['pole base', 'concrete pole base', 'pole foundation'],
      components: componentIds,
    });
    // createAssembly (library.ts) always writes source='manual' — same fixup
    // as markAccubidSource does for items, so a LATER re-import can still
    // update this assembly's components instead of being locked out forever.
    await markAssemblyAccubidSource(POLE_BASE_ASSEMBLY_CODE);
  }

  return { itemsCreated, itemsUpdated };
}

// ── Fittings ratios (conduit couplings/connectors/straps per 100 ft; box
// rings/covers per box) — Decision B1: "derive per-conduit-size ratios ...
// median across jobs). ───────────────────────────────────────────────────────

const RACEWAY_RE = /Conduit\s*-\s*(EMT|PVC(?:\s*40)?|RGD|RMC|LFMC)\b/i;
const COUPLING_RE = /\bCoupling\s*-\s*(EMT|PVC)\b/i;
const CONNECTOR_RE = /\bConnector\s*-\s*(EMT|PVC|Liquidtight)\b/i;
const STRAP_RE = /Strap\s*-|Strut Clamp\s*-|Conduit Clip/i;
const SIZE_PREFIX_RE = /^([\d]+(?:-[\d]+\/[\d]+)?(?:\/[\d]+)?")\s*/;

function leadingSize(desc: string): string | null {
  const m = desc.match(SIZE_PREFIX_RE);
  return m ? m[1] : null;
}
function racewayFamily(desc: string): 'EMT' | 'PVC' | 'OTHER' {
  if (/\bEMT\b/i.test(desc)) return 'EMT';
  if (/\bPVC\b/i.test(desc)) return 'PVC';
  return 'OTHER';
}

export interface ConduitFittingsSample {
  size: string;
  family: 'EMT' | 'PVC' | 'OTHER';
  /** Fittings per 100 ft of that size/family's conduit, this one job. */
  couplingsPer100: number | null;
  connectorsPer100: number | null;
  strapsPer100: number | null;
}

/** One job's own conduit -> fittings ratios, per (size, raceway family). */
export function deriveConduitFittingsForJob(rows: BomRow[]): ConduitFittingsSample[] {
  const conduitRows = rows.filter(r => RACEWAY_RE.test(r.description));
  const out: ConduitFittingsSample[] = [];
  for (const c of conduitRows) {
    const size = leadingSize(c.description);
    if (!size || !c.qty) continue;
    const family = racewayFamily(c.description);
    const sameSizeFamily = (d: string) => leadingSize(d) === size && racewayFamily(d) === family;
    const coupling = rows.find(r => COUPLING_RE.test(r.description) && sameSizeFamily(r.description));
    const connector = rows.find(r => CONNECTOR_RE.test(r.description) && sameSizeFamily(r.description));
    const strap = rows.find(r => STRAP_RE.test(r.description) && sameSizeFamily(r.description));
    out.push({
      size, family,
      couplingsPer100: coupling ? (coupling.qty * 100) / c.qty : null,
      connectorsPer100: connector ? (connector.qty * 100) / c.qty : null,
      strapsPer100: strap ? (strap.qty * 100) / c.qty : null,
    });
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Aggregates several jobs' samples into one median ratio per (size, family)
 *  — Decision B1's "median across jobs", so one unusually fitting-heavy or
 *  fitting-light job never sets the ratio by itself. */
export function medianConduitFittingsRatios(jobSamples: ConduitFittingsSample[][]): ConduitFittingsSample[] {
  const byKey = new Map<string, ConduitFittingsSample[]>();
  for (const samples of jobSamples) {
    for (const s of samples) {
      const key = `${s.size}::${s.family}`;
      const list = byKey.get(key) ?? [];
      list.push(s);
      byKey.set(key, list);
    }
  }
  return Array.from(byKey.entries()).map(([key, samples]) => {
    const [size, family] = key.split('::') as [string, ConduitFittingsSample['family']];
    return {
      size, family,
      couplingsPer100: median(samples.map(s => s.couplingsPer100).filter((v): v is number => v != null)),
      connectorsPer100: median(samples.map(s => s.connectorsPer100).filter((v): v is number => v != null)),
      strapsPer100: median(samples.map(s => s.strapsPer100).filter((v): v is number => v != null)),
    };
  });
}

// Plain 4" square box only — deliberately excludes "4-11/16"" boxes (a
// different device box) and never matches the box's OWN cover/mounting-
// bracket rows, which otherwise contain "Square Box" as a substring too.
const SQUARE_BOX_RE = /\b4"\s*Square Box\b(?!\s*(Cover|Mounting))/i;
const PLASTER_RING_RE = /Square Plaster Ring/i;
const BOX_COVER_RE = /Square Box Cover/i;

export interface BoxAccessorySample {
  boxQty: number;
  ringsPerBox: number | null;
  coversPerBox: number | null;
}

/** One job's box -> plaster-ring / cover ratios (both accessories for the
 *  same 4" square box: a ring for a device, a blank cover for a junction —
 *  Decision B1's "boxes/rings/covers per device"). */
export function deriveBoxAccessoriesForJob(rows: BomRow[]): BoxAccessorySample | null {
  const box = rows.find(r => SQUARE_BOX_RE.test(r.description));
  if (!box || !box.qty) return null;
  const ring = rows.find(r => PLASTER_RING_RE.test(r.description));
  const cover = rows.find(r => BOX_COVER_RE.test(r.description));
  return {
    boxQty: box.qty,
    ringsPerBox: ring ? ring.qty / box.qty : null,
    coversPerBox: cover ? cover.qty / box.qty : null,
  };
}

export function medianBoxAccessoryRatios(samples: Array<BoxAccessorySample | null>): { ringsPerBox: number | null; coversPerBox: number | null } {
  const real = samples.filter((s): s is BoxAccessorySample => s != null);
  return {
    ringsPerBox: median(real.map(s => s.ringsPerBox).filter((v): v is number => v != null)),
    coversPerBox: median(real.map(s => s.coversPerBox).filter((v): v is number => v != null)),
  };
}
