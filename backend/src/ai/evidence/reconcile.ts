// Evidence round 4.2 — reconciliation: independent second sources checked
// against the merged counts. Each mismatch is ONE diff item (reviewItems.ts
// turns it into a `reconcile:<type>` review item, or a `gapfill:<type>` one
// when a targeted re-search found candidates worth checking) showing both
// sides; a real UNDER-count (a second source says more than the merge
// found) is what 4.4's gap-fill searches for — never an over-count, which
// gap-fill has no way to "remove" a mark for anyway. Pure.
//
// Fix round (review a479103, B2) — two corrections from the real Kissimmee
// data:
//   * a site-lighting fixture-schedule QTY column counts LUMINAIRE HEADS,
//     never poles ("two 209W fixtures per pole" on Kissimmee's E-1 note E).
//     Comparing it to the pole count was a false alarm that could have
//     silently turned the audited 3 poles into 4 the moment a crop check
//     said "accept". `actualUnitsOf` fixes this for every site-lighting
//     type, not just S1/S2.
//   * the always-on GFCI-family "confirmatory" pass (S5) is gone. Gap-fill
//     now runs ONLY from a real reconciliation shortfall — never a bias
//     pass with no number behind it.
//
// Sources checked, per the plan:
//   (a) a fixture-schedule row with an explicit QTY column vs the type's (or
//       its whole catalog family's) counted total — e.g. Kissimmee's
//       LUMINAIRE SCHEDULE says QTY 4 for the DSX1 site light; S1 (1 head x
//       2 poles) + S2 (2 heads x 1 pole) account for 4 heads. No finding.
//   (b) a panel circuit description naming a DEVICE (not an equipment-
//       schedule type — 3.2 already owns those) with a multiplier ("(5)")
//       greater than the drawn count.
//   (c) per-circuit lighting load vs fixtures — already computed in
//       countMerge's LoadCheck; it has no per-type resolution (no
//       circuit-to-fixture-type link exists), so it stays informational,
//       never a gap-fill trigger.
//   (d) typical host counts vs unit/pole counts — already 2.2's own
//       `typical:` blocking review item; not duplicated here.
import type { TypeCountResult } from '../countMerge';
import type { CountTarget } from '../countTargets';
import { multiplierOf, panelCircuitRows, rowNamesTarget, type ScheduleTable } from './schedules';

export type ReconcileKind = 'schedule_qty' | 'circuit_desc';
export type ReconcileDirection = 'under' | 'over';

export interface ReconcileFinding {
  /** A single type key, or several joined with "+" when one schedule/row
   *  describes a whole catalog family (several primaries). */
  typeKey: string;
  kind: ReconcileKind;
  /** 'under' — the second source says more than the plans (gap-fill can
   *  search for the difference). 'over' — the plans show more than the
   *  second source; informational only, never a gap-fill trigger (there is
   *  nothing to search FOR). */
  direction: ReconcileDirection;
  source: string;
  expected: number;
  actual: number;
  /** |expected - actual|; always greater than RECONCILE_TOLERANCE. */
  diff: number;
  reason: string;
}

/** B2 — "blocking above a stated tolerance": a one-unit gap is common
 *  transcription noise (a missed row, a rounding schedule note) and is not
 *  worth a blocking item or a paid re-search on its own. */
export const RECONCILE_TOLERANCE = 1;

const QTY_COL_RE = /^QTY\.?$|^QUANTITY$/i;

function activeTypes(types: TypeCountResult[]): TypeCountResult[] {
  return types.filter(t => !t.host && t.status !== 'merged');
}

/** B2 — a site-lighting fixture-schedule QTY column counts HEADS, never
 *  poles. Every other fixture category has no pole/head distinction, so its
 *  own count already IS the unit the schedule counts. */
function actualUnitsOf(t: TypeCountResult): number {
  return t.category === 'site_lighting' ? (t.heads ?? 0) : t.count;
}

