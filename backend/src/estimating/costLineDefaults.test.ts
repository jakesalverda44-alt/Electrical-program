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

  it('migration 151 seeds exactly the default rule; bad stored JSON falls back to it', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/151_cost_line_defaults.sql'), 'utf8');
    const json = sql.match(/SELECT 'est_cost_line_defaults', '(.*)'\n/)![1];
    expect(JSON.parse(json)).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults('{nope')).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults(JSON.stringify({ equipment: { perHour: -1, minimum: 500 } })).equipment).toEqual({ ...DEFAULT_COST_LINE_DEFAULTS.equipment, minimum: 500 });
  });
});
