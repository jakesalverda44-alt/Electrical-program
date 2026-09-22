import { describe, it, expect } from 'vitest';
import { priceBid, effectiveFactorPct, PricingLineInput, PricingSettings, PricingFactorInput } from './pricing';

const baseSettings: PricingSettings = {
  laborRate: 40,
  materialTaxPct: 7,
  smallToolsPct: 3,
  supervisionPct: 10,
  consumablesPct: 2,
  overheadPct: 10,
  profitPct: 15,
  crewSize: 3,
  sqFt: 5000,
};

function line(overrides: Partial<PricingLineInput>): PricingLineInput {
  return {
    id: 'l1',
    category: 'Branch Power',
    description: 'test line',
    qty: 1,
    unit: 'EA',
    materialUnitCost: 0,
    laborHoursUnit: 0,
    matched: true,
    ...overrides,
  };
}

describe('priceBid — empty input', () => {
  it('returns all-zero totals and no categories for an empty line list', () => {
    const recap = priceBid([], baseSettings, []);
    expect(recap.lines).toEqual([]);
    expect(recap.categories).toEqual([]);
    expect(recap.totals).toEqual({
      materialSubtotal: 0,
      consumables: 0,
      materialTax: 0,
      laborHours: 0,
      laborCost: 0,
      smallTools: 0,
      directCost: 0,
      overhead: 0,
      profit: 0,
      grandTotal: 0,
      sellPerSf: 0,
      crewWeeks: 0,
    });
    expect(recap.warnings).toEqual({
      unmatchedCount: 0,
      verifyCount: 0,
      zeroMaterialMatchedCount: 0,
      excludedCount: 0,
      unverifiedMaterialShare: 0,
    });
  });

  it('sellPerSf is null when sqFt is unknown', () => {
    const recap = priceBid([], { ...baseSettings, sqFt: null }, []);
    expect(recap.totals.sellPerSf).toBeNull();
  });
});

