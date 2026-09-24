import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeBomCalibrationForJob, computeBomCalibrationForJobs, CalibrationLibraryItem } from './bomCalibration';
import { ledProxyName, bomItemCode } from './accubidImport';
import { parseAccubidBom } from './accubidBom';
import { EstUnit } from './pricing';

const FIXDIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

// Review round 2 / N16 — the library is now resolved through the SAME
// mapper.ts matcher a real takeoff line goes through (never by the row's own
// deterministic import code), so this fixture builds real items with the
// row's own canonical text as the NAME (giving the mapper an exact-tier
// match to find) rather than a bomItemCode-keyed map.
function libraryFrom(bomText: string, scale = 1): CalibrationLibraryItem[] {
  const { rows } = parseAccubidBom(bomText);
  const seen = new Set<string>();
  const items: CalibrationLibraryItem[] = [];
  for (const row of rows) {
    if (row.laborUnit == null) continue;
    const { canonical } = ledProxyName(row.description);
    const unit: EstUnit = row.unit === 'E' ? 'EA' : row.unit;
    const code = bomItemCode(canonical, unit);
    if (seen.has(code)) continue;
    seen.add(code);
    items.push({ code, name: canonical, category: 'Branch Power', unit, aliases: [], source: 'accubid', laborHours: row.laborUnit * scale });
  }
  return items;
}

describe('computeBomCalibrationForJob — Kissimmee against an EMPTY library (nothing imported yet)', () => {
  it('every row is unmatched, no engine hours to compare, never divides by zero', () => {
    const report = computeBomCalibrationForJob(read('kissimmee-bom.txt'), []);
    expect(report.totalMatchedRows).toBe(0);
    expect(report.totalUnmatchedRows).toBeGreaterThan(50);
    expect(report.totalEngineHours).toBe(0);
    for (const gap of report.categoryGaps) {
      expect(gap.suggestedAdjustmentPct).toBe(0); // engine=0 -> no ratio, never NaN/Infinity
      expect(Number.isFinite(gap.suggestedAdjustmentPct)).toBe(true);
    }
  });
});

describe('computeBomCalibrationForJob — a library that EXACTLY matches Chris\'s BOM shows zero drift', () => {
  it('building the library FROM the same BOM (same code/hours) reports 0% for every category', () => {
    const library = libraryFrom(read('kissimmee-bom.txt'));
    const report = computeBomCalibrationForJob(read('kissimmee-bom.txt'), library);
    expect(report.totalUnmatchedRows).toBe(0);
    expect(report.totalMatchedRows).toBeGreaterThan(50);
    // Same hours in, same hours out -> chris ~= engine. Not bit-exact: the
    // normalized-spec reconciliation can still legitimately consolidate a
    // couple of same-kind/size/material rows onto one shared library target
    // (e.g. two conduit sub-types at an unusual shared size) even after
    // scoping RECONCILABLE_KINDS to the kinds this catalog identifies
    // uniquely — a real, honestly-small residual (< 0.03% of total hours on
    // the real Kissimmee BOM), not the ~1.7%/2.4% this test caught before
    // device sub-kinds (GFCI/duplex/single/switch) were split out.
    expect(Math.abs(report.totalChrisHours - report.totalEngineHours)).toBeLessThan(1);
    for (const gap of report.categoryGaps) {
      expect(Math.abs(gap.suggestedAdjustmentPct)).toBeLessThan(1);
    }
  });

  it('a library with hours HALVED everywhere reports +100% for every matched category (read-only — never auto-applies)', () => {
    const library = libraryFrom(read('kissimmee-bom.txt'), 0.5); // engine is HALF of Chris's real hours
    const report = computeBomCalibrationForJob(read('kissimmee-bom.txt'), library);
    for (const gap of report.categoryGaps) {
      if (gap.matchedRowCount === 0) continue;
      expect(gap.suggestedAdjustmentPct).toBeCloseTo(100, 0); // chris/engine - 1 = 2/1 - 1 = 100%
    }
  });

  it("review round 2 / N16: a row that RECONCILES onto an existing seed item (never its own bomItemCode) still compares correctly", () => {
    // The exact B3/N16 scenario: EMT-075 is a curated seed item (not
    // bomItemCode-keyed) whose NAME never equals the BOM row's own phrasing
    // verbatim, but whose ALIAS does (the same alias-tier match the real
    // import's reconciliation uses) — the old bomItemCode-keyed lookup could
    // never find this; the mapper-based lookup does.
    const seedItem: CalibrationLibraryItem = {
      code: 'EMT-075', name: '3/4" EMT (incl. couplings/straps)', category: 'Branch Power', unit: 'C',
      aliases: ['3/4" emt (incl. couplings/straps)'], source: 'seed', laborHours: 4.0, // seed's placeholder, NOT Chris's 3.2
    };
    const report = computeBomCalibrationForJob(read('kissimmee-bom.txt'), [seedItem]);
    const emtRow = report.jobRows.find(r => r.code === 'EMT-075' && /3\/4/.test(r.description));
    expect(emtRow).toBeTruthy();
    expect(emtRow!.matched).toBe(true);
    // Chris's real rate is 3.2 h/C; the seed placeholder is 4.0 h/C, so the
    // engine is (1475/100)*4.0 = 59.0h against Chris's (1475/100)*3.2=47.2h —
    // a REAL, non-zero delta the old self-referential lookup would have hidden.
    expect(emtRow!.chrisHours).toBeCloseTo(47.2, 1);
    expect(emtRow!.engineHours).toBeCloseTo(59.0, 1);
  });
});

describe('computeBomCalibrationForJobs — combining several real jobs', () => {
  it('aggregates matched rows across Kissimmee and Rockledge against one shared library', () => {
    const library = libraryFrom(read('kissimmee-bom.txt'));
    // Rockledge shares some catalog rows with Kissimmee (conduit, boxes,
    // devices) even though it wasn't used to build the library — those match.
    const report = computeBomCalibrationForJobs([read('kissimmee-bom.txt'), read('rockledge-bom.txt')], library);
    expect(report.totalMatchedRows).toBeGreaterThan(50);
    expect(report.categoryGaps.length).toBeGreaterThan(0);
    expect(Number.isFinite(report.totalEngineHours)).toBe(true);
  });
});
