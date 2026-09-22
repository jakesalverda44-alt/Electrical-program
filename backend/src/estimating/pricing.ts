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
// being summed.

export type EstUnit = 'EA' | 'LF' | 'C' | 'M';
export type LineConfidence = 'FIRM' | 'APPROX' | 'VERIFY';

/** Per-100 (C) / per-1000 (M) unit divisors; EA and LF are 1:1 with qty. */
const UNIT_DIVISOR: Record<EstUnit, number> = { EA: 1, LF: 1, C: 100, M: 1000 };

export interface PricingLineInput {
  /** Caller-assigned id (e.g. est_bid_lines.id) — carried through to the output line and warnings, never interpreted. */
  id: string;
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  /** Resolved per-unit material $ from the matched item/assembly components. 0 for an unmatched or manual line. */
  materialUnitCost: number;
  /** Resolved per-unit labor hours from the matched item/assembly components. 0 for an unmatched or manual line. */
  laborHoursUnit: number;
  materialUnitOverride?: number | null;
  laborHoursOverride?: number | null;
  confidence?: LineConfidence | null;
  excluded?: boolean;
  /** True when this line resolved to a real assembly or item (a manual line with typed overrides is not "matched"). */
  matched: boolean;
  /** True when this line came from the takeoff mapper with no library match at all and has no override yet — needs resolving in the UI. */
  unresolved?: boolean;
  /** True when the matched item/assembly's material price has no verified `material_price_date` (a seed row, or any row an estimator hasn't confirmed). */
  unverifiedPrice?: boolean;
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
}

export interface PricedLine {
  id: string;
  category: string;
  description: string;
  qty: number;
  unit: EstUnit;
  materialUnit: number;
  materialExt: number;
  hoursUnit: number;
  /** Extended hours AFTER factors, before the project-level supervision add-on (which is applied once, on the total — see PricingRecap.totals.laborHours). */
  hoursExt: number;
  laborExt: number;
  confidence: LineConfidence | null;
  excluded: boolean;
}

export interface CategoryTotal {
  category: string;
  material: number;
  hours: number;
  labor: number;
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
}

export interface PricingRecap {
  lines: PricedLine[];
  categories: CategoryTotal[];
  totals: PricingTotals;
  warnings: PricingWarnings;
}

function toCents(n: number): number {
  return Math.round(n * 100);
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

/** Sum of pcts, at most one per group_key (first occurrence per group wins — the UI is
 *  responsible for offering a single radio-style choice per group; this only guards
 *  against being handed more than one, which the plan calls "factor exclusivity"). */
export function effectiveFactorPct(factors: PricingFactorInput[]): number {
  const seenGroups = new Set<string>();
  let total = 0;
  for (const f of factors) {
    if (seenGroups.has(f.groupKey)) continue;
    seenGroups.add(f.groupKey);
    total += f.pct;
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
  const factorPct = effectiveFactorPct(factors);
  const factorMultiplier = 1 + factorPct / 100;

  const pricedLines: PricedLine[] = [];
  const categoryCents = new Map<string, { materialCents: number; hours: number; laborCents: number }>();

  let materialSubtotalCents = 0;
  let hoursRawTotal = 0; // sum of hoursExt (after factors), excluded lines omitted
  let unmatchedCount = 0;
  let verifyCount = 0;
  let zeroMaterialMatchedCount = 0;
  let excludedCount = 0;
  let unverifiedMaterialCents = 0;

  for (const line of lines) {
    const divisor = UNIT_DIVISOR[line.unit];
    const qtyFactor = line.qty / divisor;

    const materialUnit = line.materialUnitOverride ?? line.materialUnitCost;
    const hoursUnitEffective = line.laborHoursOverride ?? line.laborHoursUnit;

    const materialExt = roundMoney(materialUnit * qtyFactor);
    const hoursExtRaw = hoursUnitEffective * qtyFactor * factorMultiplier;
    const hoursExt = roundHours(hoursExtRaw);
    const laborExt = roundMoney(hoursExt * settings.laborRate);

    const excluded = !!line.excluded;
    if (excluded) excludedCount++;
    if (line.unresolved && !excluded) unmatchedCount++;
    if (line.confidence === 'VERIFY' && !excluded) verifyCount++;
    if (line.matched && !excluded && line.materialUnitOverride == null && line.materialUnitCost === 0) {
      zeroMaterialMatchedCount++;
    }

    pricedLines.push({
      id: line.id,
      category: line.category,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      materialUnit: roundMoney(materialUnit),
      materialExt,
      hoursUnit: roundHours(hoursUnitEffective),
      hoursExt,
      laborExt,
      confidence: line.confidence ?? null,
      excluded,
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

  const overhead = roundMoney(directCost * (settings.overheadPct / 100));
  const profit = roundMoney((directCost + overhead) * (settings.profitPct / 100));
  const grandTotal = fromCents(toCents(directCost) + toCents(overhead) + toCents(profit));

  const sellPerSf = settings.sqFt && settings.sqFt > 0 ? roundMoney(grandTotal / settings.sqFt) : null;
  const crewWeeks = settings.crewSize > 0 ? roundHours(laborHours / (settings.crewSize * 40)) : 0;

  const categories: CategoryTotal[] = Array.from(categoryCents.entries())
    .map(([category, v]) => ({
      category,
      material: fromCents(v.materialCents),
      hours: roundHours(v.hours),
      labor: fromCents(v.laborCents),
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
    },
  };
}
