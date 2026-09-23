// Takeoff accuracy Task 10 — the eval harness's diff logic and cost math, on
// a Kissimmee-shaped count_result, plus the committed expected file and a
// DRY run of the script (no --confirm-live-api: nothing is sent anywhere).
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { validateExpectedFile, diffAgainstExpected, usageCost, formatDiffTable, type ExpectedFile } from './takeoffEval';
import { mergeCountsIntoTakeoff } from '../ai/countMerge';
import { buildCountTargets } from '../ai/countTargets';
import { kissimmeeAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';
import type { CountResult } from '../ai/countingStage';
import type { CountSheet } from '../ai/countSheets';

const EXPECTED_PATH = path.join(__dirname, '../../eval/autozone-10077-kissimmee.expected.json');

function kissimmeeCountResult(): CountResult {
  const a1 = kissimmeeAgent1();
  const { targets } = buildCountTargets(a1);
  const sheet = (sheetNo: string, title: string, role: CountSheet['role'], focus: CountSheet['focus']): CountSheet =>
    ({ key: sheetNo, file: 'f', page: 1, sheetNo, title, label: sheetNo, role, focus, level: '' });
  const marks = (c: Record<string, number>) => Object.entries(c).flatMap(([k, n]) => Array.from({ length: n }, () => ({ typeKey: k })));
  const merged = mergeCountsIntoTakeoff(a1, targets, [
    { sheet: sheet('E-1', 'ELECTRICAL SITE PLAN', 'site', 'combined'), status: 'counted', placed: marks({ S1: 2, S2: 1 }), unreadable: [] },
    { sheet: sheet('E-2', 'POWER PLAN', 'building', 'power'), status: 'counted', placed: marks({ GFI: 16, 'DUPLEX RECEPTACLE': 11, S: 8, 'RTU-1': 2 }), unreadable: [] },
    { sheet: sheet('E-3', 'LIGHTING PLAN', 'building', 'lighting'), status: 'counted', placed: marks({ A: 73, B: 52, M: 6, C: 2, G: 11, E: 10, F: 6, K: 6, J: 2, D: 5, L: 2 }), unreadable: [] },
  ], { countingRan: true });
  return { version: 1, ran: true, model: 'claude-opus-5-5', targets, targetNotes: [], sheets: [], skippedSheets: [], types: merged.types, loadCheck: merged.loadCheck, removedRows: [], flags: [], marks: [] };
}

describe('the committed expected file', () => {
  const expected = validateExpectedFile(JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8')));
  it('carries the Cowork/BOM primary values, disputed items marked, the reference estimate informational', () => {
    const byId = Object.fromEntries(expected.items.map(i => [i.id, i]));
    expect(byId.linear_led_total.expected).toBe(133);
    expect(byId.type_A.expected + byId.type_B.expected + byId.type_M.expected + byId.type_C.expected).toBe(133);
    expect([byId.exit_emergency, byId.wall_packs, byId.retail_power_poles].map(i => [i.expected, i.disputed])).toEqual([[22, true], [9, true], [8, true]]);
    expect([byId.site_poles.expected, byId.site_heads.expected, byId.downlights.expected, byId.receptacles_total.expected, byId.gfci.expected]).toEqual([3, 4, 11, 38, 16]);
    expect(byId.feeder_3_0).toMatchObject({ expected: 872, unit: 'LF', not_counted: true });
    expect(expected.reference_estimate).toMatchObject({ informational: true, total_labor_hours: 798.9, selling_price: 79112.23 });
  });
  it('rejects a malformed file', () => {
    expect(() => validateExpectedFile({ bid: {}, items: [{ id: 'a', expected: 1 }] })).toThrow(/needs types, match or category/);
    expect(() => validateExpectedFile({ bid: {}, items: [{ id: 'a', expected: 1, types: ['A'] }, { id: 'a', expected: 2, types: ['B'] }] })).toThrow(/duplicate/);
  });
});

describe('diffAgainstExpected', () => {
  const expected = validateExpectedFile(JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'))) as ExpectedFile;
  const diff = diffAgainstExpected(expected, kissimmeeCountResult());
  const row = (id: string) => diff.rows.find(r => r.id === id)!;

  it('per-type and summed items pass when the counts match', () => {
    expect(row('type_A')).toMatchObject({ actual: 73, delta: 0, verdict: 'pass', matchedTypes: ['A'] });
    expect(row('linear_led_total')).toMatchObject({ actual: 133, verdict: 'pass' });
    expect(row('downlights')).toMatchObject({ actual: 11, verdict: 'pass' });
    expect(row('site_poles')).toMatchObject({ actual: 3, verdict: 'pass', matchedTypes: ['S1', 'S2'] });
    expect(row('site_heads')).toMatchObject({ actual: 4, verdict: 'pass' });
    expect(row('gfci')).toMatchObject({ actual: 16, verdict: 'pass' });
    expect(row('rtu_connections')).toMatchObject({ actual: 2, verdict: 'pass' });
  });
  it('disputed items are reported with their delta, never pass/fail', () => {
    expect(row('exit_emergency')).toMatchObject({ expected: 22, actual: 24, delta: 2, verdict: 'reported' });
    expect(row('wall_packs')).toMatchObject({ expected: 9, actual: 7, delta: -2, verdict: 'reported' });
    expect(row('retail_power_poles')).toMatchObject({ actual: null, verdict: 'reported' });
  });
  it('a miss fails; an item no type matches fails as no_match; not_counted is reported', () => {
    expect(row('receptacles_total')).toMatchObject({ expected: 38, actual: 35, delta: -3, verdict: 'fail' });
    expect(row('battery_chargers')).toMatchObject({ actual: null, verdict: 'no_match' });
    expect(row('feeder_3_0').verdict).toBe('reported');
    expect(diff.failed).toBe(3); // receptacles, battery chargers, baseflex
  });
  it('lists counted types no expected item covers', () => {
    expect(diff.uncoveredTypes.map(t => t.type)).toEqual(['OS']);
  });
  it('renders a readable table', () => {
    const t = formatDiffTable(diff);
    expect(t).toContain('Linear LED total (A+B+M+C)                  133     133       0  pass');
    expect(t).toMatch(/\d+ pass · 3 fail · \d+ reported/);
  });
  it('a run with no count_result fails every countable item', () => {
    const d = diffAgainstExpected(expected, null);
    expect(d.passed).toBe(0);
  });
});

describe('usageCost', () => {
  it('prices input, output and cache tokens at the model\'s list price', () => {
    expect(usageCost({ input_tokens: 1_000_000, output_tokens: 100_000 }, 'claude-opus-5-5')).toBeCloseTo(4 + 2, 9);
    expect(usageCost({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }, 'claude-opus-5-5')).toBeCloseTo(0.4 + 5, 9);
    expect(usageCost({ input_tokens: 10 }, 'unknown-model')).toBeNull();
  });
});

describe('scripts/evalTakeoff.ts — DRY RUN only (no --confirm-live-api)', () => {
  it('validates the inputs and exits without sending anything', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/evalTakeoff.ts', '--pdf', 'src/test/fixtures/takeoff/kissimmee-mini.pdf', '--expected', 'eval/autozone-10077-kissimmee.expected.json'],
      { cwd: path.join(__dirname, '../..'), env: { ...process.env, ANTHROPIC_API_KEY: '' } }).toString();
    expect(out).toContain('Eval: AutoZone #10077 — Kissimmee FL (Summit GC)');
    expect(out).toContain('PDF: kissimmee-mini.pdf');
    expect(out).toContain('DRY RUN — nothing was sent.');
  }, 60_000);
});
