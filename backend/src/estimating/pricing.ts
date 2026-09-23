// Estimating labor engine — Task 3: pure pricing engine.
//
// No DB, no I/O. Callers (bidEstimate.ts) resolve each line's per-unit
// material $ and labor hours from the library (an assembly's components or a
// bare item) before calling here; this module only does the math: unit
// conversion, factors, and the recap totals that Task 5's routes write into
// bid_estimates / bids.amount.
//
// Money rounding rule (picked once, applied everywhere, so totals never
// drift by a cent from summing independently-rounded lines): every money
// value is rounded to the nearest cent via integer-cent arithmetic
// (toCents/fromCents below), and every subtotal/total is a SUM OF ALREADY
// -ROUNDED CENTS, never a round of a sum of unrounded fractions. Hours are
// not money and are rounded only for display (roundHours), never before
// being summed. Fix round 1 / N1: `laborCost` is computed from TOTAL hours
// (which include the project-level supervision add-on), not from summing
// each line's own `laborExt` (which deliberately excludes supervision — see
// PricedLine.hoursExt below) — so "the grand total equals the sum of the
// displayed lines" is true for material, NOT for labor by itself. It IS true
// end to end: `directShare`/`CategoryTotal.subtotal` (fix round 1 / S10)
// allocate every add-on (consumables, tax, small tools, supervision) back
// onto lines/categories pro rata, so THOSE numbers do sum to `directCost`.

export type EstUnit = 'EA' | 'LF' | 'C' | 'M';
export type LineConfidence = 'FIRM' | 'APPROX' | 'VERIFY';
// Fix round 2 / SF1 — mirrors mapper.ts's MapConfidence (this module never
// imports from mapper.ts by design — pure/no cross-module coupling — so the
// same four values are declared again here).
export type MatchConfidence = 'exact' | 'alias' | 'fuzzy' | 'none';

/** Per-100 (C) / per-1000 (M) unit divisors; EA and LF are 1:1 with qty. */
const UNIT_DIVISOR: Record<EstUnit, number> = { EA: 1, LF: 1, C: 100, M: 1000 };

export interface PricingLineInput {
  /** Caller-assigned id (e.g. est_bid_lines.id) — carried through to the output line and warnings, never interpreted. */
  id: string;
  category: string;
  description: string;
  qty: number;
  /** The DISPLAY unit — what the estimator sees and what qty is counted in (e.g. "LF"). Never changed for pricing purposes. */
  unit: EstUnit;
  /** Fix round 1 / B1 — the matched item/assembly's OWN unit (e.g. "C" for
   *  a per-100-ft item), used instead of `unit` to pick the C/M divisor.
   *  `qty` is always a raw count in the DISPLAY unit's terms (e.g. 1200 raw
   *  linear feet for a "1200 LF" line); the item's price is quoted per
   *  `libraryUnit` (e.g. $/C = $/100ft), so the extension must divide by
   *  libraryUnit's divisor, not displayUnit's. Defaults to `unit` for a
   *  manual/unmatched line (no conversion). The caller (bidEstimate.ts) is
   *  responsible for never setting this to a unit incompatible with `unit`
   *  (EA can only ever pair with EA) — priceBid does not re-check that here,
   *  it trusts the resolved input the way every other field on this
   *  interface is trusted. */
  libraryUnit?: EstUnit | null;
  /** Resolved per-LIBRARY-unit material $ from the matched item/assembly components (e.g. $/C). 0 for an unmatched or manual line. */
  materialUnitCost: number;
  /** Resolved per-LIBRARY-unit labor hours from the matched item/assembly components. 0 for an unmatched or manual line. */
  laborHoursUnit: number;
  /** Fix round 2 / B1 — in the line's DISPLAY unit (`unit`), not the library
   *  unit — a $0.62 override on an LF line means $0.62/LF, even when the
   *  matched item is priced per-C. priceBid converts it to the library
   *  basis internally before extending. A manual/unmatched line has no
   *  separate library unit, so display and library basis are the same
   *  number there — manual and matched lines behave identically. */
  materialUnitOverride?: number | null;
  /** Fix round 2 / B1 — same DISPLAY-unit convention as materialUnitOverride. */
  laborHoursOverride?: number | null;
  confidence?: LineConfidence | null;
  excluded?: boolean;
  /** True when this line resolved to a real assembly or item (a manual line with typed overrides is not "matched"). */
  matched: boolean;
  /** True when this line came from the takeoff mapper with no library match at all and has no override yet — needs resolving in the UI. */
  unresolved?: boolean;
  /** True when the matched item/assembly's material price has no verified `material_price_date` (a seed row, or any row an estimator hasn't confirmed). */
  unverifiedPrice?: boolean;
  /** Fix round 1 / B2 — true when this line's raw unit is not one of the four
   *  known EstUnit values (LS/SET/LOT/blank/anything unrecognized). The
   *  caller (bidEstimate.ts) never lets such a line match a library row —
   *  it's priced only from an explicit override (materialUnitCost/
   *  laborHoursUnit are forced to 0), and defaults to $0 with a warning
   *  rather than ever producing NaN. */
  unitUnknown?: boolean;
  /** Fix round 2 / SF1 — how confident the mapper was about this line's
   *  match (null for a manual line, which never went through the mapper).
   *  Passed straight through to PricedLine for the UI to badge a 'fuzzy'
   *  match "check match", and counted in PricingWarnings.fuzzyMatchCount. */
  matchConfidence?: MatchConfidence | null;
}

