// Estimating labor engine — Task 6: calibration report. Read-only: for every
// bid that has BOTH an imported Accubid breakdown (real labor hours, from
// accubidParse.ts via bid_cost_breakdown) and a takeoff the engine can price
// (saved est_bid_lines, or a proposable mapping from the current takeoff),
// compares the engine's computed hours to Accubid's actual hours. Suggests a
// global and per-category adjustment. applyCalibrationAdjustment() below (a
// Part 2, Task 11 addition — the plan's "Apply suggested adjustment" Settings
// button needs somewhere to POST to) actually writes it.
import { pool } from '../db/pool';
import { PricingRecap } from './pricing';
import { getBidSettings, getBidLines, getProposedLinesFromTakeoff, priceUnsaved, computeRecapForBid } from './bidEstimate';
import { canonicalizeTakeoffCategory } from '../bidstd/boilerplate';

export interface BidCalibration {
  bidId: string;
  bidName: string;
  engineHours: number;
  accubidHours: number;
  /** engineHours / accubidHours — 1.0 means the engine matches Accubid exactly;
   *  >1 means the engine is estimating MORE hours than Accubid actually took.
   *  Diagnostic only — see suggestedAdjustmentPct (below, and on CategoryGap)
   *  for the number that actually corrects the seed library; it is NOT a
   *  simple sign-flip of this ratio (fix round 1 / B4). */
  ratio: number;
}

export interface CategoryGap {
  /** Always the canonical TAKEOFF_CATEGORIES spelling (fix round 1 / B4) — a
   *  takeoff-sourced line's raw category can be Agent 2's shorter,
   *  slash-free prompt-facing spelling ("Exterior Site Lighting"); without
   *  canonicalizing it here, applyCalibrationAdjustment's per-category
   *  UPDATE (which matches against est_items.category, always canonical)
   *  would match zero rows for exactly the categories most likely to need
   *  an adjustment. */
  category: string;
  /** Total engine hours in this category, across every bid in the report. */
  totalEngineHours: number;
  /** Hours-weighted average of each bid's (accubidHours/engineHours - 1)
   *  across the bids that have hours in this category — the suggested
   *  per-category adjustment, as a percent, to APPLY TO THE SEED (fix round
   *  1 / B4: not (engine/accubid - 1), which points the adjustment the
   *  wrong direction and by the wrong magnitude — a bid where the engine
   *  under-estimates by 20 hours out of 100 accubid hours needs +25%, not
   *  the -20% the old formula produced). */
  suggestedAdjustmentPct: number;
}

export interface CalibrationReport {
  bids: BidCalibration[];
  /** Σ engineHours / Σ accubidHours across every bid in the report — diagnostic only, see suggestedGlobalAdjustmentPct to actually correct the seed. */
  overallRatio: number;
  /** (Σ accubidHours / Σ engineHours - 1) * 100 — e.g. +12 means seed hours
   *  should go up ~12% to match what Accubid's real breakdowns show (fix
   *  round 1 / B4 — see CategoryGap.suggestedAdjustmentPct for why this
   *  isn't just -(overallRatio-1)*100). */
  suggestedGlobalAdjustmentPct: number;
  /** Sorted by |suggestedAdjustmentPct| descending — the biggest miscalibrations first. */
  categoryGaps: CategoryGap[];
}

interface CalibratableBid {
  id: string;
  name: string;
  accubidHours: number;
}

async function findCalibratableBids(): Promise<CalibratableBid[]> {
  const { rows } = await pool.query(`
    SELECT b.id, b.name, bcb.labor_hours
    FROM bids b
    JOIN bid_cost_breakdown bcb ON bcb.bid_id = b.id
    WHERE bcb.labor_hours IS NOT NULL AND bcb.labor_hours > 0 AND b.deleted_at IS NULL
  `);
  return rows.map(r => ({ id: r.id as string, name: r.name as string, accubidHours: Number(r.labor_hours) }));
}

/** The engine's recap for a bid, from its saved lines if any exist, else the
 *  unsaved proposed mapping from its current takeoff (never writes). Returns
 *  null when the bid has neither saved lines nor a takeoff to propose from —
 *  it isn't "a takeoff that maps through the engine" and is excluded from the
 *  report entirely, not counted as a 0-hour bid. */
async function recapForCalibration(bidId: string): Promise<PricingRecap | null> {
  const savedLines = await getBidLines(bidId);
  if (savedLines.length > 0) return computeRecapForBid(bidId);

  const proposed = await getProposedLinesFromTakeoff(bidId);
  if (!proposed.hasTakeoff) return null;
  const settings = await getBidSettings(bidId);
  return priceUnsaved(bidId, proposed.lines, settings);
}

