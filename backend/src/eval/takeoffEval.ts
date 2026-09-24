// Takeoff accuracy, Task 10 — the eval harness's pure half: compare a run's
// count_result to an expected-counts file, and price the run's token usage.
// scripts/evalTakeoff.ts is the I/O half (runs the real pipeline — only ever
// by the main session, with Jake's OK).
//
// Expected-file items are matched against the run's counted TYPES:
//   types:    exact type tags to sum ("A", or ["E","F","K","J"])
//   match:    case-insensitive regex over "<type> <description>" to sum
//             (legend / equipment identities aren't known in advance)
//   category + measure: e.g. site_lighting poles / heads
// An item marked `disputed` (the audit and the estimator disagree) or
// `not_counted` (e.g. feeder footage — Phase B measures it) is REPORTED,
// never pass/fail.
import type { CountResult } from '../ai/countingStage';

export interface ExpectedItem {
  id: string;
  label: string;
  expected: number;
  unit?: string;
  types?: string[];
  match?: string;
  category?: string;
  measure?: 'count' | 'poles' | 'heads';
  /** Allowed absolute difference (default 0). */
  tolerance?: number;
  disputed?: boolean;
  not_counted?: boolean;
  note?: string;
}

export interface ExpectedFile {
  project: string;
  bid: { name: string; gc: string; loc: string; brand?: string; project_type?: string };
  items: ExpectedItem[];
  reference_estimate?: Record<string, unknown>;
  notes?: string[];
}

export type RowVerdict = 'pass' | 'fail' | 'reported' | 'no_match';

export interface DiffRow {
  id: string;
  label: string;
  expected: number;
  actual: number | null;
  delta: number | null;
  verdict: RowVerdict;
  matchedTypes: string[];
  note?: string;
}

export interface EvalDiff {
  rows: DiffRow[];
  passed: number;
  failed: number;
  reported: number;
  /** Types the run counted that no expected item covers (for review). */
  uncoveredTypes: Array<{ type: string; description: string; count: number; status: string }>;
}

export function validateExpectedFile(raw: unknown): ExpectedFile {
  const f = raw as ExpectedFile;
  if (!f || typeof f !== 'object' || !Array.isArray(f.items) || !f.bid) throw new Error('expected file: needs "bid" and "items"');
  const ids = new Set<string>();
  for (const it of f.items) {
    if (!it.id || ids.has(it.id)) throw new Error(`expected file: missing or duplicate item id "${it.id}"`);
    ids.add(it.id);
    if (!Number.isFinite(it.expected)) throw new Error(`expected file: item ${it.id} has no numeric "expected"`);
    if (!it.not_counted && !it.types && !it.match && !it.category) throw new Error(`expected file: item ${it.id} needs types, match or category`);
    if (it.match) new RegExp(it.match, 'i'); // throws on a bad pattern
  }
  return f;
}

export function diffAgainstExpected(expected: ExpectedFile, countResult: CountResult | null): EvalDiff {
  const types = countResult?.types ?? [];
  const covered = new Set<string>();
  const rows: DiffRow[] = expected.items.map(item => {
    const base = { id: item.id, label: item.label, expected: item.expected, ...(item.note ? { note: item.note } : {}) };
    if (item.not_counted) {
      return { ...base, actual: null, delta: null, verdict: 'reported' as const, matchedTypes: [] };
    }
    const re = item.match ? new RegExp(item.match, 'i') : null;
    const wanted = new Set((item.types ?? []).map(t => t.toUpperCase()));
    const hits = types.filter(t =>
      (wanted.size ? wanted.has(t.key.toUpperCase()) : true)
      && (re ? re.test(`${t.type} ${t.description}`) : true)
      && (item.category ? t.category === item.category : true)
      && (wanted.size > 0 || re !== null || item.category !== undefined));
    hits.forEach(t => covered.add(t.key));
    if (!hits.length) return { ...base, actual: null, delta: null, verdict: (item.disputed ? 'reported' : 'no_match') as RowVerdict, matchedTypes: [] };
    const measure = item.measure ?? 'count';
    const actual = hits.reduce((s, t) => s + (measure === 'heads' ? (t.heads ?? 0) : t.count), 0);
    const delta = actual - item.expected;
    const verdict: RowVerdict = item.disputed ? 'reported' : Math.abs(delta) <= (item.tolerance ?? 0) ? 'pass' : 'fail';
    return { ...base, actual, delta, verdict, matchedTypes: hits.map(t => t.type) };
  });
  return {
    rows,
    passed: rows.filter(r => r.verdict === 'pass').length,
    failed: rows.filter(r => r.verdict === 'fail' || r.verdict === 'no_match').length,
    reported: rows.filter(r => r.verdict === 'reported').length,
    uncoveredTypes: types.filter(t => !covered.has(t.key)).map(t => ({ type: t.type, description: t.description, count: t.count, status: t.status })),
  };
}

// ── Cost ────────────────────────────────────────────────────────────────────

/** $ per million tokens [input, output] — Anthropic list prices (claude-api
 *  skill, cached 2026-06-24). Cache writes bill at 1.25x input, reads 0.1x. */
export const MODEL_PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'claude-haiku-4-5-20251001': [1, 5],
};

export interface UsageLike { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }

export function usageCost(usage: UsageLike | null | undefined, model: string | null | undefined): number | null {
  if (!usage || !model) return null;
  const p = MODEL_PRICES[model];
  if (!p) return null;
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  return (inTok * p[0] + cw * p[0] * 1.25 + cr * p[0] * 0.1 + outTok * p[1]) / 1_000_000;
}

export function formatDiffTable(diff: EvalDiff): string {
  const lines = ['ITEM                                   EXPECTED  ACTUAL   DELTA  VERDICT   TYPES'];
  for (const r of diff.rows) {
    lines.push(
      `${r.label.padEnd(38).slice(0, 38)} ${String(r.expected).padStart(8)}  ${String(r.actual ?? '—').padStart(6)}  ${String(r.delta == null ? '—' : (r.delta > 0 ? `+${r.delta}` : r.delta)).padStart(6)}  ${r.verdict.padEnd(8)}  ${r.matchedTypes.join(',')}${r.note ? `   (${r.note})` : ''}`,
    );
  }
  lines.push(`\n${diff.passed} pass · ${diff.failed} fail · ${diff.reported} reported (disputed / not counted)`);
  if (diff.uncoveredTypes.length) {
    lines.push(`Counted types not in the expected file: ${diff.uncoveredTypes.map(t => `${t.type}=${t.count}${t.status !== 'counted' ? ` (${t.status})` : ''}`).join(', ')}`);
  }
  return lines.join('\n');
}

// ── Database choice (fix round 1 / S16) ─────────────────────────────────────

export const EVAL_DEFAULT_DB = 'electrical_crm_test';
const LIVE_DB = 'electrical_crm';

/** Which database the eval may use: --db wins; otherwise the TEST database.
 *  The live app's database only when --db names it explicitly (DB_NAME in
 *  the environment never selects it on its own). */
export function evalDatabase(argv: string[]): { db: string } | { error: string } {
  const i = argv.indexOf('--db');
  const explicit = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && (!explicit || explicit.startsWith('--'))) return { error: '--db needs a database name' };
  const db = explicit ?? EVAL_DEFAULT_DB;
  if (db === LIVE_DB && !explicit) return { error: 'refusing the live database without --db electrical_crm' };
  return { db };
}