export interface PricingFactorInput {
  code: string;
  pct: number;
  groupKey: string;
}

export interface PricingSettings {
  laborRate: number;
  materialTaxPct: number;
  smallToolsPct: number;
  supervisionPct: number;
  consumablesPct: number;
  overheadPct: number;
  profitPct: number;
  crewSize: number;
  /** Known square footage for the bid, when available — enables sell_per_sf. */
  sqFt?: number | null;
  /** Fix round 1 / N3 — count of floors above 2, multiplying the MULTI-STORY
   *  labor factor's pct (see effectiveFactorPct). A building's 3rd floor and
   *  up each adds the same per-floor labor penalty; the seed factor's own
   *  pct (3%) is the PER-FLOOR rate, not a flat one-time bump. Defaults to 0
   *  (no multi-story adjustment) when omitted. */
  floorsAbove2?: number;
}

export interface PricedLine {
  id: string;
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  /** Fix round 2 / B1 — always in this line's DISPLAY unit (`unit`, above),
   *  never the matched library item's own unit — e.g. $0.60/LF for an
   *  EMT-075 (C-priced, $60/C) match on an LF-display line. An active
   *  override is exactly what the estimator typed (already display-basis);
   *  otherwise it's the library cost converted library -> display. */
  materialUnit: number;
  materialExt: number;
  /** Fix round 2 / B1 — same DISPLAY-unit convention as materialUnit. */
  hoursUnit: number;
  /** Extended hours AFTER factors, before the project-level supervision add-on (which is applied once, on the total — see PricingRecap.totals.laborHours). */
  hoursExt: number;
  laborExt: number;
  confidence: LineConfidence | null;
  excluded: boolean;
  /** Fix round 2 / SF1 — see PricingLineInput.matchConfidence. */
  matchConfidence: MatchConfidence | null;
  /** Fix round 2 / SF2 — true when this line never resolved to a real
   *  library row (a takeoff line with no match, or one whose item_id/
   *  assembly_id turned out unit-incompatible and was discarded by
   *  resolveLines). The UI derives its "unresolved" banner/badge from THIS,
   *  not from id presence — an item_id can be set on a line that still
   *  didn't actually match (an incompatible unit silently prices it at $0). */
  unresolved: boolean;
  /** Fix round 1 / S10 — this line's fully-loaded share of `totals.directCost`:
   *  materialExt + this line's pro-rata share of consumables/tax (by material)
   *  plus laborExt-with-supervision + this line's pro-rata share of small
   *  tools (by hours). Every non-excluded line's directShare sums EXACTLY
   *  (to the cent) to totals.directCost — this is what bid_estimates'
   *  legacy `line_items[].total` should use instead of `materialExt+laborExt`
   *  alone, so Agent 4's per-item numbers add up to the real price. 0 for an
   *  excluded line. */
  directShare: number;
}

