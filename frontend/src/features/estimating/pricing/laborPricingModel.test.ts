import { describe, it, expect } from 'vitest';
import {
  numberOrDefault, factorGroupLabel, jobConditionsSummary, ratesSummary, takeoffItemOf, isFeederLine, isChangedLine,
  lineMatchesFilter, lineFilterCounts, crewSummary, quotesSummary, costLinesSummary, alternatesSummary, feedersSummary, LINE_FILTERS,
} from './laborPricingModel';
import { DEFAULT_ACCUBID_SETTINGS, DEFAULT_SETTINGS, type EstimateLine, type LibraryFactor, type AccubidQuote, type AccubidCostLine, type AccubidAlternate } from '../types';

const F: LibraryFactor[] = [
  { id: 'h1', code: 'HEIGHT-10-14', label: 'Height 10-14', pct: 10, group_key: 'height', active: true },
  { id: 'h2', code: 'HEIGHT-14-20', label: 'Height 14-20', pct: 20, group_key: 'height', active: true },
  { id: 'occ', code: 'OCCUPIED', label: 'Occupied', pct: 15, group_key: 'occupied', active: true },
  { id: 'ms', code: 'MULTI-STORY', label: 'Multi-story', pct: 3, group_key: 'multistory', active: true },
  { id: 'old', code: 'OLD', label: 'Retired', pct: 5, group_key: 'access', active: false },
];

describe('numberOrDefault', () => {
  it('reverts blank / non-numeric input to the fallback', () => {
    expect(numberOrDefault('', 7)).toBe(7);
    expect(numberOrDefault('  ', 7)).toBe(7);
    expect(numberOrDefault('abc', 7)).toBe(7);
    expect(numberOrDefault('0', 7)).toBe(0);
    expect(numberOrDefault('12.5', 7)).toBe(12.5);
  });
});

describe('factorGroupLabel', () => {
  it('names the seeded groups and tidies any other key', () => {
    expect(factorGroupLabel('height')).toBe('Working height');
    expect(factorGroupLabel('occupied')).toBe('Occupied building');
    expect(factorGroupLabel('congested')).toBe('Ceiling space');
    expect(factorGroupLabel('schedule')).toBe('Work hours');
    expect(factorGroupLabel('multistory')).toBe('Multi-story');
    expect(factorGroupLabel('access')).toBe('Site access');
    expect(factorGroupLabel('wage')).toBe('Wage rate');
    expect(factorGroupLabel('night_work')).toBe('Night work');
  });
});

describe('jobConditionsSummary', () => {
  it('says None selected with nothing picked', () => {
    expect(jobConditionsSummary([], F, 0, 'phase_a')).toBe('None selected');
  });
  it('adds in Quick mode and compounds in Accubid mode', () => {
    expect(jobConditionsSummary(['h1', 'occ'], F, 0, 'phase_a')).toBe('2 factors, +25% labor hours');
    expect(jobConditionsSummary(['h1', 'occ'], F, 0, 'accubid')).toBe('2 factors, +26.5% labor hours (compounded)');
  });
  it('counts only the first factor per group', () => {
    expect(jobConditionsSummary(['h1', 'h2'], F, 0, 'phase_a')).toBe('1 factor, +10% labor hours');
  });
  it('scales Multi-story by the floors above 2 and explains a missing floor count', () => {
    expect(jobConditionsSummary(['ms'], F, 0, 'phase_a')).toBe('1 factor, +0% labor hours · Multi-story needs floors above 2');
    expect(jobConditionsSummary(['ms'], F, 4, 'phase_a')).toBe('1 factor, +12% labor hours · 4 floors above 2');
    expect(jobConditionsSummary(['ms'], F, 1, 'phase_a')).toBe('1 factor, +3% labor hours · 1 floor above 2');
  });
  it('flags floors that nothing uses', () => {
    expect(jobConditionsSummary(['h1'], F, 3, 'phase_a')).toBe('1 factor, +10% labor hours · 3 floors above 2 (Multi-story not picked)');
  });
  it('ignores unknown ids but still counts an inactive factor (the backend uses every library factor by id)', () => {
    expect(jobConditionsSummary(['nope', 'old'], F, 0, 'phase_a')).toBe('1 factor, +5% labor hours');
    expect(jobConditionsSummary(['nope'], F, 0, 'phase_a')).toBe('None selected');
  });
  it('falls back to a count while the library has not loaded', () => {
    expect(jobConditionsSummary([], undefined, 0, 'phase_a')).toBe('None selected');
    expect(jobConditionsSummary(['a', 'b'], undefined, 0, 'accubid')).toBe('2 selected');
  });
});

describe('ratesSummary', () => {
  it('prints the headline rates', () => {
    expect(ratesSummary({ ...DEFAULT_SETTINGS, labor_rate: 40, crew_size: 3, overhead_pct: 10, profit_pct: 15, material_tax_pct: 7 }))
      .toBe('Labor $40/hr · Crew 3 · Overhead 10% · Profit 15% · Tax 7%');
  });
});

describe('takeoffItemOf / isFeederLine', () => {
  it('strips the category prefix and a trailing ::n', () => {
    expect(takeoffItemOf('Cat||Feeder — A → B: 3/4" EMT::2')).toBe('Feeder — A → B: 3/4" EMT');
    expect(takeoffItemOf('No separator')).toBe('No separator');
    expect(takeoffItemOf(null)).toBe('');
  });
  it('recognises feeder conduit, wire and MEASURE FEEDER lines, but not others', () => {
    expect(isFeederLine({ takeoff_key: 'F||Feeder — A → B: 3/4" EMT' })).toBe(true);
    expect(isFeederLine({ takeoff_key: 'F||Feeder — A → B: wire (4#1)' })).toBe(true);
    expect(isFeederLine({ takeoff_key: 'F||MEASURE FEEDER — conduit — A → B' })).toBe(true);
    expect(isFeederLine({ takeoff_key: 'Branch||Duplex' })).toBe(false);
    expect(isFeederLine({ takeoff_key: null })).toBe(false);
  });
});

