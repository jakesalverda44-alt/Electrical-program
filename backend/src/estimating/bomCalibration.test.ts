import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeBomCalibrationForJob, computeBomCalibrationForJobs, LibraryHoursLookup } from './bomCalibration';
import { bomItemCode, ledProxyName } from './accubidImport';
import { parseAccubidBom } from './accubidBom';
import { EstUnit } from './pricing';

const FIXDIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

function libraryFrom(bomText: string, scale = 1): Map<string, LibraryHoursLookup> {
  const { rows } = parseAccubidBom(bomText);
  const library = new Map<string, LibraryHoursLookup>();
  for (const row of rows) {
    if (row.laborUnit == null) continue;
    const { canonical } = ledProxyName(row.description);
    const unit: EstUnit = row.unit === 'E' ? 'EA' : row.unit;
    library.set(bomItemCode(canonical, unit), { laborHours: row.laborUnit * scale, unit });
  }
  return library;
}

describe('computeBomCalibrationForJob — Kissimmee against an EMPTY library (nothing imported yet)', () => {
  it('every row is unmatched, no engine hours to compare, never divides by zero', () => {
    const report = computeBomCalibrationForJob(read('kissimmee-bom.txt'), new Map());
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
    // Same hours in, same hours out -> chris === engine (within float rounding noise).
    expect(report.totalChrisHours).toBeCloseTo(report.totalEngineHours, 2);
    for (const gap of report.categoryGaps) {
      expect(Math.abs(gap.suggestedAdjustmentPct)).toBeLessThan(0.01);
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