export interface CategoryTotal {
  category: string;
  material: number;
  hours: number;
  labor: number;
  /** Fix round 1 / S10 — this category's fully-loaded share of
   *  `totals.directCost` (same pro-rata allocation as PricedLine.directShare,
   *  grouped by category). Every category's subtotal sums EXACTLY to
   *  totals.directCost — use this for bid_estimates.subtotals, not
   *  material+labor alone. */
  subtotal: number;
}

export interface PricingTotals {
  materialSubtotal: number;
  consumables: number;
  materialTax: number;
  laborHours: number;
  laborCost: number;
  smallTools: number;
  directCost: number;
  overhead: number;
  profit: number;
  grandTotal: number;
  sellPerSf: number | null;
  crewWeeks: number;
}

export interface PricingWarnings {
  unmatchedCount: number;
  verifyCount: number;
  zeroMaterialMatchedCount: number;
  excludedCount: number;
  /** Share (0–1) of materialSubtotal that comes from lines whose price is unverified. */
  unverifiedMaterialShare: number;
  /** Fix round 1 / B2 — count of non-excluded lines with an unrecognized unit. */
  unitUnknownCount: number;
  /** Fix round 2 / SF1 — count of non-excluded lines the mapper matched only
   *  at 'fuzzy' confidence — worth a "check match" review, not wrong outright. */
  fuzzyMatchCount: number;
}

export interface PricingRecap {
  lines: PricedLine[];
  categories: CategoryTotal[];
  totals: PricingTotals;
  warnings: PricingWarnings;
}

// Fix round 1 / N1 — Math.round(n*100) rounds an exact half-cent DOWN on the
// binary-float artifacts IEEE 754 produces for values like 1.005 (whose
// nearest double is very slightly below 1.005), silently under-billing by a
// cent. Adding Number.EPSILON nudges it back onto the correct side without
// affecting any value that wasn't already ambiguous.
function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}
/** Pro-rata integer-cent allocation (fix round 1 / S10): splits `totalCents`
 *  across `weights` (need not sum to 1) so the shares sum EXACTLY to
 *  totalCents — the standard "round every share, then dump the leftover
 *  cents on the last one" fix for independent rounding never summing back to
 *  the total. All-zero weights (nothing to allocate by, e.g. every line
 *  excluded) puts the whole amount on the first share rather than losing it. */
