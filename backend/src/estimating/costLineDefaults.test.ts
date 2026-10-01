// Remodel + footage round, B4 — the default Equipment / General Expenses
// rule, fitted to Chris's 2025–26 breakdowns only (Jake's rule: pricing
// defaults come from 2025–2026 jobs). These tests re-fit it and fail if the
// seeded default (migration 151) drifts from the data, and pin the
// leave-one-out error the report quotes.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  CHRIS_BREAKDOWNS, fitEquipmentRule, fitGeneralExpensesRule, applyCostRule, costRuleLoo, pricingWindow,
  DEFAULT_COST_LINE_DEFAULTS, parseCostLineDefaults,
} from './costLineDefaults';

const window = pricingWindow(CHRIS_BREAKDOWNS);

describe('B4 — equipment / general expenses defaults', () => {
  it('fits on the four 2025–26 breakdowns only (no fallback needed)', () => {
    expect(window.fallback).toBe(false);
    expect(window.rows.map(r => r.job)).toEqual(['AutoZone Kissimmee', 'Bubble Down Remodel', 'Gulf Simulator', 'James Co Seminole State']);
    expect(pricingWindow(CHRIS_BREAKDOWNS.filter(r => r.date < '2025' || r.job === 'Gulf Simulator'))).toMatchObject({ fallback: true });
  });

  it('the defaults are the rules fitted to that window', () => {
    expect(fitEquipmentRule(window.rows)).toEqual(DEFAULT_COST_LINE_DEFAULTS.equipment);
    expect(fitGeneralExpensesRule(window.rows)).toEqual(DEFAULT_COST_LINE_DEFAULTS.generalExpenses);
  });

  it('applies: max($890, $7.30/h) equipment; $270 GE up to 300 h, $2,500 above', () => {
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 189.21)).toBe(1381.23);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, 189.21)).toBe(270);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 100)).toBe(890);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 0)).toBe(0);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 1000)).toBe(7300);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, 1000)).toBe(2500);
  });

  it('pins the leave-one-out table on the window (4 jobs — weak, reported as such)', () => {
    const fmt = (r: { job: string; predicted: number; errorPct: number | null }) => [r.job, Math.round(r.predicted), r.errorPct == null ? null : Math.round(r.errorPct)];
    const eq = costRuleLoo(window.rows, 'equipment');
    const ge = costRuleLoo(window.rows, 'generalExpenses');
    expect(eq.rows.map(fmt)).toEqual([
      ['AutoZone Kissimmee', 11521, 165], ['Bubble Down Remodel', 1132, -62], ['Gulf Simulator', 2364, null], ['James Co Seminole State', 1441, null],
    ]);
    expect(ge.rows.map(fmt)).toEqual([
      ['AutoZone Kissimmee', 1220, -68], ['Bubble Down Remodel', 270, null], ['Gulf Simulator', 3770, 209], ['James Co Seminole State', 0, -100],
    ]);
    expect(Math.round(eq.mae)).toBe(114);
    expect(Math.round(ge.mae)).toBe(126);
  });

  it('migration 152 moves an untouched 151 seed (the all-breakdown fit) to exactly the default rule; bad stored JSON falls back to it', () => {
    const m151 = fs.readFileSync(path.join(__dirname, '../../../database/migrations/151_cost_line_defaults.sql'), 'utf8');
    const m152 = fs.readFileSync(path.join(__dirname, '../../../database/migrations/152_footage_round_fixes.sql'), 'utf8');
    const seeded151 = JSON.parse(m151.match(/SELECT 'est_cost_line_defaults', '(.*)'\n/)![1]);
    expect(seeded151).toEqual({ version: 1, equipment: fitEquipmentRule(CHRIS_BREAKDOWNS), generalExpenses: fitGeneralExpensesRule(CHRIS_BREAKDOWNS) });
    const [, to, from] = m152.match(/SET value = '(.*)'\n WHERE key = 'est_cost_line_defaults'\n   AND value = '(.*)';/)!;
    expect(JSON.parse(from)).toEqual(seeded151);
    expect(JSON.parse(to)).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults('{nope')).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults(JSON.stringify({ equipment: { perHour: -1, minimum: 500 } })).equipment).toEqual({ ...DEFAULT_COST_LINE_DEFAULTS.equipment, minimum: 500 });
  });
});

