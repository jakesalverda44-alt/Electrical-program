// Next round Part B, Task 4 — calibration against Chris's real BOMs. Extends
// calibration.ts's existing "engine hours vs Accubid hours" report with a
// PER-CATEGORY comparison, driven by Chris's own quantities (a BOM row's own
// qty) rather than a takeoff's mapped quantities: for each BOM row, find the
// matching CURRENT library item (by the same deterministic code
// accubidImport.ts's import used, bomItemCode) and see whether the
// library's current labor_hours-per-unit still agrees with what THIS row
// says — useful once a library item has drifted from a single job's import
// (a calibration apply averaged it with other jobs, or an estimator hand-
// edited it). Read-only: this module suggests, it never writes anything —
// same "never auto-apply" rule as calibration.ts's applyCalibrationAdjustment.
import { parseAccubidBom, BOM_UNIT_DIVISOR } from './accubidBom';
import { ledProxyName, classifyBomCategory, bomItemCode } from './accubidImport';
import { EstUnit } from './pricing';

export interface LibraryHoursLookup {
  laborHours: number;
  unit: EstUnit;
}

export interface BomCategoryRowResult {
  description: string;
  category: string;
  code: string;
  matched: boolean;
  /** Chris's own hours for this row (already extended by qty + any labor adj%). */
  chrisHours: number;
  /** What the CURRENT library says for the SAME qty (row.qty / divisor * library.laborHours) — null when unmatched. */
  engineHours: number | null;
}

export interface BomCategoryGap {
  category: string;
  chrisHours: number;
  engineHours: number;
  matchedRowCount: number;
  unmatchedRowCount: number;
  /** (chrisHours/engineHours - 1) * 100 — positive means the library is
   *  UNDER Chris's real hours for this category (should go up); negative
   *  means the library is OVER. 0 when there's nothing matched to compare
   *  (never divides by zero). Same sign convention as calibration.ts's
   *  CategoryGap.suggestedAdjustmentPct, for one consistent reading across
   *  both calibration reports. */
  suggestedAdjustmentPct: number;
}

export interface BomCalibrationReport {
  jobRows: BomCategoryRowResult[];
  categoryGaps: BomCategoryGap[];
  totalChrisHours: number;
  totalEngineHours: number;
  totalMatchedRows: number;
  totalUnmatchedRows: number;
  parseWarnings: number;
}

/** Per-row comparison for ONE job's BOM text against the current library
 *  (a Map of bomItemCode -> {laborHours, unit}, however the caller sourced
 *  it — a DB-backed caller passes the real est_items table; tests pass a
 *  plain object). Pure: no I/O. */
export function computeBomRowResults(bomText: string, libraryByCode: Map<string, LibraryHoursLookup>): { rows: BomCategoryRowResult[]; parseWarnings: number } {
  const parsed = parseAccubidBom(bomText);
  const rows: BomCategoryRowResult[] = [];
  for (const row of parsed.rows) {
    if (row.laborUnit == null || row.totalFieldLaborHours == null) continue; // nothing to compare (a pure-material or unpriced row)
    const { canonical } = ledProxyName(row.description);
    const category = classifyBomCategory(canonical);
    const unit: EstUnit = row.unit === 'E' ? 'EA' : row.unit;
    const code = bomItemCode(canonical, unit);
    const lib = libraryByCode.get(code);
    const divisor = BOM_UNIT_DIVISOR[row.unit];
    // Apply the SAME row-level field-labor adjustment % Chris's own total
    // used (a site-condition adjustment, e.g. "25% labor adj" on a run of
    // conduit) — otherwise a library that's a PERFECT match of Chris's base
    // catalog rate would still show phantom drift on every adjusted row,
    // which isn't a calibration gap, it's just the adjustment.
    const adjMultiplier = 1 + (row.fieldLaborAdjPct ?? 0) / 100;
    const engineHours = lib ? (row.qty / divisor) * lib.laborHours * adjMultiplier : null;
    rows.push({
      description: canonical, category, code, matched: !!lib,
      chrisHours: row.totalFieldLaborHours, engineHours,
    });
  }
  return { rows, parseWarnings: parsed.warnings.length };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Aggregates per-row results (across one or more jobs — pass every job's
 *  rows concatenated) into per-category gaps and totals. */
export function aggregateBomCalibration(allRows: BomCategoryRowResult[], parseWarnings = 0): BomCalibrationReport {
  const byCategory = new Map<string, { chris: number; engine: number; matched: number; unmatched: number }>();
  let totalChrisHours = 0;
  let totalEngineHours = 0;
  let totalMatchedRows = 0;
  let totalUnmatchedRows = 0;

  for (const r of allRows) {
    const c = byCategory.get(r.category) ?? { chris: 0, engine: 0, matched: 0, unmatched: 0 };
    if (r.matched && r.engineHours != null) {
      c.chris += r.chrisHours;
      c.engine += r.engineHours;
      c.matched += 1;
      totalChrisHours += r.chrisHours;
      totalEngineHours += r.engineHours;
      totalMatchedRows += 1;
    } else {
      c.unmatched += 1;
      totalUnmatchedRows += 1;
    }
    byCategory.set(r.category, c);
  }

  const categoryGaps: BomCategoryGap[] = Array.from(byCategory.entries())
    .map(([category, v]) => ({
      category,
      chrisHours: round4(v.chris),
      engineHours: round4(v.engine),
      matchedRowCount: v.matched,
      unmatchedRowCount: v.unmatched,
      suggestedAdjustmentPct: v.engine > 0 ? round4((v.chris / v.engine - 1) * 100) : 0,
    }))
    .sort((a, b) => Math.abs(b.suggestedAdjustmentPct) - Math.abs(a.suggestedAdjustmentPct));

  return {
    jobRows: allRows, categoryGaps,
    totalChrisHours: round4(totalChrisHours), totalEngineHours: round4(totalEngineHours),
    totalMatchedRows, totalUnmatchedRows, parseWarnings,
  };
}

/** Convenience: one job's BOM text straight to the full report. */
export function computeBomCalibrationForJob(bomText: string, libraryByCode: Map<string, LibraryHoursLookup>): BomCalibrationReport {
  const { rows, parseWarnings } = computeBomRowResults(bomText, libraryByCode);
  return aggregateBomCalibration(rows, parseWarnings);
}

/** Multiple jobs' BOM texts against the same library, combined into one report. */
export function computeBomCalibrationForJobs(bomTexts: string[], libraryByCode: Map<string, LibraryHoursLookup>): BomCalibrationReport {
  let allRows: BomCategoryRowResult[] = [];
  let parseWarnings = 0;
  for (const text of bomTexts) {
    const { rows, parseWarnings: w } = computeBomRowResults(text, libraryByCode);
    allRows = allRows.concat(rows);
    parseWarnings += w;
  }
  return aggregateBomCalibration(allRows, parseWarnings);
}
