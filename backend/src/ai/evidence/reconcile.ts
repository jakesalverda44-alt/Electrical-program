// Evidence round 4.2 — reconciliation: independent second sources checked
// against the merged counts. Each mismatch is ONE diff item showing both
// sides with evidence; a real numeric shortfall (a second source says MORE
// than the merge found) is what 4.4's gap-fill searches for. Pure.
//
// Sources checked, per the plan:
//   (a) a fixture-schedule row with an explicit QTY column vs the type's (or
//       its whole catalog family's) counted total — e.g. Kissimmee's
//       LUMINAIRE SCHEDULE says QTY 4 for the DSX1 site light; the plans (S1
//       + S2, family-merged with the untagged photometric/E-7/E-3 rows)
//       account for 3.
//   (b) a panel circuit description naming a DEVICE (not an equipment-
//       schedule type — 3.2 already owns those) with a multiplier ("(5)")
//       greater than the drawn count.
//   (c) per-circuit lighting load vs fixtures — already computed in
//       countMerge's LoadCheck; it has no per-type resolution (no
//       circuit-to-fixture-type link exists), so it stays informational,
//       never a gap-fill trigger.
//   (d) typical host counts vs unit/pole counts — already 2.2's own
//       `typical:` blocking review item; not duplicated here.
// One more, narrowly scoped and clearly not a numeric mismatch: a GFCI-
// family device counted only by vision on a sheet with no text layer is a
// documented undercount risk (the Kissimmee baseline itself: 11 counted vs
// 16 audited) — one confirmatory gap-fill pass, always, regardless of any
// schedule number (there usually isn't one for a symbol-only device).
import type { TypeCountResult } from '../countMerge';
import type { CountTarget } from '../countTargets';
import { multiplierOf, panelCircuitRows, rowNamesTarget, type ScheduleTable } from './schedules';

export type ReconcileKind = 'schedule_qty' | 'circuit_desc' | 'gfci_confirm';

export interface ReconcileFinding {
  /** A single type key, or several joined with "+" when one schedule/row
   *  describes a whole catalog family (several primaries). */
  typeKey: string;
  kind: ReconcileKind;
  source: string;
  /** The second source's own number; null when only "there may be more" is
   *  known (the gfci_confirm case). */
  expected: number | null;
  actual: number;
  shortfall: number | null;
  reason: string;
}

const QTY_COL_RE = /^QTY\.?$|^QUANTITY$/i;
/** GFCI or GFI, as a tag or inside a description ("WEATHERPROOF DUPLEX
 *  RECPT.(GFI)"), never matching a longer unrelated word. */
const GFCI_RE = /\bGFC?I\b/i;

function activeTypes(types: TypeCountResult[]): TypeCountResult[] {
  return types.filter(t => !t.host && t.status !== 'merged');
}

/** (a) — schedule QTY vs the plans' count, summed across every type the row
 *  names (a family's several primaries can share one untagged row). */
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
      const actual = matches.reduce((s, t) => s + t.count, 0);
      if (actual >= qty) continue;
      out.push({
        typeKey: matches.map(m => m.key).join('+'),
        kind: 'schedule_qty',
        source: `${table.title} (${table.sheetLabel})`,
        expected: qty,
        actual,
        shortfall: qty - actual,
        reason: `${table.title} lists QTY ${qty}; the plans account for ${actual} (${matches.map(m => m.type).join(', ')}).`,
      });
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
    if (implied <= drawn) continue;
    const { table } = matches[0];
    out.push({
      typeKey: t.key,
      kind: 'circuit_desc',
      source: `${table.title} (${table.sheetLabel}), ${matches.length} circuit${matches.length === 1 ? '' : 's'}`,
      expected: implied,
      actual: drawn,
      shortfall: implied - drawn,
      reason: `${matches.length} panel circuit${matches.length === 1 ? '' : 's'} name "${tgt.type}" (implying ${implied}); the plans show ${drawn}.`,
    });
  }
  return out;
}

/** (e) — a GFCI-family device counted only by vision on a raster (no text
 *  layer) sheet: one confirmatory gap-fill pass, not tied to any number. */
export function gfciConfirmFindings(types: TypeCountResult[], rasterSheetKeys: ReadonlySet<string>): ReconcileFinding[] {
  const out: ReconcileFinding[] = [];
  if (!rasterSheetKeys.size) return out;
  for (const t of activeTypes(types)) {
    if (t.status !== 'counted' || t.count <= 0) continue;
    if ((t.scheduleRows?.length ?? 0) > 0) continue;
    if (!GFCI_RE.test(`${t.type} ${t.description}`)) continue;
    const usedRaster = t.sheets.filter(s => s.used && rasterSheetKeys.has(s.sheetKey));
    if (!usedRaster.length) continue;
    out.push({
      typeKey: t.key,
      kind: 'gfci_confirm',
      source: usedRaster.map(s => s.label).join(', '),
      expected: null,
      actual: t.count,
      shortfall: null,
      reason: 'GFCI-family device counted only by vision on a sheet with no text layer — a known undercount risk; one confirmatory gap-fill pass.',
    });
  }
  return out;
}

export function reconcile(
  types: TypeCountResult[],
  targets: CountTarget[],
  tables: ScheduleTable[],
  rasterSheetKeys: ReadonlySet<string>,
): ReconcileFinding[] {
  return [
    ...scheduleQtyFindings(types, targets, tables),
    ...circuitDescFindings(types, targets, tables),
    ...gfciConfirmFindings(types, rasterSheetKeys),
  ];
}
