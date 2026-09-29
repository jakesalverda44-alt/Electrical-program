// Remodel + footage round, B4 — default Equipment and General Expenses lines
// for an Accubid-mode bid that has none, from a rule fitted to Chris's own
// breakdowns (calibration-data/*Breakdown.pdf, "Equipment" / "General
// Expenses" sections, net of tax, vs Total Labor Hours).
//
// Fitted on the 2025–26 breakdowns only (pricingWindow — Jake's rule); the
// 2024 ones stay in the table for reference. What the breakdowns show:
//   Equipment = lifts and site machines (scissor lift $890-1,250, a mini
//     excavator $1,850-3,500 when there's underground work). It grows with
//     the job: ~$4 per labor hour, never less than one scissor lift ($890).
//   General expenses = permits ($270-410) on every job, plus temporary
//     power + lighting (~$2,700) on every job over ~300 hours. It does NOT
//     grow with hours past that (North Port, 1,841 h: $3,310; Rockledge,
//     1,394 h: $3,060) — a two-tier flat rule fits it far better than $/hr.
// The seeded line is editable; once the estimator edits it, it's theirs and
// is never touched again; once they delete it, it's never re-seeded.

import type { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface CostRule {
  /** Jobs at or under this many hours get smallJobAmount (0 = no small tier). */
  smallJobMaxHours: number;
  smallJobAmount: number;
  /** Above the small tier: max(minimum, perHour × hours). perHour 0 = flat minimum. */
  perHour: number;
  minimum: number;
}

export interface CostLineDefaults {
  version: 1;
  equipment: CostRule;
  generalExpenses: CostRule;
}

/** Chris's breakdowns (net of tax — North Port / Orlando / Rockledge taxed
 *  equipment at 7%, stored here before tax). 0 = he carried none. */
export interface BreakdownCostRow { job: string; date: string; hours: number; equipment: number; generalExpenses: number }
export const CHRIS_BREAKDOWNS: BreakdownCostRow[] = [
  { job: '36th Street Warehouse', date: '2024-04-09', hours: 189.21, equipment: 890, generalExpenses: 310 },
  { job: '7-11 #10319 Fort Myers', date: '2024-12-03', hours: 1420.917, equipment: 7170, generalExpenses: 2490 },
  { job: 'AutoZone Kissimmee', date: '2026-06-17', hours: 798.949, equipment: 4350, generalExpenses: 3770 },
  { job: 'Bubble Down Remodel', date: '2026-03-12', hours: 208, equipment: 3000, generalExpenses: 0 },
  { job: 'Gulf Simulator', date: '2026-07-02', hours: 323.793, equipment: 0, generalExpenses: 1220 },
  { job: 'James Co Seminole State', date: '2026-06-04', hours: 197.458, equipment: 0, generalExpenses: 270 },
  { job: 'North Port Storage', date: '2024-03-22', hours: 1841.486, equipment: 7060, generalExpenses: 3310 },
  { job: 'Orlando Clubhouse', date: '2024-04-22', hours: 606.518, equipment: 1860, generalExpenses: 3060 },
  { job: 'Rockledge Storage', date: '2024-04-11', hours: 1393.656, equipment: 4390, generalExpenses: 3060 },
  { job: 'Big Dans Temple Terrace', date: '2024-03-07', hours: 2218.8, equipment: 6230, generalExpenses: 0 },
];

export const SMALL_JOB_HOURS = 300;

/** Jake's rule: pricing defaults come from 2025–2026 jobs only (2024 jobs
 *  inform labor units, not pricing). Falls back to every breakdown — and
 *  says so — when fewer than 3 recent ones exist. */
export const PRICING_WINDOW_FROM = '2025-01-01';
export function pricingWindow(rows: BreakdownCostRow[]): { rows: BreakdownCostRow[]; fallback: boolean } {
  const recent = rows.filter(r => r.date >= PRICING_WINDOW_FROM);
  return recent.length >= 3 ? { rows: recent, fallback: false } : { rows, fallback: true };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function roundTo10(n: number): number { return Math.round(n / 10) * 10; }

/** One scissor lift from Sunbelt — the line item Chris carries on 36th
 *  Street, North Port and Rockledge ($890 each), and the smallest real
 *  equipment line in any of the breakdowns. A domain floor, not a fitted
 *  one: fitting the floor to the cheapest JOB TOTAL makes it jump to
 *  $1,860 whenever 36th Street is left out. */
export const ONE_SCISSOR_LIFT = 890;

/** Equipment: per hour (pooled over the jobs that carried any), never less
 *  than one scissor lift. */
export function fitEquipmentRule(rows: BreakdownCostRow[]): CostRule {
  const used = rows.filter(r => r.equipment > 0);
  const perHour = round2(used.reduce((s, r) => s + r.equipment, 0) / Math.max(1, used.reduce((s, r) => s + r.hours, 0)));
  return { smallJobMaxHours: 0, smallJobAmount: 0, perHour, minimum: ONE_SCISSOR_LIFT };
}

/** General expenses: two flat tiers — small jobs (permits only) vs the rest
 *  (permits + temporary power/lighting), each the median of the jobs that
 *  carried any. */
export function fitGeneralExpensesRule(rows: BreakdownCostRow[]): CostRule {
  const used = rows.filter(r => r.generalExpenses > 0);
  const small = used.filter(r => r.hours <= SMALL_JOB_HOURS).map(r => r.generalExpenses);
  const large = used.filter(r => r.hours > SMALL_JOB_HOURS).map(r => r.generalExpenses);
  return { smallJobMaxHours: SMALL_JOB_HOURS, smallJobAmount: roundTo10(median(small)), perHour: 0, minimum: roundTo10(median(large)) };
}

export function applyCostRule(rule: CostRule, hours: number): number {
  if (!(hours > 0)) return 0;
  if (rule.smallJobMaxHours > 0 && hours <= rule.smallJobMaxHours) return round2(rule.smallJobAmount);
  return round2(Math.max(rule.minimum, rule.perHour * hours));
}

export interface CostRuleLooRow { job: string; hours: number; actual: number; predicted: number; errorPct: number | null }

/** Leave-one-out over the jobs that carried the cost (a job with $0 is
 *  reported, never scored — the rule is for "when there is one"). */
export function costRuleLoo(rows: BreakdownCostRow[], kind: 'equipment' | 'generalExpenses'): { rows: CostRuleLooRow[]; mae: number } {
  const fit = kind === 'equipment' ? fitEquipmentRule : fitGeneralExpensesRule;
  const out = rows.map(held => {
    const rule = fit(rows.filter(r => r !== held));
    const predicted = applyCostRule(rule, held.hours);
    const actual = held[kind];
    return { job: held.job, hours: held.hours, actual, predicted, errorPct: actual > 0 ? ((predicted - actual) / actual) * 100 : null };
  });
  const scored = out.filter(r => r.errorPct != null).map(r => Math.abs(r.errorPct as number));
  return { rows: out, mae: scored.length ? scored.reduce((s, x) => s + x, 0) / scored.length : 0 };
}

// The rules fitted on pricingWindow(CHRIS_BREAKDOWNS) — the four 2025–26
// breakdowns (Kissimmee, Bubble Down, Gulf Simulator, Seminole) — as seeded
// by migration 151 (costLineDefaults.test.ts re-fits and fails if these
// drift from the data).
export const DEFAULT_COST_LINE_DEFAULTS: CostLineDefaults = {
  version: 1,
  equipment: { smallJobMaxHours: 0, smallJobAmount: 0, perHour: 7.3, minimum: 890 },
  generalExpenses: { smallJobMaxHours: 300, smallJobAmount: 270, perHour: 0, minimum: 2500 },
};

function num(v: unknown, f: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : f;
}
function parseRule(o: unknown, d: CostRule): CostRule {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  return { smallJobMaxHours: num(r.smallJobMaxHours, d.smallJobMaxHours), smallJobAmount: num(r.smallJobAmount, d.smallJobAmount), perHour: num(r.perHour, d.perHour), minimum: num(r.minimum, d.minimum) };
}
export function parseCostLineDefaults(raw: string | null | undefined): CostLineDefaults {
  let o: Record<string, unknown> = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  return {
    version: 1,
    equipment: parseRule(o.equipment, DEFAULT_COST_LINE_DEFAULTS.equipment),
    generalExpenses: parseRule(o.generalExpenses, DEFAULT_COST_LINE_DEFAULTS.generalExpenses),
  };
}

/** Fix round SF-4 — what PUT /api/settings accepts for est_cost_line_defaults. */
export function validateCostLineDefaultsJson(raw: unknown): string[] {
  if (typeof raw !== 'string') return ['must be a JSON string'];
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return ['is not valid JSON']; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['must be a JSON object'];
  const errs: string[] = [];
  for (const kind of ['equipment', 'generalExpenses']) {
    const r = (o as Record<string, unknown>)[kind];
    if (r === undefined) continue;
    if (!r || typeof r !== 'object') { errs.push(`${kind} must be an object`); continue; }
    for (const k of ['smallJobMaxHours', 'smallJobAmount', 'perHour', 'minimum']) {
      const v = (r as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${kind}.${k} must be a number`);
      else if (v < 0) errs.push(`${kind}.${k} must be at least 0`);
    }
  }
  return errs;
}

export const DEFAULT_LINE_DESCRIPTION = { equipment: 'Equipment — default', general_expense: 'General expenses — default' } as const;

// ── DB: seed / follow / never overwrite ──────────────────────────────────────

/** For each kind: a bid that has never had a default seeded and has no line
 *  of that kind gets one (when it has labor hours); an untouched default
 *  (auto_default) follows the rule as hours change; an estimator-edited
 *  line (auto_default false) or a deleted default is never touched again.
 *  Returns true when anything changed. */
/** Fix round BL-1 — the only bids.stage that means "still being estimated,
 *  not yet submitted" (002_create_bids: due | submitted | awarded | lost). */
export const PRE_SUBMISSION_STAGES = ['due'] as const;

export async function syncDefaultCostLines(bidId: string, hours: number, client?: PoolClient): Promise<boolean> {
  const db = client ?? pool;
  // BL-1 — a submitted / awarded / lost bid's price is never touched: no
  // seeding, no follow-the-hours, no placeholder removal.
  const { rows: bidRows } = await db.query('SELECT stage FROM bids WHERE id = $1 AND deleted_at IS NULL', [bidId]);
  if (!bidRows.length || !(PRE_SUBMISSION_STAGES as readonly string[]).includes(bidRows[0].stage)) return false;
  const { rows: settingRows } = await db.query(`SELECT value FROM app_settings WHERE key = 'est_cost_line_defaults'`);
  const rules = parseCostLineDefaults(settingRows[0]?.value as string | undefined);
  const [{ rows: lines }, { rows: seeds }] = await Promise.all([
    db.query('SELECT id, kind, amount, auto_default FROM est_bid_cost_lines WHERE bid_id = $1', [bidId]),
    db.query('SELECT kind FROM est_bid_cost_line_seeds WHERE bid_id = $1', [bidId]),
  ]);
  const seeded = new Set(seeds.map(s => s.kind as string));
  let changed = false;
  for (const kind of ['equipment', 'general_expense'] as const) {
    const rule = kind === 'equipment' ? rules.equipment : rules.generalExpenses;
    const amount = applyCostRule(rule, hours);
    const ofKind = lines.filter(l => l.kind === kind);
    const auto = ofKind.filter(l => l.auto_default);
    // The estimator added their own line of this kind: the untouched
    // default was only a placeholder for "none yet" — it goes.
    if (auto.length && ofKind.length > auto.length) {
      await db.query('DELETE FROM est_bid_cost_lines WHERE bid_id = $1 AND kind = $2 AND auto_default', [bidId, kind]);
      changed = true;
      continue;
    }
    if (auto.length) {
      for (const l of auto) {
        if (Number(l.amount) !== amount) {
          await db.query('UPDATE est_bid_cost_lines SET amount = $1, updated_at = now() WHERE id = $2 AND auto_default', [amount, l.id]);
          changed = true;
        }
      }
      continue;
    }
    if (ofKind.length || seeded.has(kind) || !(amount > 0)) continue;
    await db.query(
      `INSERT INTO est_bid_cost_lines (bid_id, kind, description, amount, tax_pct, sort, auto_default) VALUES ($1,$2,$3,$4,0,0,true)`,
      [bidId, kind, DEFAULT_LINE_DESCRIPTION[kind], amount],
    );
    await db.query(`INSERT INTO est_bid_cost_line_seeds (bid_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bidId, kind]);
    changed = true;
  }
  return changed;
}
