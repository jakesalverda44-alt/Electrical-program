import { describe, it, expect } from 'vitest';
import { computeAccubidRecap, computeFieldLaborCost, fullCostPerHour, CrewConfig } from './accubidRecap';

// Every input below is transcribed from the real Accubid "Breakdown" PDF
// exports (pdftotext -layout), Final Price / Field Labor pages — see
// docs/superpowers/plans/2026-09-24-next-round-report.md's Part B section
// for the source paths. This is the actual arithmetic Chris's Accubid
// produces; the goal is bit-for-bit (well, cent-for-cent) reproduction.

describe('fullCostPerHour', () => {
  it('rate*(1+burden%)+fringe — Kissimmee Journeyman: 39.00*1.04+1.50=42.06', () => {
    expect(fullCostPerHour(39, 4, 1.5)).toBeCloseTo(42.06, 2);
  });
  it('Kissimmee Apprentice: 27.00*1.04+1.50=29.58', () => {
    expect(fullCostPerHour(27, 4, 1.5)).toBeCloseTo(29.58, 2);
  });
});

describe('computeFieldLaborCost — crew/hours reproduction, with the documented rounding quirk', () => {
  it('Bubble Down (night shift, EVEN 104/104 split — no crew-ratio rounding ambiguity): reproduces $10,911.68 EXACTLY', () => {
    const crew: CrewConfig = {
      shift: 'night',
      burdenPct: 4, fringePerHr: 1.5,
      members: [{ role: 'journeyman', count: 1, rate: 59 }, { role: 'apprentice', count: 1, rate: 39 }],
    };
    const result = computeFieldLaborCost(208, crew);
    expect(result.totalCost).toBeCloseTo(10911.68, 2);
  });

  it('Seminole State (1J:1A, evenly divisible 197.458/2=98.729): reproduces $7,483.66 EXACTLY', () => {
    const crew: CrewConfig = {
      shift: 'day', burdenPct: 4, fringePerHr: 1.5,
      members: [{ role: 'journeyman', count: 1, rate: 41 }, { role: 'apprentice', count: 1, rate: 29 }],
    };
    const result = computeFieldLaborCost(197.458, crew);
    expect(result.totalCost).toBeCloseTo(7483.66, 2);
  });

  it('Kissimmee (1J:2A, 798.949h NOT evenly divisible by 3): within the documented <= $0.05 tolerance of $26,956.52', () => {
    const crew: CrewConfig = {
      shift: 'day', burdenPct: 4, fringePerHr: 1.5,
      members: [{ role: 'journeyman', count: 1, rate: 39 }, { role: 'apprentice', count: 2, rate: 27 }],
    };
    const result = computeFieldLaborCost(798.949, crew);
    expect(Math.abs(result.totalCost - 26956.52)).toBeLessThanOrEqual(0.05);
  });

  it('Golf Simulator (1J:2A, 323.793h NOT evenly divisible by 3): within the documented <= $0.05 tolerance of $10,700.28', () => {
    const crew: CrewConfig = {
      shift: 'day', burdenPct: 4, fringePerHr: 1.5,
      members: [{ role: 'journeyman', count: 1, rate: 37 }, { role: 'apprentice', count: 2, rate: 27 }],
    };
    const result = computeFieldLaborCost(323.793, crew);
    expect(Math.abs(result.totalCost - 10700.28)).toBeLessThanOrEqual(0.05);
  });
});

