// Next round Part B, Task 4 — calibration against Chris's real BOMs. Extends
// calibration.ts's existing "engine hours vs Accubid hours" report with a
// PER-CATEGORY comparison, driven by Chris's own quantities (a BOM row's own
// qty) rather than a takeoff's mapped quantities: for each BOM row, find the
// item/assembly a REAL TAKEOFF LINE with this description would actually
// price from (the same mapper.ts matching every other takeoff line goes
// through) and see whether its current labor_hours-per-unit still agrees
// with what THIS row says — useful once a library item has drifted from a
// single job's import (a calibration apply averaged it with other jobs, or
// an estimator hand-edited it). Read-only: this module suggests, it never
// writes anything — same "never auto-apply" rule as calibration.ts's
// applyCalibrationAdjustment.
//
// Review round 2 / N16 — this USED to look the row up by its own
// `bomItemCode` (the deterministic code the IMPORT would have minted for
// it). Once accubidImport.ts's import reconciles a row onto an EXISTING
// seed item (B3's fix — a real "3/4\" EMT" row updates EMT-075 directly,
// never creating its own ACB- code), looking the row up by its own code
// finds NOTHING (or, worse, a stale/never-written code), and the delta this
// module is supposed to catch — "the library has drifted from what THIS row
// says" — silently reads as ~0 because the row's hours WERE the ones just
// written under that code. Matching through the mapper instead compares
// against whatever a takeoff line actually resolves to today, which is the
// number that matters.
import { parseAccubidBom, BOM_UNIT_DIVISOR } from './accubidBom';
import { ledProxyName, classifyBomCategory, normalizedItemSpec, isReconcilableSpec } from './accubidImport';
import { mapTakeoffLine, LibraryCandidate } from './mapper';
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

/** Same normalized-spec index accubidImport.ts's buildImportPreview builds
 *  (kind + size + material, exact key match only) — kept in lock-step with
 *  it deliberately: this module's whole point is "what would a fresh import/
 *  a real takeoff line actually resolve this row to", so it uses the exact
 *  same two-pass resolution import reconciliation does (spec key first, the
 *  mapper's own exact/alias tiers as the fallback for a name the simple
 *  keyword scan can't classify) rather than a second, different heuristic
 *  that could legitimately disagree with what a real import would do. */
function buildSpecIndex(candidates: LibraryCandidate[]): Map<string, LibraryCandidate> {
  const index = new Map<string, LibraryCandidate>();
  for (const c of candidates) {
    if (c.kind !== 'item') continue;
    const spec = normalizedItemSpec(c.name);
    if (!isReconcilableSpec(spec)) continue;
    const cur = index.get(spec.key);
    if (!cur || (cur.source === 'accubid' && c.source !== 'accubid')) index.set(spec.key, c);
  }
  return index;
}

/** Per-row comparison for ONE job's BOM text against the current library,
 *  resolved the SAME way accubidImport.ts's own reconciliation resolves a
 *  BOM row (normalized spec key first, the takeoff mapper's exact/alias
 *  tiers as fallback) — never by the row's own deterministic import code
 *  (N16). `hoursByCode` supplies each candidate item's current labor_hours
 *  (mapper.ts's LibraryCandidate doesn't carry it — matching and pricing
 *  data are deliberately kept separate). A fuzzy-only mapper match is too
 *  uncertain to base a calibration delta on, and an assembly match has no
 *  single labor_hours field to compare against — both count as unmatched.
 *  Pure: no I/O. */
export function computeBomRowResults(bomText: string, candidates: LibraryCandidate[], hoursByCode: Map<string, number>): { rows: BomCategoryRowResult[]; parseWarnings: number } {
  const parsed = parseAccubidBom(bomText);
  const specIndex = buildSpecIndex(candidates);
  const rows: BomCategoryRowResult[] = [];
  for (const row of parsed.rows) {
    if (row.laborUnit == null || row.totalFieldLaborHours == null) continue; // nothing to compare (a pure-material or unpriced row)
    const { canonical } = ledProxyName(row.description);
    const category = classifyBomCategory(canonical);
    const unit: EstUnit = row.unit === 'E' ? 'EA' : row.unit;

    const rowSpec = normalizedItemSpec(canonical);
    let matchedCode: string | null = rowSpec ? (specIndex.get(rowSpec.key)?.code ?? null) : null;
    if (!matchedCode) {
      const mapped = mapTakeoffLine({ category: '', description: canonical, qty: 1, unit }, candidates);
      if (mapped.matchedKind === 'item' && (mapped.matchConfidence === 'exact' || mapped.matchConfidence === 'alias')) {
        matchedCode = mapped.matchedCode;
      }
    }
    const matchedHours = matchedCode ? hoursByCode.get(matchedCode) : undefined;
    const divisor = BOM_UNIT_DIVISOR[row.unit];
    // Apply the SAME row-level field-labor adjustment % Chris's own total
    // used (a site-condition adjustment, e.g. "25% labor adj" on a run of
    // conduit) — otherwise a library that's a PERFECT match of Chris's base
    // catalog rate would still show phantom drift on every adjusted row,
    // which isn't a calibration gap, it's just the adjustment.
    const adjMultiplier = 1 + (row.fieldLaborAdjPct ?? 0) / 100;
    const engineHours = matchedHours != null ? (row.qty / divisor) * matchedHours * adjMultiplier : null;
    rows.push({
      description: canonical, category, code: matchedCode ?? '', matched: engineHours != null,
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

/** Builds the two inputs computeBomRowResults needs (the mapper's own
 *  candidate list, and a code -> labor_hours lookup for whichever one it
 *  matches) from a plain array of "current library items" — the caller
 *  fetches these however it likes (a DB-backed route reads est_items; a test
 *  passes a plain array). Kept minimal on purpose: this file never needs an
 *  item's material cost, price date, etc. */
export interface CalibrationLibraryItem {
  code: string; name: string; category: string; unit: EstUnit; aliases: string[]; source: string; laborHours: number;
}

function toCandidatesAndHours(items: CalibrationLibraryItem[]): { candidates: LibraryCandidate[]; hoursByCode: Map<string, number> } {
  const candidates: LibraryCandidate[] = items.map(i => ({
    kind: 'item', id: i.code, code: i.code, name: i.name, category: i.category, unit: i.unit, aliases: i.aliases, source: i.source,
  }));
  const hoursByCode = new Map(items.map(i => [i.code, i.laborHours]));
  return { candidates, hoursByCode };
}

/** Convenience: one job's BOM text straight to the full report. */
export function computeBomCalibrationForJob(bomText: string, items: CalibrationLibraryItem[]): BomCalibrationReport {
  const { candidates, hoursByCode } = toCandidatesAndHours(items);
  const { rows, parseWarnings } = computeBomRowResults(bomText, candidates, hoursByCode);
  return aggregateBomCalibration(rows, parseWarnings);
}

/** Multiple jobs' BOM texts against the same library, combined into one report. */
export function computeBomCalibrationForJobs(bomTexts: string[], items: CalibrationLibraryItem[]): BomCalibrationReport {
  const { candidates, hoursByCode } = toCandidatesAndHours(items);
  let allRows: BomCategoryRowResult[] = [];
  let parseWarnings = 0;
  for (const text of bomTexts) {
    const { rows, parseWarnings: w } = computeBomRowResults(text, candidates, hoursByCode);
    allRows = allRows.concat(rows);
    parseWarnings += w;
  }
  return aggregateBomCalibration(allRows, parseWarnings);
}
