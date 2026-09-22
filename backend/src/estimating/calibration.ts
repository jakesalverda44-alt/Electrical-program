// Estimating labor engine — Task 6: calibration report. Read-only: for every
// bid that has BOTH an imported Accubid breakdown (real labor hours, from
// accubidParse.ts via bid_cost_breakdown) and a takeoff the engine can price
// (saved est_bid_lines, or a proposable mapping from the current takeoff),
// compares the engine's computed hours to Accubid's actual hours. Suggests a
// global and per-category adjustment; APPLYING it (writing source=
// 'calibrated' library rows) is a Settings button — Task 12, out of scope
// here.
import { pool } from '../db/pool';
import { PricingRecap } from './pricing';
import { getBidSettings, getBidLines, getProposedLinesFromTakeoff, priceUnsaved, computeRecapForBid } from './bidEstimate';

export interface BidCalibration {
  bidId: string;
  bidName: string;
  engineHours: number;
  accubidHours: number;
  /** engineHours / accubidHours — 1.0 means the engine matches Accubid exactly;
   *  >1 means the engine is estimating MORE hours than Accubid actually took. */
  ratio: number;
}

export interface CategoryGap {
  category: string;
  /** Total engine hours in this category, across every bid in the report. */
  totalEngineHours: number;
  /** Hours-weighted average (ratio - 1) across the bids that have hours in this
   *  category — the suggested per-category adjustment, as a percent. */
  suggestedAdjustmentPct: number;
}

export interface CalibrationReport {
  bids: BidCalibration[];
  /** Σ engineHours / Σ accubidHours across every bid in the report. */
  overallRatio: number;
  /** (overallRatio - 1) * 100 — e.g. +12 means seed hours should go up ~12%. */
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

    const deviation = ratio - 1;
    for (const cat of recap.categories) {
      if (cat.hours <= 0) continue;
      categoryEngineHours.set(cat.category, (categoryEngineHours.get(cat.category) ?? 0) + cat.hours);
      categoryWeightedDeviation.set(cat.category, (categoryWeightedDeviation.get(cat.category) ?? 0) + cat.hours * deviation);
    }
  }

  const totalEngineHours = bids.reduce((sum, b) => sum + b.engineHours, 0);
  const totalAccubidHours = bids.reduce((sum, b) => sum + b.accubidHours, 0);
  const overallRatio = totalAccubidHours > 0 ? totalEngineHours / totalAccubidHours : 1;

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
    suggestedGlobalAdjustmentPct: (overallRatio - 1) * 100,
    categoryGaps,
  };
}