describe('computeAccubidRecap — reproduces Chris\'s Selling Price to the cent, from his own inputs', () => {
  it('Autozone Kissimmee: $79,112.23 (18% OH / 22% markup / 1% adjustment — Chris\'s own job percentages, not the 38/20/18 defaults)', () => {
    const r = computeAccubidRecap({
      material: { amount: 25842.56 },
      fieldLaborCost: 26956.52, // Chris's own printed Field Labor total (see computeFieldLaborCost's own test for the crew-side reproduction)
      equipment: { amount: 4350.00 },
      generalExpenses: { amount: 3770.00 },
      laborOverheadPct: 18,
      materialMarkupPct: 22,
      laborMarkupPct: 22,
      adjustmentMarkupPct: 1,
    });
    expect(r.laborOverhead).toBeCloseTo(4852.17, 2);
    expect(r.netCost).toBeCloseTo(65771.25, 2);
    expect(r.materialMarkup).toBeCloseTo(5685.36, 2);
    expect(r.laborMarkup).toBeCloseTo(6997.91, 2);
    expect(r.adjustmentMarkup).toBeCloseTo(657.71, 2);
    expect(r.totalMarkup).toBeCloseTo(13340.98, 2);
    expect(r.sellingPrice).toBeCloseTo(79112.23, 2);
  });

  it('Gulf Simulator: $36,429.57 (12% OH / 18% markup+quotes / 2% adjustment)', () => {
    const r = computeAccubidRecap({
      material: { amount: 12356.66 },
      fieldLaborCost: 10700.28,
      generalExpenses: { amount: 1220.00 },
      quotes: [
        { description: 'Distribution', amount: 1850.00, markupPct: 18, status: 'firm' },
        { description: 'Lighting', amount: 3130.00, markupPct: 18, status: 'firm' },
      ],
      laborOverheadPct: 12,
      materialMarkupPct: 18,
      laborMarkupPct: 18,
      adjustmentMarkupPct: 2,
    });
    expect(r.quotesMarkupTotal).toBeCloseTo(896.40, 2);
    expect(r.laborOverhead).toBeCloseTo(1284.03, 2);
    expect(r.netCost).toBeCloseTo(30540.97, 2);
    expect(r.materialMarkup).toBeCloseTo(2224.20, 2);
    expect(r.laborMarkup).toBeCloseTo(2157.18, 2);
    expect(r.adjustmentMarkup).toBeCloseTo(610.82, 2);
    expect(r.totalMarkup).toBeCloseTo(5888.60, 2);
    expect(r.sellingPrice).toBeCloseTo(36429.57, 2);
    expect(r.blocksSend).toBe(false);
  });

  it('James Co Seminole State: $20,991.53 (22% OH/markup, PER-QUOTE markup 18%/20%)', () => {
    const r = computeAccubidRecap({
      material: { amount: 5032.98 },
      fieldLaborCost: 7483.66,
      generalExpenses: { amount: 270.00 },
      quotes: [
        { description: 'Distribution', amount: 1270.00, markupPct: 18, status: 'firm' },
        { description: 'Lighting', amount: 1620.00, markupPct: 20, status: 'firm' },
      ],
      laborOverheadPct: 22,
      materialMarkupPct: 22,
      laborMarkupPct: 22,
      adjustmentMarkupPct: 0,
    });
    expect(r.quotesMarkupTotal).toBeCloseTo(552.60, 2);
    expect(r.laborOverhead).toBeCloseTo(1646.41, 2);
    expect(r.netCost).toBeCloseTo(17323.05, 2);
    expect(r.materialMarkup).toBeCloseTo(1107.26, 2);
    expect(r.laborMarkup).toBeCloseTo(2008.62, 2);
    expect(r.totalMarkup).toBeCloseTo(3668.48, 2);
    expect(r.sellingPrice).toBeCloseTo(20991.53, 2);
  });

  it('Bubble Down Remodel: $36,925.89 (42% OH, 22% markup, 18% quote, 4% adjustment, night-shift crew)', () => {
    const r = computeAccubidRecap({
      material: { amount: 4915.96 },
      fieldLaborCost: 10911.68,
      equipment: { amount: 3000.00 },
      quotes: [{ description: 'Lighting', amount: 6630.00, markupPct: 18, status: 'firm' }],
      laborOverheadPct: 42,
      materialMarkupPct: 22,
      laborMarkupPct: 22,
      adjustmentMarkupPct: 4,
    });
    expect(r.laborOverhead).toBeCloseTo(4582.91, 2);
    expect(r.netCost).toBeCloseTo(30040.55, 2);
    expect(r.quotesMarkupTotal).toBeCloseTo(1193.40, 2);
    expect(r.adjustmentMarkup).toBeCloseTo(1201.62, 2);
    expect(r.totalMarkup).toBeCloseTo(6885.34, 2);
    expect(r.sellingPrice).toBeCloseTo(36925.89, 2);
  });

  it('36th Street Warehouse: $22,553.54 (material tax 7%, 70% labor OH, 15%/10% markups, 1% CE Sales Markup last)', () => {
    const r = computeAccubidRecap({
      material: { amount: 3399.32, taxPct: 7 },
      fieldLaborCost: 6383.97,
      equipment: { amount: 890.00 },
      generalExpenses: { amount: 310.00 },
      quotes: [
        { description: 'Lighting', amount: 1965.00, taxPct: 7, markupPct: 10, status: 'firm' },
        { description: 'Lighting Optional', amount: 1830.00, taxPct: 7, markupPct: 10, status: 'firm' },
      ],
      laborOverheadPct: 70,
      materialMarkupPct: 15,
      laborMarkupPct: 15,
      salesMarkupPct: 1,
    });
    expect(r.materialTax).toBeCloseTo(237.95, 2);
    expect(r.materialTotal).toBeCloseTo(3637.27, 2);
    expect(r.quotesTaxTotal).toBeCloseTo(265.65, 2);
    expect(r.quotesMarkupTotal).toBeCloseTo(406.07, 2);
    expect(r.primeCost).toBeCloseTo(15281.89, 2);
    expect(r.laborOverhead).toBeCloseTo(4468.78, 2);
    expect(r.netCost).toBeCloseTo(19750.67, 2);
    expect(r.materialMarkup).toBeCloseTo(545.59, 2);
    expect(r.laborMarkup).toBeCloseTo(1627.91, 2);
    expect(r.totalMarkup).toBeCloseTo(2579.57, 2);
    expect(r.salesMarkup).toBeCloseTo(223.30, 2);
    expect(r.sellingPrice).toBeCloseTo(22553.54, 2);
  });

  it('Orlando Clubhouse (bonus — BOM + breakdown both complete): $97,649.38 (material+equipment tax, per-quote 15%/10% markup, 1% CE Sales Markup)', () => {
    const r = computeAccubidRecap({
      material: { amount: 14976.39, taxPct: 7 },
      fieldLaborCost: 20463.92,
      equipment: { amount: 1860.00, taxPct: 7 },
      generalExpenses: { amount: 3060.00 },
      quotes: [
        { description: 'Distribution', amount: 3950.00, taxPct: 7, markupPct: 15, status: 'firm' },
        { description: 'Lighting', amount: 22780.00, taxPct: 7, markupPct: 10, status: 'firm' },
      ],
      laborOverheadPct: 70,
      materialMarkupPct: 18,
      laborMarkupPct: 18,
      salesMarkupPct: 1,
    });
    expect(r.materialTotal).toBeCloseTo(16024.74, 2);
    expect(r.equipmentTotal).toBeCloseTo(1990.20, 2);
    expect(r.quotesMarkupTotal).toBeCloseTo(3071.44, 2);
    expect(r.primeCost).toBeCloseTo(70139.96, 2);
    expect(r.laborOverhead).toBeCloseTo(14324.74, 2);
    expect(r.netCost).toBeCloseTo(84464.70, 2);
    expect(r.totalMarkup).toBeCloseTo(12217.85, 2);
    expect(r.salesMarkup).toBeCloseTo(966.83, 2);
    expect(r.sellingPrice).toBeCloseTo(97649.38, 2);
  });

  it('a budget-pending quote blocks send (Chris\'s "hold until CES gets back")', () => {
    const r = computeAccubidRecap({
      material: { amount: 1000 },
      fieldLaborCost: 1000,
      quotes: [{ description: 'Switchgear', amount: 5000, markupPct: 18, status: 'budget_pending' }],
      laborOverheadPct: 38,
      materialMarkupPct: 20,
      laborMarkupPct: 20,
    });
    expect(r.blocksSend).toBe(true);
    expect(r.budgetPendingQuotes).toHaveLength(1);
  });

  it('never produces NaN or a negative selling price for an all-zero input', () => {
    const r = computeAccubidRecap({ material: { amount: 0 }, fieldLaborCost: 0, laborOverheadPct: 38, materialMarkupPct: 20, laborMarkupPct: 20 });
    expect(Number.isFinite(r.sellingPrice)).toBe(true);
    expect(r.sellingPrice).toBeGreaterThanOrEqual(0);
  });
});