function finding(kind: ReconcileKind, typeKey: string, source: string, expected: number, actual: number, reasonOf: (diff: number, dir: ReconcileDirection) => string): ReconcileFinding | null {
  const diff = expected - actual;
  if (Math.abs(diff) <= RECONCILE_TOLERANCE) return null;
  const direction: ReconcileDirection = diff > 0 ? 'under' : 'over';
  return { typeKey, kind, direction, source, expected, actual, diff: Math.abs(diff), reason: reasonOf(Math.abs(diff), direction) };
}

/** (a) — schedule QTY vs the plans' count (heads, for site lighting), summed
 *  across every type the row names (a family's several primaries can share
 *  one untagged row). */
export function scheduleQtyFindings(types: TypeCountResult[], targets: CountTarget[], tables: ScheduleTable[]): ReconcileFinding[] {
  const out: ReconcileFinding[] = [];
  const targetByKey = new Map(targets.map(t => [t.key, t]));
  const active = activeTypes(types);
  for (const table of tables.filter(t => t.kind === 'fixture')) {
    const qtyCol = table.columns.findIndex(c => QTY_COL_RE.test(c.trim()));
    if (qtyCol < 0) continue;
    for (const row of table.rows) {
      const qty = Number((row.cells[qtyCol] ?? '').replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const rowText = row.cells.join(' ');
      const matches = active.filter(t => {
        const tgt = targetByKey.get(t.key);
        return tgt && tgt.category !== 'device' && tgt.category !== 'equipment' && rowNamesTarget(rowText, tgt);
      });
      if (!matches.length) continue;
      const isSite = matches.some(t => t.category === 'site_lighting');
      const actual = matches.reduce((s, t) => s + actualUnitsOf(t), 0);
      const unit = isSite ? 'heads' : '';
      const f = finding('schedule_qty', matches.map(m => m.key).join('+'), `${table.title} (${table.sheetLabel})`, qty, actual,
        (diff, dir) => `${table.title} lists QTY ${qty}${unit ? ` ${unit}` : ''}; the plans account for ${actual}${unit ? ` ${unit}` : ''} (${matches.map(m => m.type).join(', ')}) — ${dir === 'under' ? `${diff} short` : `${diff} over`}.`);
      if (f) out.push(f);
    }
  }
  return out;
}

/** (b) — panel circuits naming a device type (not an equipment-schedule
 *  type — 3.2 already owns those quantities from these same rows): every
 *  distinct circuit that names it counts at least 1, or its own stated
 *  multiplier ("BATT CHGR (5)"), summed the same way 3.2's scheduleCounts
 *  sums equipment rows — vs the drawn count. */
export function circuitDescFindings(types: TypeCountResult[], targets: CountTarget[], tables: ScheduleTable[]): ReconcileFinding[] {
  const out: ReconcileFinding[] = [];
  const targetByKey = new Map(targets.map(t => [t.key, t]));
  const panelRows = tables.filter(t => t.kind === 'panel').flatMap(t => panelCircuitRows(t).map(r => ({ r, table: t })));
  for (const t of activeTypes(types)) {
    if ((t.scheduleRows?.length ?? 0) > 0) continue;
    const tgt = targetByKey.get(t.key);
    if (!tgt || tgt.category !== 'device') continue;
    const drawn = t.status === 'counted' ? t.count : 0;
    const matches = panelRows.filter(({ r }) => !r.continuation && r.description && rowNamesTarget(r.description, tgt));
    if (!matches.length) continue;
    const implied = matches.reduce((s, { r }) => s + (multiplierOf(r.description) ?? 1), 0);
    const { table } = matches[0];
    const f = finding('circuit_desc', t.key, `${table.title} (${table.sheetLabel}), ${matches.length} circuit${matches.length === 1 ? '' : 's'}`, implied, drawn,
      (diff, dir) => `${matches.length} panel circuit${matches.length === 1 ? '' : 's'} name "${tgt.type}" (implying ${implied}); the plans show ${drawn} — ${dir === 'under' ? `${diff} short` : `${diff} over`}.`);
    if (f) out.push(f);
  }
  return out;
}

export function reconcile(types: TypeCountResult[], targets: CountTarget[], tables: ScheduleTable[]): ReconcileFinding[] {
  return [...scheduleQtyFindings(types, targets, tables), ...circuitDescFindings(types, targets, tables)];
}