const base: EstimateLine = { category: 'C', description: 'd', qty: 1, unit: 'EA', source: 'takeoff' };
describe('isChangedLine', () => {
  it('is false for an untouched takeoff line', () => expect(isChangedLine(base)).toBe(false));
  it('is true for each trigger', () => {
    expect(isChangedLine({ ...base, source: 'manual' })).toBe(true);
    expect(isChangedLine({ ...base, qty_overridden: true })).toBe(true);
    expect(isChangedLine({ ...base, qty_source: 'manual' })).toBe(true);
    expect(isChangedLine({ ...base, material_unit_override: 0 })).toBe(true);
    expect(isChangedLine({ ...base, labor_hours_override: 0 })).toBe(true);
    expect(isChangedLine({ ...base, recheck_run_id: 'r1' })).toBe(true);
  });
});

describe('line filters', () => {
  const lines: EstimateLine[] = [
    { ...base, id: 'hold' },
    { ...base, id: 'furn' },
    { ...base, id: 'feed', takeoff_key: 'F||Feeder — A → B: 1" EMT' },
    { ...base, id: 'chg', qty_overridden: true },
    { ...base, id: 'exc', excluded: true },
  ];
  const ctx = { holdIds: new Set(['hold']), furnishIds: new Set(['furn']) };
  it('matches each filter', () => {
    expect(lines.filter(l => lineMatchesFilter('holds', l, ctx)).map(l => l.id)).toEqual(['hold']);
    expect(lines.filter(l => lineMatchesFilter('furnished', l, ctx)).map(l => l.id)).toEqual(['furn']);
    expect(lines.filter(l => lineMatchesFilter('feeders', l, ctx)).map(l => l.id)).toEqual(['feed']);
    expect(lines.filter(l => lineMatchesFilter('changed', l, ctx)).map(l => l.id)).toEqual(['chg']);
    expect(lines.filter(l => lineMatchesFilter('excluded', l, ctx)).map(l => l.id)).toEqual(['exc']);
    expect(lines.filter(l => lineMatchesFilter('all', l, ctx))).toHaveLength(5);
  });
  it('does not match holds for a line with no id', () => {
    expect(lineMatchesFilter('holds', { ...base }, { holdIds: { has: () => true }, furnishIds: new Set() })).toBe(false);
  });
  it('counts lines per filter', () => {
    expect(lineFilterCounts(lines, ctx)).toEqual({ all: 5, holds: 1, furnished: 1, feeders: 1, changed: 1, excluded: 1 });
    expect(lineFilterCounts([], ctx)).toEqual({ all: 0, holds: 0, furnished: 0, feeders: 0, changed: 0, excluded: 0 });
  });
  it('keeps the sidebar wording on the holds chip', () => {
    expect(LINE_FILTERS.find(f => f.key === 'holds')!.label).toBe('Needs a price/unit');
  });
});

describe('Accubid and feeder summaries', () => {
  it('crewSummary', () => {
    expect(crewSummary(DEFAULT_ACCUBID_SETTINGS, false)).toBe('1 journeyman, 2 apprentices, 0 foremen · Day shift · Labor overhead 38% · Markup 20% material / 20% labor');
    expect(crewSummary({ ...DEFAULT_ACCUBID_SETTINGS, apprenticeCount: 1, foremanCount: 1, shift: 'night' }, true))
      .toBe('1 journeyman, 1 apprentice, 1 foreman · Night shift · Labor overhead 38% · Markup 20% material / 20% labor · Not saved');
  });
  it('quotesSummary', () => {
    const q = (id: string, amount: number, status: AccubidQuote['status']): AccubidQuote => ({ id, description: id, amount, taxPct: 0, markupPct: 18, status, vendor: null, sort: 0 });
    expect(quotesSummary([])).toBe('None');
    expect(quotesSummary([q('a', 5000, 'budget_pending'), q('b', 4500, 'firm')])).toBe('2 quotes · $9,500.00 · 1 budget-pending');
    expect(quotesSummary([q('a', 100, 'firm')])).toBe('1 quote · $100.00');
  });
  it('costLinesSummary', () => {
    const c = (amount: number, preview?: boolean): AccubidCostLine => ({ id: String(amount), kind: 'equipment', description: 'x', amount, taxPct: 0, sort: 0, preview });
    expect(costLinesSummary([])).toBe('None');
    expect(costLinesSummary([c(1000), c(250)])).toBe('2 lines · $1,250.00');
    expect(costLinesSummary([c(500, true)])).toBe('1 line · $500.00 (default added on save)');
  });
  it('alternatesSummary', () => {
    const a = (kind: 'add' | 'deduct'): AccubidAlternate => ({ id: kind, kind, description: 'x', amount: 1, auto: false, sourceRule: null, sort: 0 });
    expect(alternatesSummary([])).toBe('None');
    expect(alternatesSummary([a('add'), a('deduct'), a('deduct')])).toBe('1 add, 2 deduct');
  });
  it('feedersSummary', () => {
    expect(feedersSummary({ edges: [], calibration: true, summary: { suggested: 0, holds: 0 } })).toBe('None found on this job');
    expect(feedersSummary({ edges: [1, 2], calibration: false, summary: { suggested: 1, holds: 1 } })).toBe('2 feeders · 1 to confirm · 1 need a location / scale / size');
    expect(feedersSummary({ edges: [1], calibration: true, summary: { suggested: 0, holds: 0 } })).toBe('1 feeder · Calibration job');
  });
});