describe('priceBid — unit conversion', () => {
  it('EA and LF units use qty directly', () => {
    const recap = priceBid(
      [line({ unit: 'EA', qty: 5, materialUnitCost: 10, laborHoursUnit: 0.5 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(50);
    expect(recap.lines[0].hoursExt).toBe(2.5);
  });

  it('C unit divides qty by 100 (per-100-ft pricing)', () => {
    const recap = priceBid(
      [line({ unit: 'C', qty: 250, materialUnitCost: 60, laborHoursUnit: 4 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(150); // 60 * 2.5
    expect(recap.lines[0].hoursExt).toBe(10);      // 4 * 2.5
  });

  it('M unit divides qty by 1000 (per-1000-ft pricing)', () => {
    const recap = priceBid(
      [line({ unit: 'M', qty: 2500, materialUnitCost: 200, laborHoursUnit: 8 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(500); // 200 * 2.5
    expect(recap.lines[0].hoursExt).toBe(20);      // 8 * 2.5
  });
});

describe('priceBid — B1: libraryUnit conversion (display unit != matched item\'s pricing unit)', () => {
  it('1,200 LF matched to a per-C (per-100-ft) item prices at $720, not $72,000', () => {
    // The exact regression from the review: a takeoff line's display unit
    // (LF, from Agent 2) differs from the matched item's own pricing unit
    // (C = per 100 ft). Before this fix, `unit: 'LF'` alone was fed to the
    // divisor lookup (divisor 1), pricing 1200 raw feet as 1200 EACH of a
    // $60/C item = $72,000 — 100x too high.
    const recap = priceBid(
      [line({ unit: 'LF', libraryUnit: 'C', qty: 1200, materialUnitCost: 60, laborHoursUnit: 4 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(720);  // 1200/100 * 60
    expect(recap.lines[0].hoursExt).toBe(48);       // 1200/100 * 4
    expect(recap.lines[0].unit).toBe('LF');          // display unit is untouched
  });

  it('3,600 LF matched to a per-M (per-1000-ft) item prices at $342, not $342,000', () => {
    const recap = priceBid(
      [line({ unit: 'LF', libraryUnit: 'M', qty: 3600, materialUnitCost: 95, laborHoursUnit: 3.5 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(342);   // 3600/1000 * 95
    expect(recap.lines[0].hoursExt).toBe(12.6);      // 3600/1000 * 3.5
  });

  it('a manual/unmatched line with no libraryUnit falls back to its own display unit (unchanged behavior)', () => {
    const recap = priceBid(
      [line({ unit: 'C', qty: 250, materialUnitCost: 60, laborHoursUnit: 4 })], // libraryUnit omitted
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(150); // same as the pre-fix "C unit" test above
  });

  it('an unknown/missing divisor never produces NaN (B2 defensive fallback)', () => {
    const recap = priceBid(
      [line({ unit: 'LF', libraryUnit: 'BOGUS' as unknown as 'C', qty: 100, materialUnitCost: 5, laborHoursUnit: 1 })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(Number.isFinite(recap.lines[0].materialExt)).toBe(true);
    expect(Number.isFinite(recap.totals.grandTotal)).toBe(true);
  });
});

describe('priceBid — overrides', () => {
  it('material and hours overrides win over the resolved library value', () => {
    const recap = priceBid(
      [line({
        materialUnitCost: 100, laborHoursUnit: 1,
        materialUnitOverride: 40, laborHoursOverride: 0.25,
      })],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines[0].materialExt).toBe(40);
    expect(recap.lines[0].hoursExt).toBe(0.25);
  });

  it('a matched line with a real material cost is not flagged $0-material even with qty 0', () => {
    const recap = priceBid(
      [line({ qty: 0, materialUnitCost: 50, laborHoursUnit: 1, matched: true })],
      baseSettings,
      []
    );
    expect(recap.warnings.zeroMaterialMatchedCount).toBe(0);
  });

  it('flags a matched line whose resolved material cost is 0 and has no override', () => {
    const recap = priceBid(
      [line({ materialUnitCost: 0, laborHoursUnit: 0.3, matched: true })],
      baseSettings,
      []
    );
    expect(recap.warnings.zeroMaterialMatchedCount).toBe(1);
  });
});

describe('priceBid — excluded lines', () => {
  it('an excluded line is priced for display but contributes nothing to totals or categories', () => {
    const recap = priceBid(
      [
        line({ id: 'a', materialUnitCost: 100, laborHoursUnit: 1 }),
        line({ id: 'b', materialUnitCost: 500, laborHoursUnit: 5, excluded: true }),
      ],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.lines.find(l => l.id === 'b')!.materialExt).toBe(500); // still computed for display
    expect(recap.totals.materialSubtotal).toBe(100); // excluded line's 500 is not counted
    expect(recap.warnings.excludedCount).toBe(1);
    expect(recap.categories).toEqual([
      { category: 'Branch Power', material: 100, hours: 1, labor: 40, subtotal: 150.34 },
    ]);
    // The excluded line's directShare is 0 — it never gets a slice of the pools.
    expect(recap.lines.find(l => l.id === 'b')!.directShare).toBe(0);
    expect(recap.lines.find(l => l.id === 'a')!.directShare).toBe(recap.totals.directCost);
  });
});

describe('priceBid — factor exclusivity and application', () => {
  const heightFactors: PricingFactorInput[] = [
    { code: 'HEIGHT-10-14', pct: 10, groupKey: 'height' },
    { code: 'HEIGHT-20-PLUS', pct: 35, groupKey: 'height' },
  ];

  it('sums pcts across different groups', () => {
    expect(effectiveFactorPct([
      { code: 'a', pct: 10, groupKey: 'height' },
      { code: 'b', pct: 15, groupKey: 'occupied' },
    ])).toBe(25);
  });

  it('only counts the first factor per group_key — never both height bands at once', () => {
    expect(effectiveFactorPct(heightFactors)).toBe(10);
  });

  it('applies the factor pct to hours (and therefore labor $), never to material', () => {
    const recap = priceBid(
      [line({ materialUnitCost: 100, laborHoursUnit: 1 })],
      { ...baseSettings, supervisionPct: 0 },
      [{ code: 'HEIGHT-10-14', pct: 10, groupKey: 'height' }]
    );
    expect(recap.lines[0].materialExt).toBe(100); // unaffected
    expect(recap.lines[0].hoursExt).toBe(1.1);     // +10%
    expect(recap.lines[0].laborExt).toBe(44);       // 1.1 * 40
  });
});

describe('priceBid — warnings', () => {
  it('counts unresolved (unmatched) non-excluded lines', () => {
    const recap = priceBid(
      [
        line({ id: 'a', matched: false, unresolved: true }),
        line({ id: 'b', matched: false, unresolved: true, excluded: true }),
      ],
      baseSettings,
      []
    );
    expect(recap.warnings.unmatchedCount).toBe(1); // the excluded one doesn't count
  });

  it('counts VERIFY-confidence lines', () => {
    const recap = priceBid(
      [line({ confidence: 'VERIFY', qty: 0 })],
      baseSettings,
      []
    );
    expect(recap.warnings.verifyCount).toBe(1);
  });

  it('computes the unverified-material share of the total', () => {
    const recap = priceBid(
      [
        line({ id: 'a', materialUnitCost: 100, laborHoursUnit: 0, unverifiedPrice: true }),
        line({ id: 'b', materialUnitCost: 300, laborHoursUnit: 0, unverifiedPrice: false }),
      ],
      { ...baseSettings, supervisionPct: 0 },
      []
    );
    expect(recap.totals.materialSubtotal).toBe(400);
    expect(recap.warnings.unverifiedMaterialShare).toBe(0.25); // 100 / 400
  });
});

describe('priceBid — golden recap for a realistic C-store bid', () => {
  it('matches the hand-computed recap exactly', () => {
    const lines: PricingLineInput[] = [
      line({ id: 'svc', category: 'Service & Distribution', unit: 'EA', qty: 1, materialUnitCost: 1200, laborHoursUnit: 10, matched: true }),
      line({ id: 'lgt', category: 'Interior Lighting', unit: 'EA', qty: 20, materialUnitCost: 95, laborHoursUnit: 0.75, matched: true }),
      line({ id: 'emt', category: 'Branch Power', unit: 'C', qty: 300, materialUnitCost: 60, laborHoursUnit: 4, matched: true }),
      line({ id: 'dup', category: 'Branch Power', unit: 'EA', qty: 50, materialUnitCost: 6, laborHoursUnit: 0.35, matched: true }),
      line({ id: 'gnd-excl', category: 'Grounding', unit: 'EA', qty: 5, materialUnitCost: 45, laborHoursUnit: 1, matched: true, excluded: true }),
      line({ id: 'trench', category: 'Site / Underground / Allowances', unit: 'LF', qty: 100, materialUnitCost: 2.5, laborHoursUnit: 0.08, materialUnitOverride: 3.0, laborHoursOverride: 0.1, matched: true }),
      line({ id: 'lv-unmatched', category: 'Low Voltage Infrastructure (Conduit & Boxes Only)', unit: 'EA', qty: 3, materialUnitCost: 0, laborHoursUnit: 0, matched: false, unresolved: true }),
      line({ id: 'bp-zero-mat', category: 'Branch Power', unit: 'EA', qty: 2, materialUnitCost: 0, laborHoursUnit: 0.3, matched: true }),
      line({ id: 'bp-verify', category: 'Branch Power', unit: 'EA', qty: 0, materialUnitCost: 50, laborHoursUnit: 1, matched: true, confidence: 'VERIFY' }),
      line({ id: 'ext-lgt', category: 'Exterior / Site Lighting', unit: 'EA', qty: 4, materialUnitCost: 145, laborHoursUnit: 1, matched: true, unverifiedPrice: true }),
    ];

    const recap = priceBid(lines, baseSettings, []);

    expect(recap.totals).toEqual({
      materialSubtotal: 4460,
      consumables: 89.20,
      materialTax: 318.44,
      laborHours: 76.01,
      laborCost: 3040.40,
      smallTools: 91.21,
      directCost: 7999.25,
      overhead: 799.93,
      profit: 1319.88,
      grandTotal: 10119.06,
      sellPerSf: 2.02,
      crewWeeks: 0.6334,
    });

    expect(recap.warnings).toEqual({
      unmatchedCount: 1,
      verifyCount: 1,
      zeroMaterialMatchedCount: 1,
      excludedCount: 1,
      unverifiedMaterialShare: 0.13,
    });

    expect(recap.categories).toEqual([
      { category: 'Branch Power', material: 480, hours: 30.1, labor: 1204, subtotal: 1888 },
      { category: 'Exterior / Site Lighting', material: 580, hours: 4, labor: 160, subtotal: 814.29 },
      { category: 'Interior Lighting', material: 1900, hours: 15, labor: 600, subtotal: 2753.46 },
      { category: 'Low Voltage Infrastructure (Conduit & Boxes Only)', material: 0, hours: 0, labor: 0, subtotal: 0 },
      { category: 'Service & Distribution', material: 1200, hours: 10, labor: 400, subtotal: 1762.88 },
      { category: 'Site / Underground / Allowances', material: 300, hours: 10, labor: 400, subtotal: 780.62 },
    ]);

    // Fix round 1 / S10 — category subtotals and per-line directShares both
    // reconcile EXACTLY to directCost (not "material + labor" alone, which in
    // this fixture only sums to $4,410.60 against a $7,999.25 direct cost).
    const categorySum = recap.categories.reduce((s, c) => s + c.subtotal, 0);
    expect(categorySum).toBeCloseTo(recap.totals.directCost, 10);
    const lineSum = recap.lines.reduce((s, l) => s + l.directShare, 0);
    expect(lineSum).toBeCloseTo(recap.totals.directCost, 10);
  });
});

describe('priceBid — S10: subtotals/directShare always reconcile to directCost', () => {
  it('reconciles for an arbitrary mix of categories, overrides and an excluded line', () => {
    const recap = priceBid(
      [
        line({ id: 'a', category: 'Branch Power', materialUnitCost: 37, laborHoursUnit: 0.6 }),
        line({ id: 'b', category: 'Interior Lighting', qty: 3, materialUnitCost: 95, laborHoursUnit: 0.75 }),
        line({ id: 'c', category: 'Grounding', materialUnitOverride: 12.5, laborHoursOverride: 0.2 }),
        line({ id: 'd', category: 'Branch Power', materialUnitCost: 0, laborHoursUnit: 0, excluded: true }),
      ],
      baseSettings,
      []
    );
    const categorySum = recap.categories.reduce((s, c) => s + c.subtotal, 0);
    expect(categorySum).toBeCloseTo(recap.totals.directCost, 10);
    const lineSum = recap.lines.reduce((s, l) => s + l.directShare, 0);
    expect(lineSum).toBeCloseTo(recap.totals.directCost, 10);
  });

  it('reconciles even with zero lines (all pools zero)', () => {
    const recap = priceBid([], baseSettings, []);
    expect(recap.categories).toEqual([]);
    expect(recap.totals.directCost).toBe(0);
  });
});

describe('priceBid — crew weeks', () => {
  it('is 0 when crewSize is 0 rather than dividing by zero', () => {
    const recap = priceBid(
      [line({ materialUnitCost: 0, laborHoursUnit: 40 })],
      { ...baseSettings, crewSize: 0, supervisionPct: 0 },
      []
    );
    expect(recap.totals.crewWeeks).toBe(0);
  });
});
