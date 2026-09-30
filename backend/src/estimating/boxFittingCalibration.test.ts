// Price accuracy round, C3 — the box / fitting / hardware rates are fitted on
// Chris's five real BOMs. These tests re-derive the fit from the fixtures,
// fail if the seeded ALW-* items (and migration 155) drift from the data,
// and pin the leave-one-out error and the per-job table the report quotes.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom } from './accubidBom';
import { extractBfJob, calibrateBoxFittings, bfGroupOf, predictHours, actualHours, BfJob } from './boxFittingCalibration';
import { BOX_FITTING_ITEMS } from './seed/laborUnits';

const DIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const JOBS = ['36th-street', 'kissimmee', 'north-port', 'orlando-clubhouse', 'rockledge'];
const jobs: BfJob[] = JOBS.map(j => extractBfJob(j, parseAccubidBom(fs.readFileSync(path.join(DIR, `${j}-bom.txt`), 'utf8'))));
const byJob = Object.fromEntries(jobs.map(j => [j.job, j]));
const cal = calibrateBoxFittings(jobs);

describe('C3 calibration — groups read off the BOMs', () => {
  it('classifies the real rows', () => {
    expect(bfGroupOf('2-1/8" D 4" Square Box 1/2 & 3/4" KO')).toBe('box');
    expect(bfGroupOf('1-Gang x 5/8" D 4" Square Plaster Ring - Steel')).toBe('box');
    expect(bfGroupOf('Ground Screw w/ Insulated #12 Lead')).toBe('box');
    expect(bfGroupOf('1/2" Coupling - EMT Set Screw Steel')).toBe('fitEmt'); // a coupling, not a screw
    expect(bfGroupOf('3/4" 1-Hole Strap - EMT Steel')).toBe('fitEmt');
    expect(bfGroupOf('2" Elbow 90 Degree - PVC 40 Bell End')).toBe('fitPvc');
    expect(bfGroupOf('3/8" Flex / AC-90 / MC Connector Saddle Type')).toBe('fitMc');
    expect(bfGroupOf('1/4-20 Drop-In Expansion Machine Screw Anchor - Plated Steel')).toBe('hardware');
    expect(bfGroupOf('3/4" Conduit Clip Screw-On to Metal Stud for 2-1/8" Deep Box')).toBe('hardware');
    expect(bfGroupOf('C-Purlin Strap w/ #8 Wire or 1/4" Plain Rod Hanger')).toBe('hardware');
    expect(bfGroupOf('#16 to #10 Wire Connector Live Spring Twist-On - 600V')).toBeNull();
    expect(bfGroupOf('1/2-13 x 24" Anchor Bolt - Steel')).toBeNull(); // pole base
    expect(bfGroupOf('Demolition - Junction Box')).toBeNull();
  });

  it("36th Street: boxes & rings 12.9 h (Chris's own rows), hardware 24.0 h, fittings 13.9 h", () => {
    const j = byJob['36th-street'];
    expect(j.hours.box).toBeCloseTo(12.915, 3);
    expect(j.hours.hardware).toBeCloseTo(24.026, 3);
    expect(j.hours.fitEmt + j.hours.fitMc).toBeCloseTo(13.894, 3);
    expect(j.points).toEqual({ fixture: 39, device: 24, equipment: 0 });
    expect(j.emtC).toBeCloseTo(6.7, 6);
    expect(j.mcC).toBeCloseTo(3.775, 6);
  });
});

describe('C3 calibration — fit and leave-one-out', () => {
  it('one box rate per point beats fixture/device rates on leave-one-out', () => {
    expect(cal.loo.boxModel).toBe('pooled');
    expect(cal.loo.mae.box).toBeLessThan(cal.alternative.mae.box);
  });

  it('the seeded ALW-* items are the fitted rates, rounded', () => {
    const item = (code: string) => BOX_FITTING_ITEMS.find(i => i.code === code)!;
    const r = cal.rates;
    const near = (a: number, b: number, d = 2) => expect(a).toBeCloseTo(b, d);
    near(item('ALW-BOX').laborHours, r.boxPerPoint.device.hours);
    near(item('ALW-BOX').materialCost, r.boxPerPoint.device.material);
    near(item('ALW-FIT-EMT').laborHours, r.fitEmtPerC.hours);
    near(item('ALW-FIT-EMT').materialCost, r.fitEmtPerC.material);
    near(item('ALW-FIT-PVC').laborHours, r.fitPvcPerC.hours, 1);
    near(item('ALW-FIT-PVC').materialCost, r.fitPvcPerC.material);
    near(item('ALW-FIT-MC').laborHours, r.fitMcPerC.hours, 1);
    near(item('ALW-FIT-MC').materialCost, r.fitMcPerC.material, 1);
    near(item('ALW-HW-RACEWAY').laborHours, r.hardwarePerConduitC.hours);
    near(item('ALW-HW-RACEWAY').materialCost, r.hardwarePerConduitC.material);
    near(item('ALW-HW-FIXTURE').laborHours, r.hardwarePerFixture.hours);
    near(item('ALW-HW-FIXTURE').materialCost, r.hardwarePerFixture.material);
  });

  it('pins the leave-one-out error the report quotes (mean abs %, hours)', () => {
    expect(Math.round(cal.loo.mae.box)).toBe(35);
    expect(Math.round(cal.loo.mae.fittings)).toBe(27);
    expect(Math.round(cal.loo.mae.hardware)).toBe(15);
    expect(Math.round(cal.loo.mae.total)).toBe(18);
  });

  it('prints the per-job table (in-sample and leave-one-out, vs Chris)', () => {
    const table = jobs.map(j => {
      const a = actualHours(j);
      const fit = predictHours(cal.rates, j);
      const loo = cal.loo.rows.find(r => r.job === j.job)!;
      const f = (n: number) => n.toFixed(1);
      return `${j.job.padEnd(18)} box ${f(a.box)} / ${f(fit.box)} / ${f(loo.predicted.box)} · fittings ${f(a.fittings)} / ${f(fit.fittings)} / ${f(loo.predicted.fittings)} · hardware ${f(a.hardware)} / ${f(fit.hardware)} / ${f(loo.predicted.hardware)} · total LOO ${loo.errorPct.total.toFixed(0)}%`;
    });
    // eslint-disable-next-line no-console
    console.log(`[C3 calibration] Chris / fitted / leave-one-out (hours)\n  ${table.join('\n  ')}`);
    expect(table).toHaveLength(5);
  });
});
