// UI cleanup round 2B — display-only helpers for Labor & Pricing. Nothing here is sent to the server.
import type { AccubidAlternate, AccubidCostLine, AccubidQuote, AccubidSettings, EstimateLine, EstimateSettings, LibraryFactor } from '../types';

// Fix round 2 / N1 — clearing a rate/pct input (empty string) used to become
// Number('') = 0, a REAL zero rate/pct silently substituted for "I haven't
// decided yet" — reverts to the field's own default instead. Read eagerly
// (before setSettings' updater callback runs), same reasoning as N3's
// floors_above_2 fix: a controlled input's DOM value can be reset by React
// before a LAZY read inside the updater would see it.
export function numberOrDefault(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const round1 = (n: number) => Math.round(n * 10) / 10;

export function factorGroupLabel(key: string): string {
  switch (key) {
    case 'height': return 'Working height';
    case 'occupied': return 'Occupied building';
    case 'congested': return 'Ceiling space';
    case 'schedule': return 'Work hours';
    case 'multistory': return 'Multi-story';
    case 'access': return 'Site access';
    case 'wage': return 'Wage rate';
    default: {
      const s = key.replace(/_/g, ' ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
}

/** The closed-card summary of the picked job conditions. Mirrors the backend:
 *  Quick mode adds the pcts (pricing.ts effectiveFactorPct), Accubid mode compounds
 *  them (accubidRecap.ts compoundLaborFactorMultiplier); first factor per group wins,
 *  and the multistory pct is multiplied by the floors above 2. Display only. */
export function jobConditionsSummary(
  factorIds: string[],
  libraryFactors: LibraryFactor[] | undefined,
  floorsAbove2: number,
  mode: 'phase_a' | 'accubid',
): string {
  if (!libraryFactors) return factorIds.length ? `${factorIds.length} selected` : 'None selected';
  const byId = new Map(libraryFactors.map(f => [f.id, f]));
  const seen = new Set<string>();
  const used: LibraryFactor[] = [];
  for (const id of factorIds) {
    const f = byId.get(id);
    if (!f || seen.has(f.group_key)) continue;
    seen.add(f.group_key);
    used.push(f);
  }
  const floors = Math.max(0, Number(floorsAbove2) || 0);
  const multistoryPicked = used.some(f => f.group_key === 'multistory');
  const floorNote = ` · ${floors} ${plural(floors, 'floor')} above 2`;
  let text: string;
  if (used.length === 0) {
    text = 'None selected';
  } else {
    const pcts = used.map(f => (f.group_key === 'multistory' ? f.pct * floors : f.pct));
    const total = mode === 'accubid'
      ? (pcts.reduce((m, p) => m * (1 + p / 100), 1) - 1) * 100
      : pcts.reduce((a, p) => a + p, 0);
    text = `${used.length} ${plural(used.length, 'factor')}, +${round1(total)}% labor hours${mode === 'accubid' ? ' (compounded)' : ''}`;
  }
  if (multistoryPicked) text += floors > 0 ? floorNote : ' · Multi-story needs floors above 2';
  else if (floors > 0) text += `${floorNote} (Multi-story not picked)`;
  return text;
}

export function ratesSummary(s: EstimateSettings): string {
  return `Labor $${s.labor_rate}/hr · Crew ${s.crew_size} · Overhead ${s.overhead_pct}% · Profit ${s.profit_pct}% · Tax ${s.material_tax_pct}%`;
}

/** The takeoff item text of a takeoff_key (after `||`, minus a trailing `::n`).
 *  Same stripping as FeedersPanel.keyItem and BidSummary.feederSidebarCounts. */
export function takeoffItemOf(key: string | null | undefined): string {
  const s = key ?? '';
  const i = s.indexOf('||');
  return (i >= 0 ? s.slice(i + 2) : s).replace(/::\d+$/, '');
}

/** Feeder conduit AND wire lines. */
export function isFeederLine(l: Pick<EstimateLine, 'takeoff_key'>): boolean {
  const item = takeoffItemOf(l.takeoff_key);
  return /^Feeder — /.test(item) || /^MEASURE FEEDER — /.test(item);
}

/** A line the estimator added or touched, or kept from the previous run. */
export function isChangedLine(l: Pick<EstimateLine, 'source' | 'qty_overridden' | 'qty_source' | 'material_unit_override' | 'labor_hours_override' | 'recheck_run_id'>): boolean {
  return l.source === 'manual'
    || !!l.qty_overridden
    || l.qty_source === 'manual'
    || l.material_unit_override != null
    || l.labor_hours_override != null
    || !!l.recheck_run_id;
}

export type LineFilterKey = 'all' | 'holds' | 'furnished' | 'feeders' | 'changed' | 'excluded';

export const LINE_FILTERS: { key: LineFilterKey; label: string; title: string }[] = [
  { key: 'all', label: 'All', title: 'Every line, excluded ones included' },
  { key: 'holds', label: 'Needs a price/unit', title: 'Lines with a quantity that price at $0 — the total leaves them out until they get a price or a unit.' },
  { key: 'furnished', label: 'Owner-furnished', title: 'Owner-furnished (labor only) and furnish-disputed lines' },
  { key: 'feeders', label: 'Feeders', title: 'Feeder conduit and wire lines' },
  { key: 'changed', label: 'Changed', title: 'Lines you added or edited: manual lines, typed quantities, price or hours overrides, and lines kept from the previous run' },
  { key: 'excluded', label: 'Excluded', title: 'Lines left out of the price' },
];

export interface LineFilterCtx {
  holdIds: { has(id: string): boolean };
  furnishIds: { has(id: string): boolean };
}

export function lineMatchesFilter(key: LineFilterKey, line: EstimateLine, ctx: LineFilterCtx): boolean {
  switch (key) {
    case 'holds': return !!line.id && ctx.holdIds.has(line.id);
    case 'furnished': return !!line.id && ctx.furnishIds.has(line.id);
    case 'feeders': return isFeederLine(line);
    case 'changed': return isChangedLine(line);
    case 'excluded': return !!line.excluded;
    default: return true;
  }
}

export function lineFilterCounts(lines: EstimateLine[], ctx: LineFilterCtx): Record<LineFilterKey, number> {
  const out: Record<LineFilterKey, number> = { all: lines.length, holds: 0, furnished: 0, feeders: 0, changed: 0, excluded: 0 };
  for (const l of lines) {
    for (const f of LINE_FILTERS) if (f.key !== 'all' && lineMatchesFilter(f.key, l, ctx)) out[f.key] += 1;
  }
  return out;
}

export function crewSummary(form: AccubidSettings, dirty: boolean): string {
  const jc = form.journeymanCount, ac = form.apprenticeCount, fc = form.foremanCount;
  return `${jc} journeyman, ${ac} ${plural(ac, 'apprentice')}, ${fc} ${plural(fc, 'foreman', 'foremen')} · ${form.shift === 'night' ? 'Night' : 'Day'} shift · Labor overhead ${form.laborOverheadPct}% · Markup ${form.materialMarkupPct}% material / ${form.laborMarkupPct}% labor${dirty ? ' · Not saved' : ''}`;
}

export function quotesSummary(quotes: AccubidQuote[]): string {
  if (!quotes.length) return 'None';
  const pending = quotes.filter(q => q.status === 'budget_pending').length;
  return `${quotes.length} ${plural(quotes.length, 'quote')} · ${money(quotes.reduce((a, q) => a + q.amount, 0))}${pending > 0 ? ` · ${pending} budget-pending` : ''}`;
}

export function costLinesSummary(lines: AccubidCostLine[]): string {
  if (!lines.length) return 'None';
  return `${lines.length} ${plural(lines.length, 'line')} · ${money(lines.reduce((a, l) => a + l.amount, 0))}${lines.some(l => l.preview) ? ' (default added on save)' : ''}`;
}

export function alternatesSummary(alts: AccubidAlternate[]): string {
  if (!alts.length) return 'None';
  return `${alts.filter(a => a.kind === 'add').length} add, ${alts.filter(a => a.kind === 'deduct').length} deduct`;
}

export function feedersSummary(data: { edges: unknown[]; calibration: boolean; summary: { suggested: number; holds: number } }): string {
  if (!data.edges.length) return 'None found on this job';
  const n = data.edges.length;
  let s = `${n} ${plural(n, 'feeder')}`;
  if (data.summary.suggested > 0) s += ` · ${data.summary.suggested} to confirm`;
  if (data.summary.holds > 0) s += ` · ${data.summary.holds} need a location / scale / size`;
  if (data.calibration) s += ' · Calibration job';
  return s;
}
