// Remodel + footage round, B4 — the default Equipment / General Expenses
// rule, fitted to Chris's ten breakdowns. These tests re-fit it and fail if
// the seeded default (migration 151) drifts from the data, and pin the
// leave-one-out error per job the report quotes.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  CHRIS_BREAKDOWNS, fitEquipmentRule, fitGeneralExpensesRule, applyCostRule, costRuleLoo,
  DEFAULT_COST_LINE_DEFAULTS, parseCostLineDefaults,
} from './costLineDefaults';

describe('B4 — equipment / general expenses defaults', () => {
  it('the defaults are the rules fitted to the breakdowns', () => {
    expect(fitEquipmentRule(CHRIS_BREAKDOWNS)).toEqual(DEFAULT_COST_LINE_DEFAULTS.equipment);
    expect(fitGeneralExpensesRule(CHRIS_BREAKDOWNS)).toEqual(DEFAULT_COST_LINE_DEFAULTS.generalExpenses);
  });

  it("36th Street (189.21 h): $890 equipment — Chris's exact scissor lift — and $290 GE (his $310 permit)", () => {
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 189.21)).toBe(890);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, 189.21)).toBe(290);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 0)).toBe(0);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.equipment, 1000)).toBe(4030);
    expect(applyCostRule(DEFAULT_COST_LINE_DEFAULTS.generalExpenses, 1000)).toBe(3060);
  });

  it('pins the leave-one-out table (predicted $, error %)', () => {
    const eq = costRuleLoo(CHRIS_BREAKDOWNS, 'equipment');
    const ge = costRuleLoo(CHRIS_BREAKDOWNS, 'generalExpenses');
    const fmt = (r: { job: string; predicted: number; errorPct: number | null }) => [r.job, Math.round(r.predicted), r.errorPct == null ? null : Math.round(r.errorPct)];
    expect(eq.rows.map(fmt)).toEqual([
      ['36th Street Warehouse', 890, 0],
      ['7-11 #10319 Fort Myers', 5442, -24],
      ['AutoZone Kissimmee', 3100, -29],
      ['Bubble Down Remodel', 890, -70],
      ['Gulf Simulator', 1305, null],
      ['James Co Seminole State', 890, null],
      ['North Port Storage', 7513, 6],
      ['Orlando Clubhouse', 2487, 34],
      ['Rockledge Storage', 5853, 33],
      ['Big Dans Temple Terrace', 9874, 58],
    ]);
    expect(Math.round(eq.mae)).toBe(32);
    expect(ge.rows.map(fmt)).toEqual([
      ['36th Street Warehouse', 270, -13],
      ['7-11 #10319 Fort Myers', 3060, 23],
      ['AutoZone Kissimmee', 3060, -19],
      ['Bubble Down Remodel', 290, null],
      ['Gulf Simulator', 3060, 151],
      ['James Co Seminole State', 310, 15],
      ['North Port Storage', 3060, -8],
      ['Orlando Clubhouse', 3060, 0],
      ['Rockledge Storage', 3060, 0],
      ['Big Dans Temple Terrace', 3060, null],
    ]);
    expect(Math.round(ge.mae)).toBe(28);
  });

  it('migration 151 seeds exactly the default rule; bad stored JSON falls back to it', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../database/migrations/151_cost_line_defaults.sql'), 'utf8');
    const json = sql.match(/SELECT 'est_cost_line_defaults', '(.*)'\n/)![1];
    expect(parseCostLineDefaults(json)).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(JSON.parse(json)).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults('{nope')).toEqual(DEFAULT_COST_LINE_DEFAULTS);
    expect(parseCostLineDefaults(JSON.stringify({ equipment: { perHour: -1, minimum: 500 } })).equipment).toEqual({ ...DEFAULT_COST_LINE_DEFAULTS.equipment, minimum: 500 });
  });
});