export async function computeCalibrationReport(): Promise<CalibrationReport> {
  const candidates = await findCalibratableBids();

  const bids: BidCalibration[] = [];
  const categoryEngineHours = new Map<string, number>();
  const categoryWeightedDeviation = new Map<string, number>();

  for (const candidate of candidates) {
    const recap = await recapForCalibration(candidate.id);
    if (!recap) continue;
    const engineHours = recap.totals.laborHours;
    if (engineHours <= 0) continue;

    const ratio = engineHours / candidate.accubidHours;
    bids.push({ bidId: candidate.id, bidName: candidate.name, engineHours, accubidHours: candidate.accubidHours, ratio });

    // Fix round 1 / B4 — the CORRECTION to apply to the seed is
    // (accubid/engine - 1), not (engine/accubid - 1): if the engine
    // under-estimates (engineHours < accubidHours), the seed's hours need to
    // go UP, and by how much depends on accubid relative to engine, not the
    // other way around.
    const deviation = candidate.accubidHours / engineHours - 1;
    for (const cat of recap.categories) {
      if (cat.hours <= 0) continue;
      const category = canonicalizeTakeoffCategory(cat.category);
      categoryEngineHours.set(category, (categoryEngineHours.get(category) ?? 0) + cat.hours);
      categoryWeightedDeviation.set(category, (categoryWeightedDeviation.get(category) ?? 0) + cat.hours * deviation);
    }
  }

  const totalEngineHours = bids.reduce((sum, b) => sum + b.engineHours, 0);
  const totalAccubidHours = bids.reduce((sum, b) => sum + b.accubidHours, 0);
  const overallRatio = totalAccubidHours > 0 ? totalEngineHours / totalAccubidHours : 1;
  const suggestedGlobalAdjustmentPct = totalEngineHours > 0 ? (totalAccubidHours / totalEngineHours - 1) * 100 : 0;

  const categoryGaps: CategoryGap[] = Array.from(categoryEngineHours.entries())
    .map(([category, totalEngineHoursForCat]) => {
      const weighted = categoryWeightedDeviation.get(category) ?? 0;
      const suggestedAdjustmentPct = totalEngineHoursForCat > 0 ? (weighted / totalEngineHoursForCat) * 100 : 0;
      return { category, totalEngineHours: totalEngineHoursForCat, suggestedAdjustmentPct };
    })
    .sort((a, b) => Math.abs(b.suggestedAdjustmentPct) - Math.abs(a.suggestedAdjustmentPct));

  return {
    bids,
    overallRatio,
    suggestedGlobalAdjustmentPct,
    categoryGaps,
  };
}

export interface ApplyCalibrationInput {
  scope: 'global' | 'category';
  category?: string;
  /** e.g. 12 means +12% to every affected item's labor_hours. */
  adjustmentPct: number;
}

export interface ApplyCalibrationResult {
  updatedCount: number;
}

/**
 * Multiplies labor_hours on every active est_items row (optionally scoped to
 * one category) by (1 + adjustmentPct/100) and marks it source='calibrated'.
 * An estimator applying this is making a deliberate correction — it's the
 * one write path allowed to touch a 'seed' row's hours in bulk; every other
 * edit (library.ts's updateItem) already sets source='manual' on any single
 * field change, this is the calibration-specific bulk equivalent.
 */
// Fix round 1 / B4 — a calibration adjustment beyond ±50% is almost
// certainly a UI/unit mistake (a typo'd 500 instead of 50, or an
// accubid/engine ratio computed from a garbage bid), not a real correction —
// cap it rather than silently letting one bad "apply" wreck the whole
// library. -100% (multiplier 0) is already rejected below as not finite/
// sane for labor_hours.
const MAX_ABS_ADJUSTMENT_PCT = 50;

export async function applyCalibrationAdjustment(input: ApplyCalibrationInput): Promise<ApplyCalibrationResult> {
  if (!Number.isFinite(input.adjustmentPct) || Math.abs(input.adjustmentPct) > MAX_ABS_ADJUSTMENT_PCT) {
    throw new Error(`adjustmentPct must be a finite number within ±${MAX_ABS_ADJUSTMENT_PCT}`);
  }
  const multiplier = 1 + input.adjustmentPct / 100;
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error('adjustmentPct must be a finite number no less than -100');
  }
  if (input.scope === 'category') {
    if (!input.category) throw new Error('category is required when scope is "category"');
    // Fix round 1 / B4 — the report's category names are already
    // canonicalized (computeCalibrationReport), but apply is a public route
    // — canonicalize defensively here too so a caller passing Agent 2's
    // shorter spelling still matches est_items.category (always canonical).
    const category = canonicalizeTakeoffCategory(input.category);
    const { rows } = await pool.query(
      `UPDATE est_items SET labor_hours = ROUND((labor_hours * $1)::numeric, 4), source = 'calibrated', updated_at = now()
       WHERE active = true AND category = $2 RETURNING id`,
      [multiplier, category]
    );
    // Fix round 1 / B4 — 0 rows changed is a silent no-op that LOOKS like
    // success (200, updatedCount: 0) unless the caller happens to check the
    // count. A category adjustment that touches nothing is always a
    // mistake (an unrecognized/mistyped category), never a legitimate
    // outcome — surface it as an error instead.
    if (rows.length === 0) throw new Error(`No active items found in category "${category}" — nothing was adjusted`);
    return { updatedCount: rows.length };
  }
  const { rows } = await pool.query(
    `UPDATE est_items SET labor_hours = ROUND((labor_hours * $1)::numeric, 4), source = 'calibrated', updated_at = now()
     WHERE active = true RETURNING id`,
    [multiplier]
  );
  if (rows.length === 0) throw new Error('No active items found — nothing was adjusted');
  return { updatedCount: rows.length };
}
