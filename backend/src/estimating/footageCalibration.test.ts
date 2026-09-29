// Remodel + footage round, B2 — the footage ratios are fitted on Chris's five
// real BOMs (qty = raw feet / raw count; the unit letter is only Accubid's
// pricing divisor). These tests re-derive the fit from the fixtures and fail
// if DEFAULT_FOOTAGE_SETTINGS (and migration 150's seeded JSON) drift from
// what the data says, and pin the leave-one-out error the report quotes.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import { extractBomFootageJob, calibrateFootage, classifyPointText, nnlsThroughOrigin, BomFootageJob } from './footageCalibration';
import { DEFAULT_FOOTAGE_SETTINGS } from './footageAllowance';

const DIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const JOBS = ['36th-street', 'kissimmee', 'north-port', 'orlando-clubhouse', 'rockledge'];
const jobs: BomFootageJob[] = JOBS.map(j => extractBomFootageJob(j, parseAccubidBom(fs.readFileSync(path.join(DIR, `${j}-bom.txt`), 'utf8'))));
const byJob = Object.fromEntries(jobs.map(j => [j.job, j]));

describe('B2 calibration — features read off the real BOMs', () => {
  it("36th Street: Chris's 670 ft EMT, 3,663 ft #12/#10, 377.5 ft MC against 39 fixtures + 24 devices", () => {
    const j = byJob['36th-street'];
    expect(j.emtFt).toBe(670); // 320 ft 1/2" + 350 ft 1"
    expect(j.wire12Ft + j.wire10Ft).toBe(3663);
    expect(j.mcFt).toBe(377.5);
    // 13 high bay + 2 2x2 + 14 2x4 + 2 exit + 8 emergency; 16 switches + 5 duplex + 2 GFCI + 1 time switch.
    expect(j.points).toEqual({ fixture: 39, device: 24, equipment: 0, pole: 0 });
  });

  it('never counts demolition, wallplates, lamps or motor terminations as points', () => {
    expect(classifyPointText('Demolition - Luminaire Modular Fluorescent up to 2x4')).toBeNull();
    expect(classifyPointText('1-Gang Ivory Standar Toggle Switch Wallplate - Nylon')).toBeNull();
    expect(classifyPointText('48" 4100K Lamp T8 7x CRI TCLP - Fluorescent')).toBeNull();
    expect(classifyPointText('#10 Motor Termination 3-Conductor to 600V w/ Ground')).toBeNull();
    expect(classifyPointText('15A 125V 3W White Decorator Single Receptacle - Commercial Grade Side Wire Only')).toBe('device');
    expect(classifyPointText('60A Safety Switch Heavy Duty Non-Fusible 600V 3 Pole - NEMA 3R')).toBe('equipment');
    expect(classifyPointText('20\' H x 4-1/2" Pole Round Straight - Steel')).toBe('pole');
    expect(classifyPointText('Up to +/- 250W= Luminaire Pole Top/Arm Mount - LED Integral Lamp')).toBe('fixture');
    expect(classifyPointText('Setup Concrete Pour - Per Pole Base')).toBeNull();
  });

  it('reads every job the same way (points and footage per job)', () => {
    expect(jobs.map(j => [j.job, j.points.fixture, j.points.device, j.points.equipment, j.points.pole, j.emtFt, Math.round(j.wire12Ft + j.wire10Ft), j.mcFt])).toEqual([
      ['36th-street', 39, 24, 0, 0, 670, 3663, 377.5],
      ['kissimmee', 179, 39, 15, 3, 1605, 10873, 1942.5],
      ['north-port', 515, 127, 38, 8, 3285, 16685, 4200],
      ['orlando-clubhouse', 146, 89, 7, 0, 1300, 9991, 1072.5],
      ['rockledge', 334, 75, 28, 0, 4066, 19370, 1980],
    ]);
  });
});

describe('B2 calibration — fit and leave-one-out', () => {
  const cal = calibrateFootage(jobs);

  it('the pooled per-point EMT ratio beats per-kind ratios on leave-one-out (per-kind overfits 5 jobs)', () => {
    expect(cal.ratios.emtModel).toBe('pooled');
    expect(cal.loo.mae.emt).toBeLessThan(cal.alternative.mae.emt);
  });

  it('DEFAULT_FOOTAGE_SETTINGS are the fitted ratios, rounded', () => {
    const d = DEFAULT_FOOTAGE_SETTINGS;
    expect(d.emtPerPoint.fixture).toBeCloseTo(cal.ratios.emtPerPoint.fixture, 1);
    expect(d.emtPerPoint.device).toBeCloseTo(cal.ratios.emtPerPoint.device, 1);
    expect(d.emtPerPoint.equipment).toBeCloseTo(cal.ratios.emtPerPoint.equipment, 1);
    expect(d.mcPerFixture).toBeCloseTo(cal.ratios.mcPerFixture, 2);
    expect(d.wirePerConduitFt).toBeCloseTo(cal.ratios.wirePerConduitFt, 2);
    expect(d.wire10Share).toBeCloseTo(cal.ratios.wire10Share, 2);
    expect(d.pvcSitePerPole).toBeCloseTo(cal.ratios.pvcSitePerPole, 0);
    expect(cal.ratios.pvcJobs).toBe(2);
    expect(d.looErrorPct.emt).toBe(Math.round(cal.loo.mae.emt));
    expect(d.looErrorPct.mc).toBe(Math.round(cal.loo.mae.mc));
    expect(d.looErrorPct.wire).toBe(Math.round(cal.loo.mae.wire));
    expect(d.looErrorPct.pvcSite).toBe(Math.round(cal.loo.mae.pvcSite ?? 0));
  });

  it('pins the per-job leave-one-out error the report quotes (EMT / wire / MC, %)', () => {
    const table = cal.loo.rows.map(r => [r.job, Math.round(r.errorPct.emt!), Math.round(r.errorPct.wire!), Math.round(r.errorPct.mc!)]);
    expect(table).toEqual([
      ['36th-street', -39, -39, -19],
      ['kissimmee', -5, -25, -32],
      ['north-port', 62, 83, -6],
      ['orlando-clubhouse', 27, -13, 8],
      ['rockledge', -39, -24, 46],
    ]);
  });

  it('nnlsThroughOrigin never returns a negative coefficient', () => {
    const c = nnlsThroughOrigin([[1, 10], [2, 1], [3, 20]], [5, 3, 1]);
    expect(c.every(v => v >= 0)).toBe(true);
    expect(nnlsThroughOrigin([[1], [2]], [2, 4])[0]).toBeCloseTo(2, 9);
  });
});
