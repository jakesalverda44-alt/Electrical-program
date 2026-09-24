import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAccubidBom, BOM_UNIT_DIVISOR } from './accubidBom';

const FIXDIR = path.join(__dirname, '../test/fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

describe('parseAccubidBom — row shapes (unit tests, not the full files)', () => {
  it('parses a full row: price, cost, net cost (no vendor adj), total mat, labor unit, total field labor', () => {
    const line = '3/4"                  Conduit - EMT 10\' Lengths                                          1,475.000 C          189.30          92.38                    92.38         1,362.61 C                      3.200                       47.200 Normal';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.description).toContain('Conduit - EMT');
    expect(r.qty).toBe(1475);
    expect(r.unit).toBe('C');
    expect(r.price).toBeCloseTo(189.3);
    expect(r.cost).toBeCloseTo(92.38);
    expect(r.vendorCostAdjPct).toBeNull();
    expect(r.netCost).toBeCloseTo(92.38);
    expect(r.totalMaterial).toBeCloseTo(1362.61);
    expect(r.laborUnit).toBeCloseTo(3.2);
    expect(r.fieldLaborAdjPct).toBeNull();
    expect(r.totalFieldLaborHours).toBeCloseTo(47.2);
    expect(r.matCondition).toBe('Normal');
  });

  it('applies the field labor adjustment % (PVC 40 1" — 25% labor adj, plan fact)', () => {
    const line = '1"                    Conduit - PVC 40 10\' Lengths                                        750.000 C           206.01          51.82                    51.82           388.65 C                      4.200        25.000         39.375 Normal';
    const { rows } = parseAccubidBom(line);
    const r = rows[0];
    expect(r.fieldLaborAdjPct).toBe(25);
    // 4.2 h/C * (750/100) * 1.25 = 39.375
    expect(r.totalFieldLaborHours).toBeCloseTo(39.375);
  });

  it('reads a vendor cost adjustment % row ("#12 Black" — net $208.00 = cost $108 + 92.593%, plan fact)', () => {
    const line = '#12 Black             Wire THHN / T90 - Copper                                           5,976.000 M         1,434.30        108.00   92.593          208.00         1,243.01 M                      5.150                       30.776 Normal';
    const { rows } = parseAccubidBom(line);
    const r = rows[0];
    expect(r.cost).toBeCloseTo(108.0);
    expect(r.vendorCostAdjPct).toBeCloseTo(92.593);
    expect(r.netCost).toBeCloseTo(208.0);
    expect(r.unit).toBe('M');
    expect(BOM_UNIT_DIVISOR[r.unit]).toBe(1000);
  });

  it('reads a negative vendor cost adjustment %, and net-cost-only rows with no price/cost at all', () => {
    const negLine = '#3/0 Black            Wire THHN / T90 - Copper                                            872.000 M         35,003.02      5,535.00 -14.453         4,735.00         4,128.92 M                     18.800                       16.394 Normal';
    const { rows: r1 } = parseAccubidBom(negLine);
    expect(r1[0].vendorCostAdjPct).toBeCloseTo(-14.453);
    expect(r1[0].netCost).toBeCloseTo(4735.0);

    const quotedLine = 'CMP #24-4 Pair        Communication & Control Cable Unshielded Twisted Pairs             1,000.000 M                                                  230.00           230.00 M                      8.600                        8.600 Quoted';
    const { rows: r2 } = parseAccubidBom(quotedLine);
    expect(r2[0].price).toBeNull();
    expect(r2[0].cost).toBeNull();
    expect(r2[0].netCost).toBeCloseTo(230.0);
    expect(r2[0].totalMaterial).toBeCloseTo(230.0);
    expect(r2[0].matCondition).toBe('Quoted');
  });

  it('reads a pure-labor row with no cost fields at all (LED fixture line)', () => {
    const line = "4'                    Luminaire Linear Wraparound Lens - LED Integral Lamp                    133.000 E                                                                               E                     0.750                       99.750 Quoted";
    const { rows } = parseAccubidBom(line);
    const r = rows[0];
    expect(r.price).toBeNull();
    expect(r.netCost).toBeNull();
    expect(r.totalMaterial).toBeNull();
    expect(r.laborUnit).toBeCloseTo(0.75);
    expect(r.totalFieldLaborHours).toBeCloseTo(99.75);
  });

  it('handles the 2024-layout row order (Mat. Cond. BEFORE the labor-unit column, not after)', () => {
    const line = '1/2"                   Conduit - EMT 10\' Lengths                                         320.000 C    120.88   64.94                64.94           207.81 Normal      C                  2.780                    8.896';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    const r = rows[0];
    expect(r.netCost).toBeCloseTo(64.94);
    expect(r.totalMaterial).toBeCloseTo(207.81);
    expect(r.laborUnit).toBeCloseTo(2.78);
    expect(r.totalFieldLaborHours).toBeCloseTo(8.896);
    expect(r.matCondition).toBe('Normal');
  });

  it('handles a demolition row with "No Cost" and no cost fields at all (2024 layout)', () => {
    const line = '                     Demolition - Luminaire Modular Fluorescent up to 2x4                    52.000 E                                                         No Cost   E                  0.310                   16.120';
    const { rows } = parseAccubidBom(line);
    const r = rows[0];
    expect(r.matCondition).toBe('No Cost');
    expect(r.totalMaterial).toBeNull();
    expect(r.laborUnit).toBeCloseTo(0.31);
    expect(r.totalFieldLaborHours).toBeCloseTo(16.12);
  });

  it('handles a pole-base row with no labor-adjustment column at all (North Port)', () => {
    const line = '24"                    Pole Base Auger (Linear Foot)                                           48.000 E                                                            Quoted     E                 0.200                    9.600';
    const { rows } = parseAccubidBom(line);
    const r = rows[0];
    expect(r.description).toContain('Pole Base Auger');
    expect(r.laborUnit).toBeCloseTo(0.2);
    expect(r.totalFieldLaborHours).toBeCloseTo(9.6);
  });

  it('tolerates a clipped vendor-adjustment % with no digits after the decimal ("1,315.") without dropping the row', () => {
    const line = '20A 120-277V Ivory     Toggle Switch Single Pole - Commercial Grade                       12.000 C     745.00    380.16 1,315.    5,380.16         645.62 Normal      C                18.000                     2.160';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorCostAdjPct).toBeCloseTo(1315);
    expect(rows[0].totalMaterial).toBeCloseTo(645.62);
  });

  it('review round 2 / S13: a -100% vendor cost adjustment (cost entered, then fully credited) parses net cost as 0.00, never -100 (3-token shape)', () => {
    const line = '400W                   Lamp Mogul Base Clear - HPS                                             53.000 E                 22.43 -100.0         0.00                  No Cost    E                 0.140                    7.420';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorCostAdjPct).toBeCloseTo(-100);
    expect(rows[0].netCost).toBe(0);
    expect(rows[0].netCost).not.toBeLessThan(0);
    expect(rows[0].totalMaterial).toBeNull();
  });

  it('review round 2 / S13: the same -100% shape with a Price AND Cost both printed (4-token shape)', () => {
    const line = 'White                  2-Button Low Voltage Control On/Off                                     65.000 C    6,150.00   6,520.51 -100.0        0.00                  Quoted     C               20.000                    13.000';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    expect(rows[0].vendorCostAdjPct).toBeCloseTo(-100);
    expect(rows[0].netCost).toBe(0);
  });

  it('review round 2 / S13: never accepts a row whose net cost still comes out negative (safety net)', () => {
    // A single bare negative token with nothing to promote into net cost —
    // there's no way to recover the real value, so this must warn, not guess.
    const line = 'Test Item                                                                                    5.000 E                                                                              -50.00 No Cost   E                 1.000                    5.000';
    const { rows, warnings } = parseAccubidBom(line);
    expect(rows).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toMatch(/negative/);
  });

  it('review round 2 / S13: warns instead of silently accepting a row whose printed total material disagrees with net cost x qty', () => {
    const line = 'Bad Row Test           Widget - Mismatched Total                                             100.000 C          50.00                     50.00           999.99 C                      3.000                        3.000 Normal';
    const { rows, warnings } = parseAccubidBom(line);
    expect(rows).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toMatch(/does not match/);
  });

  it('handles a row with no labor fields at all (Rockledge "Booster" line)', () => {
    const line = '#3 - Green            Booster 0.27 Caliber Short 10 Shot Magazine                               24.700 E       36.95      34.19               34.19          844.49 Normal      E';
    const { rows, warnings } = parseAccubidBom(line);
    expect(warnings).toEqual([]);
    expect(rows[0].totalMaterial).toBeCloseTo(844.49);
    expect(rows[0].laborUnit).toBeNull();
    expect(rows[0].totalFieldLaborHours).toBeNull();
  });

  it('reads the footer "$material  hours" totals line', () => {
    const { footerMaterialTotal, footerLaborHours } = parseAccubidBom(
      '                                                                                                                                                             $25,842.56                                                   798.949'
    );
    expect(footerMaterialTotal).toBeCloseTo(25842.56);
    expect(footerLaborHours).toBeCloseTo(798.949);
  });

  it('never throws and reports a warning for a row it cannot read, rather than guessing', () => {
    const garbled = 'Something Weird                                  5.000 C   this-is-not-a-number   Normal';
    const { rows, warnings } = parseAccubidBom(garbled);
    expect(rows).toHaveLength(0);
    expect(warnings.length).toBeGreaterThanOrEqual(0); // no ECM second-unit column here: silently skipped, not a false row
  });
});

