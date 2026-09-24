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
import { EstUnit, UNIT_DIVISOR } from './pricing';
import { Library, LibraryItem, createItem, updateItem, createAssembly, updateAssembly } from './library';
import { mapTakeoffLine } from './mapper';
import { toLibraryCandidates } from './bidEstimate';

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

// Review round 2 / S14 — the 40-char slice above merges different items whose
// canonical text agrees for the first 40 characters ("400A Safety Switch
// Heavy Duty Fusible 600V 3 Pole - NEMA 3R" and "...- NEMA 1" both slice to
// "400A-SAFETY-SWITCH-HEAVY-DUTY-FUSIBLE-6", identical), so the LAST import
// silently wins and overwrites the other's hours. A short hash of the FULL
// (untruncated) canonical text makes every distinct description produce a
// distinct code regardless of how long its common prefix is, while staying
// deterministic (same input -> same code, so re-importing the same BOM still
// updates the same row rather than duplicating it).
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

/** A code is derived from the CANONICAL description (post LED-proxy mapping)
 *  + unit, so the SAME physical item always lands on the same row no matter
 *  which job's BOM it was first seen on, and re-importing the same or an
 *  updated BOM updates that row instead of duplicating it. The hash suffix
 *  (S14) guarantees two DIFFERENT descriptions never collide just because
 *  they share their first 40 characters. */
export function bomItemCode(canonicalDescription: string, unit: EstUnit): string {
  return `ACB-${slug(canonicalDescription)}-${shortHash(canonicalDescription)}-${unit}`;
}

function bomUnitToEstUnit(u: BomRow['unit']): EstUnit {
  return u === 'E' ? 'EA' : u;
}

// ── Normalized item spec (kind + size + material) — review round 2 / B3 ─────
// "Import reconciliation matches existing items by a normalized spec: size +
// item kind + material/type. On a match it UPDATES the existing item; it
// never creates a same-meaning duplicate." This is a SEPARATE, more
// deterministic mechanism than the takeoff mapper's fuzzy/alias scoring
// (kept below as a fallback for names this simple keyword scan can't
// classify, e.g. a panelboard's full curated name) — reconciling a very
// consequential action (silently overwriting a library row's hours/price)
// off exact keyword+size+material agreement is safer to reason about and
// test than trusting alias-tier text scoring for it.

export type ItemKind =
  | 'coupling' | 'connector' | 'strap' | 'bushing' | 'locknut' | 'adapter' | 'elbow' | 'fitting'
  | 'conduit' | 'box' | 'wire' | 'device' | 'fixture' | 'panel' | 'disconnect'
  | 'transformer' | 'ground'
  // Device SUB-kinds, checked before the generic 'device' fallback — a
  // GFCI, duplex, single and switch at the SAME amp rating are different
  // real products (found in testing: "20A duplex" / "20A GFCI duplex" /
  // "20A single" all shared one "device|20a|" key and consolidated onto one
  // library row with three different real labor-hour rates).
  | 'device_gfci' | 'device_duplex' | 'device_single' | 'device_switch';