// Accuracy round E4 — itemized defaults (settings v2, migration 159).
import { defaultCostLine as e4Line, parseCostLineDefaults as e4Parse, COST_LINE_DEFAULTS_V2, CHRIS_BREAKDOWNS as E4_BREAKDOWNS, costLineContextFrom } from './costLineDefaults';
describe('E4 — itemized equipment / GE defaults (v2)', () => {
  const v2 = e4Parse(JSON.stringify(COST_LINE_DEFAULTS_V2));
  it('Kissimmee (site poles, 798.9 h): equipment $4,350 exactly, GE $3,020 of Chris\'s $3,770 (the $750 camera pole is AutoZone\'s)', () => {
    const ctx = { sitePoles: true, undergroundSite: true, exteriorHigh: true, newBuild: false };
    expect(e4Line('equipment', v2, 798.949, ctx)).toEqual({ amount: 4350, description: 'Equipment — default: scissor lift $1,250 + towable boom lift $950 + mini excavator $2,150' });
    expect(e4Line('general_expense', v2, 798.949, ctx)).toEqual({ amount: 3020, description: 'General expenses — default: permits $270 + temporary power $1,800 + temporary lighting $950' });
  });
  it('a small job with nothing on site: one scissor lift and permits', () => {
    expect(e4Line('equipment', v2, 189.21).amount).toBe(1250);
    expect(e4Line('general_expense', v2, 189.21).amount).toBe(270);
  });
  it('v1 settings still parse and price as v1 (old bids exact)', () => {
    const v1 = e4Parse(JSON.stringify({ version: 1, equipment: { smallJobMaxHours: 0, smallJobAmount: 0, perHour: 7.3, minimum: 890 }, generalExpenses: { smallJobMaxHours: 300, smallJobAmount: 270, perHour: 0, minimum: 2500 } }));
    expect(v1.items).toBeUndefined();
    expect(e4Line('equipment', v1, 189.21)).toEqual({ amount: 1381.23, description: 'Equipment — default' });
  });
  it('context from lines: a site pole line means a boom lift and an excavator', () => {
    expect(costLineContextFrom([{ category: 'Exterior Site Lighting', description: 'site pole', qty: 3, code: 'LTG-POLE' }], null)).toEqual({ sitePoles: true, undergroundSite: true, exteriorHigh: true, newBuild: false });
    expect(costLineContextFrom([{ category: 'Branch Power', description: 'Duplex', qty: 3, code: 'DEV-DUP' }], 'new').newBuild).toBe(true);
  });
  it('prints the fit against all 10 breakdowns (features beyond hours known for Kissimmee only — the others assume no site poles)', () => {
    const rows = E4_BREAKDOWNS.map(b => {
      const ctx = { sitePoles: /Kissimmee/.test(b.job), undergroundSite: /Kissimmee/.test(b.job), exteriorHigh: /Kissimmee/.test(b.job), newBuild: false };
      const e = e4Line('equipment', v2, b.hours, ctx).amount, g = e4Line('general_expense', v2, b.hours, ctx).amount;
      return `${b.job.padEnd(26)} ${b.date} ${String(b.hours).padStart(8)} h  equipment ${String(b.equipment).padStart(5)} vs ${String(e).padStart(5)}  GE ${String(b.generalExpenses).padStart(5)} vs ${String(g).padStart(5)}`;
    });
    // eslint-disable-next-line no-console
    console.log(`[E4 fit]\n${rows.join('\n')}`);
    expect(rows.length).toBe(10);
  });
});