function allocateProRata(weights: number[], totalCents: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const out = weights.map(() => 0);
    out[0] += totalCents;
    return out;
  }
  const rounded = weights.map(w => Math.round((w / sum) * totalCents));
  const diff = totalCents - rounded.reduce((a, b) => a + b, 0);
  rounded[rounded.length - 1] += diff;
  return rounded;
}
function fromCents(c: number): number {
  return c / 100;
}
/** Round a money value to the nearest cent (for a single field, not a running sum). */
function roundMoney(n: number): number {
  return fromCents(toCents(n));
}
function roundHours(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Fix round 1 / N3 — the seed's MULTI-STORY factor is deliberately labeled
// "per floor above 2": its pct is a PER-FLOOR rate, not a flat bump applied
// once whenever selected. Special-cased by groupKey since it's the only
// factor with a real per-unit basis (every other factor is a flat pct).
const PER_FLOOR_GROUP_KEY = 'multistory';

/** Sum of pcts, at most one per group_key (first occurrence per group wins — the UI is
 *  responsible for offering a single radio-style choice per group; this only guards
 *  against being handed more than one, which the plan calls "factor exclusivity").
 *  `floorsAbove2` (fix round 1 / N3) multiplies the multistory group's pct —
 *  0 floors above 2 means that factor contributes 0 even if selected. */
export function effectiveFactorPct(factors: PricingFactorInput[], floorsAbove2 = 0): number {
  const seenGroups = new Set<string>();
  let total = 0;
  for (const f of factors) {
    if (seenGroups.has(f.groupKey)) continue;
    seenGroups.add(f.groupKey);
    total += f.groupKey === PER_FLOOR_GROUP_KEY ? f.pct * Math.max(0, floorsAbove2) : f.pct;
  }
  return total;
}

/**
 * Price a set of resolved lines against bid settings and a factor selection.
 * Pure function: same input always produces the same output, byte for byte.
 */
export function priceBid(
  lines: PricingLineInput[],
  settings: PricingSettings,
  factors: PricingFactorInput[]
): PricingRecap {
  const factorPct = effectiveFactorPct(factors, settings.floorsAbove2 ?? 0);
  const factorMultiplier = 1 + factorPct / 100;

  const pricedLines: PricedLine[] = [];
  const categoryCents = new Map<string, { materialCents: number; hours: number; laborCents: number }>();

  let materialSubtotalCents = 0;
  let hoursRawTotal = 0; // sum of hoursExt (after factors), excluded lines omitted
  let unmatchedCount = 0;
  let verifyCount = 0;
  let zeroMaterialMatchedCount = 0;
  let unitUnknownCount = 0;
  let fuzzyMatchCount = 0;
  let excludedCount = 0;
  let unverifiedMaterialCents = 0;

  // Fix round 1 / S10 — tracked per line, parallel to `pricedLines` (0 for an
  // excluded line), so the post-loop pro-rata pass below can hand every line
  // an exact, reconciling `directShare`.
  const lineMaterialCents: number[] = [];
  const lineHoursExt: number[] = [];

  for (const line of lines) {
    // Fix round 1 / B1 — price against the MATCHED LIBRARY item's own unit
    // (its $/hrs are quoted per that unit), never the line's display unit;
    // they only differ when the takeoff's raw unit ("LF") isn't the item's
    // pricing denomination ("C" = per 100 ft, "M" = per 1000 ft). `qty` stays
    // a raw count in display-unit terms either way (1200 raw linear feet for
    // a "1200 LF" line) — only the divisor changes. Fix round 1 / B2 — a
    // missing divisor (a unit that slipped past upstream normalization)
    // falls back to 1 (treated as a straight per-unit count) instead of
    // propagating NaN through the whole recap.
    const libDivisor = UNIT_DIVISOR[line.libraryUnit ?? line.unit] ?? 1;
    const displayDivisor = UNIT_DIVISOR[line.unit] ?? 1;
    const qtyFactor = line.qty / libDivisor;

    // Fix round 2 / B1 — an override is entered AND displayed in the line's
    // own DISPLAY unit (a $/LF override on an LF line reads as $/LF, even
    // when the matched library item is priced per-C or per-M). `unitRatio`
    // converts a display-basis $/unit into the library-basis $/unit the
    // qtyFactor math below expects (qtyFactor already divides by the
    // LIBRARY divisor) — 1 for a manual/unmatched line (no libraryUnit) or
    // any line whose display unit already equals its library unit, so
    // manual and matched lines behave identically. Round-1's bug: an
    // override was applied as if it were already library-basis, so a
    // $0.62/LF override on an EMT-075 (C-priced) line extended as if it
    // were $0.62/C — 100x too low.
    const unitRatio = libDivisor / displayDivisor;
    const materialUnitLibraryBasis = line.materialUnitOverride != null
      ? line.materialUnitOverride * unitRatio
      : line.materialUnitCost;
    const hoursUnitLibraryBasis = line.laborHoursOverride != null
      ? line.laborHoursOverride * unitRatio
      : line.laborHoursUnit;

    // Fix round 1 / B2 — a NaN/Infinity anywhere upstream (a corrupt override,
    // a qty that slipped through as non-numeric) must never propagate into
    // the recap; treat it as $0/0h for this line rather than poisoning every
    // total downstream. The route-level guard (routes/estimating.ts) still
    // refuses to WRITE a recap whose grand total isn't finite — this is the
    // pure-function-level "never produce NaN" backstop underneath that.
    const materialExtRaw = materialUnitLibraryBasis * qtyFactor;
    const materialExt = Number.isFinite(materialExtRaw) ? roundMoney(materialExtRaw) : 0;
    const hoursExtRaw = hoursUnitLibraryBasis * qtyFactor * factorMultiplier;
    const hoursExt = Number.isFinite(hoursExtRaw) ? roundHours(hoursExtRaw) : 0;
    const laborExtRaw = hoursExt * settings.laborRate;
    const laborExt = Number.isFinite(laborExtRaw) ? roundMoney(laborExtRaw) : 0;

    // Fix round 2 / B1 — materialUnit/hoursUnit (below, in PricedLine) report
    // in the DISPLAY unit for the UI: an active override is already what the
    // estimator typed (display-basis, no conversion needed); the un-
    // overridden library cost/hours get converted library -> display (the
    // inverse of the override conversion above).
    const materialUnitDisplayRaw = line.materialUnitOverride != null
      ? line.materialUnitOverride
      : line.materialUnitCost / unitRatio;
    const materialUnitDisplay = Number.isFinite(materialUnitDisplayRaw) ? materialUnitDisplayRaw : 0;
    const hoursUnitDisplayRaw = line.laborHoursOverride != null
      ? line.laborHoursOverride
      : line.laborHoursUnit / unitRatio;
    const hoursUnitDisplay = Number.isFinite(hoursUnitDisplayRaw) ? hoursUnitDisplayRaw : 0;

    const excluded = !!line.excluded;
    if (excluded) excludedCount++;
    if (line.unresolved && !excluded) unmatchedCount++;
    if (line.confidence === 'VERIFY' && !excluded) verifyCount++;
    if (line.unitUnknown && !excluded) unitUnknownCount++;
    if (line.matchConfidence === 'fuzzy' && !excluded) fuzzyMatchCount++;
    if (line.matched && !excluded && line.materialUnitOverride == null && line.materialUnitCost === 0) {
      zeroMaterialMatchedCount++;
    }

    pricedLines.push({
      id: line.id,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      materialUnit: roundMoney(materialUnitDisplay),
      materialExt,
      hoursUnit: roundHours(hoursUnitDisplay),
      hoursExt,
      laborExt,
      confidence: line.confidence ?? null,
      matchConfidence: line.matchConfidence ?? null,
      unresolved: !!line.unresolved,
      excluded,
      directShare: 0, // filled in below, once the pools it's allocated from are known
    });

    if (!excluded) {
      const materialCents = toCents(materialExt);
      const laborCents = toCents(laborExt);
      materialSubtotalCents += materialCents;
      hoursRawTotal += hoursExt;
      if (line.unverifiedPrice) unverifiedMaterialCents += materialCents;

      const cat = categoryCents.get(line.category) ?? { materialCents: 0, hours: 0, laborCents: 0 };
      cat.materialCents += materialCents;
      cat.hours += hoursExt;
      cat.laborCents += laborCents;
      categoryCents.set(line.category, cat);

      lineMaterialCents.push(materialCents);
      lineHoursExt.push(hoursExt);
    } else {
      lineMaterialCents.push(0);
      lineHoursExt.push(0);
    }
  }

  const materialSubtotal = fromCents(materialSubtotalCents);
  const consumables = roundMoney(materialSubtotal * (settings.consumablesPct / 100));
  const materialTax = roundMoney((materialSubtotal + consumables) * (settings.materialTaxPct / 100));

  const laborHours = roundHours(hoursRawTotal * (1 + settings.supervisionPct / 100));
  const laborCost = roundMoney(laborHours * settings.laborRate);
  const smallTools = roundMoney(laborCost * (settings.smallToolsPct / 100));

  const directCostCents = toCents(materialSubtotal) + toCents(consumables) + toCents(materialTax)
    + toCents(laborCost) + toCents(smallTools);
  const directCost = fromCents(directCostCents);

  // Fix round 1 / S10 — allocate the two add-on "pools" (material subtotal +
  // consumables + tax, by each non-excluded line's share of material; labor
  // cost + small tools, by each non-excluded line's share of hours) back onto
  // every line, cent-exact, so Σ directShare === directCost exactly. Restricted
  // to non-excluded indices so the "nothing to allocate by" fallback in
  // allocateProRata (which dumps the whole pool on the first weight) can never
  // land on an excluded line.
  const nonExcludedIdx = pricedLines.map((l, i) => (l.excluded ? -1 : i)).filter(i => i >= 0);
  if (nonExcludedIdx.length > 0) {
    const materialPoolCents = toCents(materialSubtotal) + toCents(consumables) + toCents(materialTax);
    const laborPoolCents = toCents(laborCost) + toCents(smallTools);
    const materialWeights = nonExcludedIdx.map(i => lineMaterialCents[i]);
    const hoursWeights = nonExcludedIdx.map(i => lineHoursExt[i]);
    const materialAlloc = allocateProRata(materialWeights, materialPoolCents);
    const laborAlloc = allocateProRata(hoursWeights, laborPoolCents);
    nonExcludedIdx.forEach((lineIdx, j) => {
      pricedLines[lineIdx].directShare = fromCents(materialAlloc[j] + laborAlloc[j]);
    });
  }

  const overhead = roundMoney(directCost * (settings.overheadPct / 100));
  const profit = roundMoney((directCost + overhead) * (settings.profitPct / 100));
  const grandTotal = fromCents(toCents(directCost) + toCents(overhead) + toCents(profit));

  const sellPerSf = settings.sqFt && settings.sqFt > 0 ? roundMoney(grandTotal / settings.sqFt) : null;
  const crewWeeks = settings.crewSize > 0 ? roundHours(laborHours / (settings.crewSize * 40)) : 0;

  // Fix round 1 / S10 — category subtotals are the sum of each of their
  // lines' already-exact `directShare` (itself in exact cents), so summing
  // per category needs no further rounding and still reconciles exactly to
  // directCost overall.
  const categorySubtotalCents = new Map<string, number>();
  for (const line of pricedLines) {
    if (line.excluded) continue;
    categorySubtotalCents.set(line.category, (categorySubtotalCents.get(line.category) ?? 0) + toCents(line.directShare));
  }

  const categories: CategoryTotal[] = Array.from(categoryCents.entries())
    .map(([category, v]) => ({
      category,
      material: fromCents(v.materialCents),
      hours: roundHours(v.hours),
      labor: fromCents(v.laborCents),
      subtotal: fromCents(categorySubtotalCents.get(category) ?? 0),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const unverifiedMaterialShare = materialSubtotalCents > 0
    ? Math.round((unverifiedMaterialCents / materialSubtotalCents) * 10000) / 10000
    : 0;

  return {
    lines: pricedLines,
    categories,
    totals: {
      materialSubtotal,
      consumables,
      materialTax,
      laborHours,
      laborCost,
      smallTools,
      directCost,
      overhead,
      profit,
      grandTotal,
      sellPerSf,
      crewWeeks,
    },
    warnings: {
      unmatchedCount,
      verifyCount,
      zeroMaterialMatchedCount,
      excludedCount,
      unverifiedMaterialShare,
      unitUnknownCount,
      fuzzyMatchCount,
    },
  };
}