// Order matters: a FITTING word always wins over the bare-raceway fallback
// at the bottom (same rationale as mapper.ts's racewayKind) — "EMT coupling"
// is a coupling, not conduit. Checked top to bottom, first match wins.
const KIND_PATTERNS: Array<{ kind: ItemKind; re: RegExp }> = [
  { kind: 'coupling', re: /\bcoupling\b/i },
  { kind: 'connector', re: /\bconnector\b/i },
  { kind: 'strap', re: /\b(strut clamp|strap|clamp|clip)\b/i },
  { kind: 'bushing', re: /\bbushing\b/i },
  { kind: 'locknut', re: /\blocknut\b/i },
  { kind: 'adapter', re: /\badapter\b/i },
  { kind: 'elbow', re: /\belbow\b/i },
  // A generic "fitting" word (e.g. "Expansion fitting, conduit") must win
  // over the literal 'conduit' word check right below — found in testing:
  // "Expansion fitting, conduit" was misclassified as bare conduit (it
  // names no OTHER fitting keyword), colliding with a real bare-conduit
  // BOM row on the same normalized spec key.
  { kind: 'fitting', re: /\bfitting(s)?\b/i },
  // A "conduit body" (LB/T, condulet) is a FITTING, not a raceway run — it
  // names no size and often mentions a material ("EMT or rigid") generically
  // covering several, so without this it collides on the exact same
  // kind+material spec key as any plain EMT/rigid conduit row that also has
  // no size token, silently reconciling a run-of-conduit row onto the
  // catalog's conduit-body fitting (found via a synthetic-BOM route test:
  // FIT-CONDBODY's 0.25h leaked into a totally unrelated 3.2h conduit row).
  { kind: 'fitting', re: /\bconduit body\b/i },
  { kind: 'conduit', re: /\bconduit\b/i },
  { kind: 'box', re: /\bbox\b/i },
  { kind: 'wire', re: /\b(wire|cable)\b/i },
  { kind: 'device_gfci', re: /\bgfci\b/i },
  { kind: 'device_duplex', re: /\bduplex\b/i },
  { kind: 'device_switch', re: /\bswitch\b/i },
  { kind: 'device_single', re: /\bsingle\b/i },
  { kind: 'device', re: /\b(receptacle|outlet|decorator)\b/i },
  { kind: 'fixture', re: /\b(luminaire|fixture)\b/i },
  { kind: 'panel', re: /\bpanel(board)?\b/i },
  { kind: 'disconnect', re: /\b(disconnect|safety switch)\b/i },
  { kind: 'transformer', re: /\btransformer\b/i },
  { kind: 'ground', re: /\bground(ing)?\b/i },
  // Bare raceway fallback: a material tag with NO fitting/other kind word
  // above already matched implies bare conduit ("3/4\" EMT" names no kind
  // word at all, but IS conduit).
  { kind: 'conduit', re: /\b(emt|pvc|rmc|rigid|fmc|flex|lfmc|liquidtight)\b/i },
];

function inferItemKind(text: string): ItemKind | null {
  for (const { kind, re } of KIND_PATTERNS) if (re.test(text)) return kind;
  return null;
}

/** The first inch-fraction size ("3/4\""), wire gauge ("#12"), or amp rating
 *  named — enough to tell "3/4\" EMT" apart from "1\" EMT", or a "20A"
 *  device from a "30A" one, without needing a full dimensional parser. */