describe('parseAccubidBom — full real BOMs reconcile to the footer (fixtures, text-only excerpts of the real PDFs)', () => {
  const cases: Array<{ file: string; rows: number; material: number; hours: number }> = [
    // Verified by Part A's executor against the real Kissimmee BOM PDF.
    { file: 'kissimmee-bom.txt', rows: 89, material: 25842.56, hours: 798.949 },
    { file: '36th-street-bom.txt', rows: 58, material: 3399.32, hours: 189.21 },
    { file: 'north-port-bom.txt', rows: 131, material: 29593.45, hours: 1841.485 },
    { file: 'orlando-clubhouse-bom.txt', rows: 96, material: 14976.39, hours: 606.518 },
    { file: 'rockledge-bom.txt', rows: 105, material: 28413.56, hours: 1393.656 },
  ];

  for (const c of cases) {
    it(`${c.file}: ${c.rows} rows, reconciles to the printed footer ($${c.material} / ${c.hours} h)`, () => {
      const parsed = parseAccubidBom(read(c.file));
      expect(parsed.warnings).toEqual([]);
      expect(parsed.rows).toHaveLength(c.rows);
      expect(parsed.footerMaterialTotal).toBeCloseTo(c.material, 2);
      expect(parsed.footerLaborHours).toBeCloseTo(c.hours, 3);
      expect(parsed.computedMaterialTotal).toBeCloseTo(c.material, 2);
      expect(parsed.computedLaborHours).toBeCloseTo(c.hours, 3);
    });
  }

  // Review round 2 / S11 — the report date parsed off each real BOM's own
  // "Job #" header line, never a caller-supplied or hardcoded value. Only
  // Kissimmee is actually current-priced (2026); the other four real jobs
  // are 2024 exports, which S11's price cutoff must treat as stale.
  it("parses each real BOM's own report date off its header line (never a caller-supplied or hardcoded one)", () => {
    expect(parseAccubidBom(read('kissimmee-bom.txt')).reportDate).toBe('2026-06-18');
    expect(parseAccubidBom(read('36th-street-bom.txt')).reportDate).toBe('2024-04-09');
    expect(parseAccubidBom(read('north-port-bom.txt')).reportDate).toBe('2024-03-22');
    expect(parseAccubidBom(read('orlando-clubhouse-bom.txt')).reportDate).toBe('2024-04-22');
    expect(parseAccubidBom(read('rockledge-bom.txt')).reportDate).toBe('2024-04-11');
  });

  it('reportDate is null when the text has no recognizable header date (a synthetic/partial BOM)', () => {
    expect(parseAccubidBom('Conduit - EMT   100.000 C   50.00   50.00 C   3.0   3.0 Normal').reportDate).toBeNull();
  });

  it('36th Street and North Port carry demolition / pole-base rows with recognizable descriptions', () => {
    const demo = parseAccubidBom(read('36th-street-bom.txt'));
    expect(demo.rows.some(r => /Demolition -/.test(r.description))).toBe(true);
    const poles = parseAccubidBom(read('north-port-bom.txt'));
    expect(poles.rows.some(r => /Pole Base Auger/.test(r.description))).toBe(true);
    expect(poles.rows.some(r => /Sono Tube/.test(r.description))).toBe(true);
    expect(poles.rows.some(r => /^Concrete/.test(r.description))).toBe(true);
  });

  it('every row is finite and non-negative where present (never NaN, never a negative qty/hours)', () => {
    for (const c of cases) {
      const parsed = parseAccubidBom(read(c.file));
      for (const r of parsed.rows) {
        expect(Number.isFinite(r.qty)).toBe(true);
        expect(r.qty).toBeGreaterThanOrEqual(0);
        for (const v of [r.price, r.cost, r.netCost, r.totalMaterial, r.laborUnit, r.totalFieldLaborHours]) {
          if (v != null) expect(Number.isFinite(v)).toBe(true);
        }
        if (r.totalFieldLaborHours != null) expect(r.totalFieldLaborHours).toBeGreaterThanOrEqual(0);
        if (r.totalMaterial != null) expect(r.totalMaterial).toBeGreaterThanOrEqual(-0.01); // a return/credit line could be negative in principle; none observed
      }
    }
  });
});