function extractSize(text: string): string | null {
  const inch = text.match(/(\d+(?:-\d+\/\d+)?(?:\/\d+)?)\s*"/);
  if (inch) return `${inch[1]}in`;
  const gauge = text.match(/#\s*(\d+(?:\/\d+)?)/);
  if (gauge) return `ga${gauge[1]}`;
  const amp = text.match(/\b(\d+)\s*a\b/i);
  if (amp) return `${amp[1]}a`;
  return null;
}

function extractMaterial(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bemt\b/.test(t)) return 'emt';
  if (/\bpvc\b/.test(t)) return 'pvc';
  if (/\b(rmc|rigid)\b/.test(t)) return 'rmc';
  if (/\b(lfmc|liquidtight)\b/.test(t)) return 'lfmc';
  if (/\b(fmc|flex)\b/.test(t)) return 'fmc';
  if (/\bmc\b/.test(t)) return 'mc';
  if (/\b(thhn|thwn)\b/.test(t)) return 'thhn';
  if (/\baluminum\b/.test(t)) return 'aluminum';
  if (/\bcopper\b/.test(t)) return 'copper';
  return null;
}

export interface NormalizedSpec { kind: ItemKind; size: string | null; material: string | null; key: string }

/** null when no kind word/material tag is recognized at all (an arbitrary
 *  catalog line like "Fire Rated Playwood" or "Misc Materials") — those
 *  never reconcile by spec, only by the mapper-based fallback below. */
export function normalizedItemSpec(description: string): NormalizedSpec | null {
  const kind = inferItemKind(description);
  if (!kind) return null;
  const size = extractSize(description);
  const material = extractMaterial(description);
  return { kind, size, material, key: `${kind}|${size ?? ''}|${material ?? ''}` };
}

// A found-in-testing follow-up to the review's own B3 ask: several "hardware"
// kinds (straps/clamps/clips, bushings, locknuts, adapters, elbows, boxes,
// fixtures, ground hardware) have MANY visually/physically different products
// that share the SAME kind + size + material — "3/4\" Conduit Clip Screw-On"
// vs "3/4\" Conduit Clip Snap Close" are different products, both kind=strap,
// size=3/4in, no material tag — and a plain fixture wattage/mount style isn't
// captured by `extractSize` at all ("175W Wall Mount" vs "250W Pole Top" both
// key to "fixture||"). Reconciling those by spec key risks silently merging
// two different real products' hours. Scoped to the kinds whose size+material
// combination genuinely, uniquely identifies one product in this catalog —
// raceway, wire, device (by amp rating), panel/disconnect (by amp rating) and
// transformer — where the review's own repro lives. Every kind is still
// useful for CATEGORY classification and the mapper's racewayKind guard; this
// only gates whether normalizedItemSpec's key is trusted for RECONCILIATION
// (silently updating an existing row).
const RECONCILABLE_KINDS = new Set<ItemKind>([
  'conduit', 'coupling', 'connector', 'wire', 'panel', 'disconnect', 'transformer',
  'device', 'device_gfci', 'device_duplex', 'device_single', 'device_switch',
]);

export function isReconcilableSpec(spec: NormalizedSpec | null): spec is NormalizedSpec {
  return !!spec && RECONCILABLE_KINDS.has(spec.kind);
}

// Review round 2 / R2-B1 — the seed catalog's "all-in" raceway items ("3/4\"
// EMT (incl. couplings/straps)", "rigid steel conduit (incl. fittings)",
// "PVC Sch 40 (incl. fittings/glue)") already bundle a size's typical
// coupling/connector/strap labor and material INTO the conduit rate. A real
// Accubid BOM export prices fittings as their OWN separate rows — Chris's
// "3/4\" Conduit - EMT 10' Lengths" row is bare-conduit-only labor (3.2 h/C),
// never the all-in figure (Chris's fittings for that run are priced on
// their own rows). Reconciling the bare-conduit row into the all-in item
// silently drops the fittings labor from every future takeoff that prices
// off it (the R2-B1 regression: EMT-075 dropped from 4.0h to 3.2h). A name
// carrying an "incl./including/w//with fittings/couplings/straps/glue"
// qualifier phrase is never a reconciliation target for a bare-conduit row.
const ALL_IN_RACEWAY_RE = /\b(?:incl\.?|including)\b|\bw\/\s*(?:fittings?|couplings?|straps?|glue)\b|\bwith\s+(?:fittings?|couplings?|straps?|glue)\b/i;
export function isAllInRacewayItem(name: string): boolean {
  return ALL_IN_RACEWAY_RE.test(name);
}

// ── Per-row import plan ──────────────────────────────────────────────────────

export type ImportAction = 'create' | 'update' | 'skip_manual' | 'skip_no_labor' | 'skip_unparsed' | 'propose_update';

export interface ImportedItemPlan {
  action: ImportAction;
  code: string;
  name: string;
  category: string;
  unit: EstUnit;
  /** Hours per unit (per EA / per C / per M) — Accubid's own unit, carried
   *  through unchanged; this is the whole point of the import. For
   *  'propose_update' this is the row's own value, offered for review —
   *  never applied automatically (see applyImportPreview). */
  laborHours: number | null;
  /** $/unit — only set when this import is the price-authoritative BOM AND
   *  the row itself has a net cost. null means "don't touch material_cost". */
  materialCost: number | null;
  wasLedProxy: boolean;
  isDemolition: boolean;
  /** Present for 'update' and 'propose_update' — what the row would change
   *  from (and, for a proposal, why it wasn't applied automatically).
   *  `unit` (N-R2-1) is the EXISTING item's own unit — needed to convert
   *  laborHours/materialCost into ITS basis if a unit_mismatch proposal is
   *  ever accepted (the row's own laborHours/materialCost are denominated
   *  in `unit` above, the ROW's unit, which is exactly what disagrees). */
  previous?: { laborHours: number; materialCost: number | null; source: string; unit: EstUnit };
  /** Set only for 'propose_update' — S15: a reconciled match whose UNIT
   *  disagrees with the existing item, or whose labor-hours delta is more
   *  than 2x, is never silently overwritten; it's offered here as a named
   *  reason for the estimator to accept or reject per row. */
  proposalReason?: 'unit_mismatch' | 'big_delta';
  /** Set only for 'skip_unparsed' — the raw line pdftotext gave, so the
   *  admin can see exactly what didn't import (S12/N17: never silently
   *  dropped). */
  rawLine?: string;
  /** Set only for 'skip_unparsed' — accubidBom.ts's own reason the line
   *  didn't parse (e.g. "no material condition found"), carried through so
   *  both the preview AND the apply result show WHY, not just WHICH line. */
  unparsedReason?: string;
}

export interface ImportPreview {
  /** Review round 2 / S11 — always the BOM's OWN header date (accubidBom.ts's
   *  parseHeaderDate), never a caller-supplied or hardcoded one. null when
   *  the header didn't carry a recognizable date. */
  bomDate: string | null;
  /** Whether prices were actually imported for this preview — both the
   *  admin's "update prices" checkbox AND the cutoff check had to pass. */
  applyPrices: boolean;
  /** True when the admin ticked "update prices" but the BOM's own header
   *  date is before `priceCutoffDate` (or missing) — prices were withheld
   *  even though they were requested, so a caller can tell the estimator why. */
  pricesBlockedByCutoff: boolean;
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

/** Review round 2 / S11 — a bid's price import is a RULE, not a caller flag:
 *  labor hours import from any BOM, but material prices only ever import
 *  from a BOM whose own header date is on or after this cutoff (2026 —
 *  Chris's Accubid catalog's prices are known-current only from the 2026
 *  Kissimmee export on; a 2024 job's prices are stale). Configurable so a
 *  later, newer round of BOMs doesn't need a code change to move it. */
export const DEFAULT_PRICE_IMPORT_CUTOFF = '2026-01-01';

export interface BuildImportPreviewOptions {
  /** The admin's "update prices" checkbox on the import screen — necessary
   *  but never sufficient on its own; see pricesBlockedByCutoff. */
  updatePrices: boolean;
  /** Defaults to DEFAULT_PRICE_IMPORT_CUTOFF. */
  priceCutoffDate?: string;
}

/** One entry per normalized-spec key, built from the CURRENT library — a
 *  curated (non-accubid) row always wins a collision (two rows sharing a
 *  spec key should not normally happen, but if it does, an estimator's own
 *  seed/manual row is the more trustworthy target). */
function buildSpecIndex(library: Library): Map<string, LibraryItem> {
  const index = new Map<string, LibraryItem>();
  for (const item of library.items) {
    if (!item.active) continue;
    const spec = normalizedItemSpec(item.name);
    if (!isReconcilableSpec(spec)) continue;
    // R2-B1 — an all-in raceway item is never a reconciliation target for a
    // bare-conduit BOM row (see isAllInRacewayItem's own comment). Scoped to
    // kind='conduit' only — an all-in item is always classified as bare
    // conduit by inferItemKind (it names no OTHER, more specific kind word),
    // so this never accidentally excludes a genuinely different kind.
    if (spec.kind === 'conduit' && isAllInRacewayItem(item.name)) continue;
    const cur = index.get(spec.key);
    if (!cur || (cur.source === 'accubid' && item.source !== 'accubid')) index.set(spec.key, item);
  }
  return index;
}

/** Builds a diff between a parsed BOM and the CURRENT library — never writes.
 *  Every row that carries labor hours becomes one item plan; a row with
 *  neither labor hours nor a name (never observed, but never assumed) is
 *  skipped rather than creating a zero-everything item. */
export function buildImportPreview(bomText: string, library: Library, opts: BuildImportPreviewOptions): ImportPreview {
  const parsed = parseAccubidBom(bomText);
  // Review round 2 / S11 — the rule: the admin's checkbox is necessary, the
  // BOM's OWN header date meeting the cutoff is necessary, either alone is
  // not sufficient. A BOM with no readable header date never gets prices
  // (never falls back to "today" or any other guess).
  const cutoff = opts.priceCutoffDate ?? DEFAULT_PRICE_IMPORT_CUTOFF;
  const priceDateEligible = parsed.reportDate != null && parsed.reportDate >= cutoff;
  const applyPrices = opts.updatePrices && priceDateEligible;
  const pricesBlockedByCutoff = opts.updatePrices && !priceDateEligible;
  const byCode = new Map<string, LibraryItem>(library.items.map(i => [i.code, i]));
  // Two reconciliation passes against the EXISTING catalog, so a BOM row for
  // "3/4" EMT" updates the library's one real "3/4" EMT" item instead of
  // creating a same-meaning duplicate under a different code:
  //  1. Review round 2 / B3 — a normalized spec key (kind + size + material),
  //     exact-match only. This is what catches "3/4\" EMT" -> EMT-075
  //     deterministically, and can never itself confuse a raceway with a
  //     fitting (inferItemKind gives them different kinds).
  //  2. The takeoff mapper's own exact/alias tiers (unchanged), for a name
  //     normalizedItemSpec can't classify at all (e.g. a panelboard's full
  //     curated name) — mapper.ts's own raceway-kind guard (same review
  //     round) makes this fallback safe for conduit/fitting text too.
  const specIndex = buildSpecIndex(library);
  const candidates = toLibraryCandidates(library, { activeOnly: true });

  const items: ImportedItemPlan[] = [];
  const seenCodes = new Set<string>();
  for (const row of parsed.rows) {
    const { canonical, wasProxy } = ledProxyName(row.description);
    const unit = bomUnitToEstUnit(row.unit);
    const deterministicCode = bomItemCode(canonical, unit);
    const isDemolition = /^Demolition\s*-/i.test(row.description);
    const laborHours = row.laborUnit;
    if (laborHours == null) {
      if (seenCodes.has(deterministicCode)) continue;
      seenCodes.add(deterministicCode);
      items.push({
        action: 'skip_no_labor', code: deterministicCode, name: canonical, category: classifyBomCategory(canonical),
        unit, laborHours: null, materialCost: null, wasLedProxy: wasProxy, isDemolition,
      });
      continue;
    }

    const rowSpec = normalizedItemSpec(canonical);
    let reconciledItem: LibraryItem | null = rowSpec ? (specIndex.get(rowSpec.key) ?? null) : null;
    if (!reconciledItem) {
      // Fallback: only an ITEM match at high confidence reconciles — an
      // assembly match (e.g. a whole duplex-circuit bundle) has no single
      // labor_hours field to update, so those rows keep the
      // deterministic-code path below.
      const mapped = mapTakeoffLine({ category: '', description: canonical, qty: 1, unit }, candidates);
      if (mapped.matchedKind === 'item' && (mapped.matchConfidence === 'exact' || mapped.matchConfidence === 'alias')) {
        const candidateItem = byCode.get(mapped.matchedCode!) ?? null;
        // R2-B1 — the mapper fallback must never reconcile a bare-conduit
        // row into an all-in item either (buildSpecIndex above already
        // excludes it from the SPEC-key path, but the mapper's own alias/
        // fuzzy tiers can still name it — R2-S1's own fix restored exactly
        // that alias match for the seed's all-in items).
        if (candidateItem && rowSpec?.kind === 'conduit' && isAllInRacewayItem(candidateItem.name)) {
          reconciledItem = null;
        } else {
          reconciledItem = candidateItem;
        }
      }
    }
    const code = reconciledItem?.code ?? deterministicCode;

    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    const materialCost = applyPrices ? (row.netCost ?? (row.matCondition === 'No Cost' ? 0 : null)) : null;
    const existing = reconciledItem ?? byCode.get(code) ?? null;
    if (!existing) {
      items.push({
        action: 'create', code, name: canonical, category: classifyBomCategory(canonical),
        unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
      });
    } else if (existing.source === 'manual') {
      items.push({
        action: 'skip_manual', code: existing.code, name: existing.name, category: existing.category,
        unit: existing.unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
        previous: { laborHours: existing.labor_hours, materialCost: existing.material_cost, source: existing.source, unit: existing.unit },
      });
    } else {
      // Review round 2 / S15 — never silently overwrite a reconciled item's
      // hours when the UNIT basis disagrees (its hours-per-unit means a
      // different thing) or when the delta is more than 2x (almost always a
      // wrong reconciliation, or an older/different BOM's stale number) —
      // propose it for the estimator's own review instead of applying it.
      const unitMismatch = existing.unit !== unit;
      const prevHours = existing.labor_hours;
      const bigDelta = prevHours > 0 && laborHours > 0 && (laborHours / prevHours >= 2 || prevHours / laborHours >= 2);
      if (reconciledItem && (unitMismatch || bigDelta)) {
        items.push({
          action: 'propose_update', code: existing.code, name: existing.name, category: existing.category,
          unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
          previous: { laborHours: existing.labor_hours, materialCost: existing.material_cost, source: existing.source, unit: existing.unit },
          proposalReason: unitMismatch ? 'unit_mismatch' : 'big_delta',
        });
      } else {
        items.push({
          // A reconciled match keeps the EXISTING curated name (never
          // overwritten with the BOM's own phrasing) — only its labor_hours
          // (and material_cost, when price-authoritative) update.
          action: 'update', code: existing.code, name: reconciledItem ? existing.name : canonical, category: existing.category,
          unit: existing.unit, laborHours, materialCost, wasLedProxy: wasProxy, isDemolition,
          previous: { laborHours: existing.labor_hours, materialCost: existing.material_cost, source: existing.source, unit: existing.unit },
        });
      }
    }
  }

  // Review round 2 / S12/N17 — every line pdftotext could shape-match a row
  // header (qty + a bare E/C/M unit column) but then failed to parse fully
  // is surfaced in the preview's own item list, not just the separate
  // `warnings` array a caller could ignore.
  for (const w of parsed.warnings) {
    items.push({
      action: 'skip_unparsed', code: '', name: w.line.trim().slice(0, 120), category: '', unit: 'EA',
      laborHours: null, materialCost: null, wasLedProxy: false, isDemolition: false, rawLine: w.line,
      unparsedReason: w.reason,
    });
  }

  const reconciles = parsed.footerMaterialTotal == null
    || (Math.abs(parsed.computedMaterialTotal - parsed.footerMaterialTotal) < 0.02
        && Math.abs(parsed.computedLaborHours - (parsed.footerLaborHours ?? parsed.computedLaborHours)) < 0.002);

  return {
    bomDate: parsed.reportDate,
    applyPrices,
    pricesBlockedByCutoff,
    rowCount: parsed.rows.length,
    warnings: parsed.warnings,
    items,
    footerMaterialTotal: parsed.footerMaterialTotal,
    footerLaborHours: parsed.footerLaborHours,
    computedMaterialTotal: parsed.computedMaterialTotal,
    computedLaborHours: parsed.computedLaborHours,
    // A missing footer is never "reconciled" (review round 2 / S12) — a
    // caller (the apply route) treats that the same as a real mismatch,
    // unless it passes force.
    reconciles: parsed.footerMaterialTotal != null && reconciles,
  };
}

export interface ApplyImportResult {
  created: number; updated: number; skipped: number; proposed: number;
  /** Review round 2 / S12/N17 — every line the BOM parser couldn't read at
   *  all (BomParseWarning), passed straight through from the preview so the
   *  APPLY result also lists them, not just the preview — an admin who
   *  never looked at the preview's own warnings still sees exactly what was
   *  never imported and why. */
  unparsed: BomParseWarning[];
}

export interface ApplyImportOptions {
  /** Review round 2 / S15 — a 'propose_update' row (unit mismatch or a >2x
   *  hours delta) is applied ONLY when its code is explicitly listed here —
   *  never automatically, no matter how confident the reconciliation was. */
  acceptProposals?: Set<string>;
}

// Review round 2 / N-R2-1 — converts a $/hours figure denominated in
// `fromUnit` into the equivalent figure denominated in `toUnit`, using the
// SAME EA=1/LF=1/C=100/M=1000 divisor convention pricing.ts's own priceBid
// extends lines with (UNIT_DIVISOR) — e.g. 0.9 h/EA becomes 90 h/C (a
// fixture that takes 0.9h each takes 90h per 100 of them), or 4.0 h/C
// becomes 0.04 h/EA. null in, null out.
function convertBetweenUnits(value: number | null, fromUnit: EstUnit, toUnit: EstUnit): number | null {
  if (value == null) return null;
  if (fromUnit === toUnit) return value;
  return value * (UNIT_DIVISOR[toUnit] / UNIT_DIVISOR[fromUnit]);
}

/** Writes a preview's create/update plans to the DB. Never touches a
 *  'skip_manual' row (Jake's edit stands) or a 'skip_no_labor' row (nothing
 *  usable to import). Idempotent: running the SAME preview twice updates the
 *  same rows to the same values the second time, it doesn't duplicate them —
 *  because the plan's `code` is deterministic (bomItemCode). */
export async function applyImportPreview(preview: ImportPreview, opts: ApplyImportOptions = {}): Promise<ApplyImportResult> {
  // Review round 2 / S11 — material_price_date is always preview.bomDate
  // (the BOM's own header date, from buildImportPreview) below, never
  // guessed as "today" the way it used to be: a plan's materialCost is only
  // ever non-null when buildImportPreview's own applyPrices was true, which
  // itself requires bomDate to be set and past the cutoff — so this is
  // never actually null on any path that reaches it.
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let proposed = 0;
  const acceptProposals = opts.acceptProposals ?? new Set<string>();
  for (const plan of preview.items) {
    if (plan.action === 'skip_manual' || plan.action === 'skip_no_labor' || plan.action === 'skip_unparsed') {
      skipped++;
      continue;
    }
    if (plan.action === 'propose_update' && !acceptProposals.has(plan.code)) {
      proposed++;
      continue;
    }
    if (plan.action === 'create') {
      try {
        await createItem({
          code: plan.code, name: plan.name, category: plan.category, unit: plan.unit,
          material_cost: plan.materialCost ?? 0,
          material_price_date: plan.materialCost != null ? (preview.bomDate) : null,
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
        const ok = await applyAccubidItemUpdate(plan.code, {
          laborHours: plan.laborHours, ...(plan.materialCost != null ? { materialCost: plan.materialCost, materialPriceDate: preview.bomDate } : {}),
        });
        if (ok) updated++; else skipped++;
      }
    } else if (plan.action === 'update' || plan.action === 'propose_update') {
      // Review round 2 / N-R2-1 — an ACCEPTED unit_mismatch proposal must
      // convert the row's own laborHours/materialCost (denominated in the
      // ROW's unit) into the EXISTING item's unit basis before writing —
      // its labor_hours/material_cost columns are still denominated in
      // `previous.unit`, since accepting a proposal never changes the
      // item's own `unit` column. A big_delta proposal (same unit on both
      // sides) needs no conversion.
      const needsUnitConversion = plan.action === 'propose_update' && plan.proposalReason === 'unit_mismatch' && plan.previous;
      const targetUnit = needsUnitConversion ? plan.previous!.unit : plan.unit;
      const laborHours = convertBetweenUnits(plan.laborHours, plan.unit, targetUnit);
      const materialCost = plan.materialCost != null ? convertBetweenUnits(plan.materialCost, plan.unit, targetUnit) : null;
      // Review round 2 / N17 — atomic: applyAccubidItemUpdate's own
      // `WHERE code=$1 AND source <> 'manual'` is the guard now, checked and
      // applied in the SAME statement — no separate SELECT that a
      // concurrent hand-edit could slip in behind.
      const ok = await applyAccubidItemUpdate(plan.code, {
        laborHours, ...(materialCost != null ? { materialCost, materialPriceDate: preview.bomDate } : {}),
      });
      if (ok) updated++; else skipped++;
    }
  }
  const unparsed = preview.items.filter(i => i.action === 'skip_unparsed')
    .map(i => ({ line: i.rawLine ?? i.name, reason: i.unparsedReason ?? 'could not be parsed' }));
  return { created, updated, skipped, proposed, unparsed };
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
/** Review round 2 / N17 — the accubid-import update path, made ATOMIC. What
 *  this replaced (a SELECT by code -> check source='manual' in JS -> a
 *  separate updateItem() call -> a separate markAccubidSource() call) left a
 *  real
 *  race window open THREE different ways: an admin's own hand-edit (which
 *  sets source='manual') landing between the SELECT and the first UPDATE,
 *  or between the two separate UPDATEs, would still get silently
 *  overwritten and relabelled 'accubid' — exactly what this guard exists to
 *  prevent. This does hours/cost/price-date AND (N-R2-2) the reconciled-
 *  provenance stamp in ONE statement, guarded by `WHERE code=$1 AND source
 *  <> 'manual'`, with COALESCE keeping the existing DB value for whichever
 *  field the plan didn't supply — no prior SELECT needed at all. 0 rows
 *  affected means either the code doesn't exist yet, or a concurrent manual
 *  edit won; the caller treats both exactly like the old skip_manual path.
 *
 *  Review round 2 / N-R2-2 — `source` is deliberately NEVER touched here any
 *  more (migration 132): a reconciled item keeps whatever provenance it
 *  already had ('seed' stays 'seed') so the mapper's own tie-break
 *  (preferCandidate) still ranks it as the curated row it is, instead of
 *  demoting it below every OTHER, un-reconciled seed item just because this
 *  one happened to get its numbers refreshed from a real BOM. The new
 *  accubid_reconciled_at timestamp records that reconciliation happened,
 *  independently of where the row itself came from. */
async function applyAccubidItemUpdate(
  code: string, patch: { laborHours: number | null; materialCost?: number | null; materialPriceDate?: string | null }
): Promise<boolean> {
  const setMaterial = patch.materialCost !== undefined;
  const { rowCount } = await pool.query(
    `UPDATE est_items
        SET labor_hours = COALESCE($1, labor_hours),
            material_cost = CASE WHEN $2::boolean THEN $3 ELSE material_cost END,
            material_price_date = CASE WHEN $2::boolean THEN $4 ELSE material_price_date END,
            accubid_reconciled_at = now(), updated_at = now()
      WHERE code = $5 AND source <> 'manual'`,
    [patch.laborHours, setMaterial, patch.materialCost ?? null, patch.materialPriceDate ?? null, code]
  );
  return (rowCount ?? 0) > 0;
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
  // Review round 2 / N17 — a job can have more than one pole ROW (different
  // pole heights/gauges are separate BOM lines, e.g. "20' H x 4-1/2\" Pole
  // Round Straight" and "25' H x 5\" Pole Round Straight" on the same job) —
  // sum every matching row's qty, never just the first one found.
  const poleRows = rows.filter(r => POLE_COUNT_RE.test(r.description));
  const poleCount = poleRows.reduce((sum, r) => sum + r.qty, 0);
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
  plan: PoleBaseAssemblyPlan, library: Library
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
