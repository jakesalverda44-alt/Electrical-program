// Accuracy round C6 — feeder estimates → takeoff rows. Pure.
//   * An edge resolved at a confirmed or suggested scale → a conduit row
//     "Feeder — <from> → <to>: <conduit>" plus one row per conductor size,
//     confidence APPROX, the math + tier as evidence ("suggested — confirm").
//     Interior/roof → EMT of the stated size; underground/site (service
//     laterals) → the PVC underground items, in Site / Underground /
//     Allowances. Every part must resolve in the library (all-or-nothing),
//     otherwise the edge stays a hold.
//   * An unresolved edge keeps today's 0-qty "MEASURE FEEDER" rows, with the
//     specific missing piece in the evidence ("needs: XFMR location; …").
//   * A typed qty on an old "MEASURE FEEDER — …" conduit line of the same
//     feeder carries over to the new conduit row (carryOverride); the wire
//     rows follow it (route × conductors).
//   * An estimator's own feeder line (typed / measured / manual) of the same
//     feeder identity still wins — handled in wiringScopes (source 1).
import { FEEDER_CATEGORY, type GeneratedTakeoffRow } from './footageAllowance';
import { feederIdentity, sameFeeder, type ExistingLineLike } from './wiringScopes';
import type { FeederEstimate } from './feederEstimate';
import { normalizeNode } from './feederGraph';

export const SITE_CATEGORY = 'Site / Underground / Allowances';
export const FEEDER_ESTIMATE_NOTE_PREFIX = 'Replaced by the feeder estimate';

export interface FeederRowsOptions {
  /** true = a bid still being estimated / a calibration job: estimated
   *  lengths are priced. false = today's 0-qty MEASURE rows only. */
  priced: boolean;
  /** Does this exact library name resolve (item or alias)? */
  resolveName: (name: string) => boolean;
  existing: ExistingLineLike[];
}

function keyItem(key: string | null | undefined): string {
  const k = key ?? '';
  const i = k.indexOf('||');
  return (i >= 0 ? k.slice(i + 2) : k).replace(/::\d+$/, '');
}
const isOverride = (l: ExistingLineLike) => !l.excluded && Number(l.qty) > 0 && (!!l.qty_overridden || l.qty_source === 'markup');

export function racewayNames(conduit: string, underground: boolean): string[] {
  return underground
    ? [`${conduit} PVC Sch 40, underground (incl. fittings/glue)`, `${conduit} PVC Sch 40 (incl. fittings/glue)`]
    : [`${conduit} EMT (incl. couplings/straps)`];
}
export const wireName = (size: string) => `#${size} THHN/THWN copper conductor`;

/** The id a feeder's generated rows carry (`feeder.id`). */
export function edgeRowId(e: FeederEstimate): string {
  return `${e.edge.spec?.key ?? '?'}|${e.edge.from}>${e.edge.to}`;
}
/** Fix round S4 — the estimates whose rows were actually emitted as PRICED rows (a `feeder.estimate` row). */
export function pricedEstimates(rows: GeneratedTakeoffRow[], estimates: FeederEstimate[]): FeederEstimate[] {
  const ids = new Set(rows.filter(r => r.feeder?.estimate).map(r => r.feeder!.id));
  return estimates.filter(e => ids.has(edgeRowId(e)));
}

function edgeNames(e: FeederEstimate): string[] {
  return feederIdentity(`${e.edge.from} ${e.edge.to}`).names;
}

function isResolved(est: FeederEstimate, opts: FeederRowsOptions): boolean {
  const { edge, route } = est;
  if (!(route.status === 'estimated' && (route.tier === 'confirmed' || route.tier === 'suggested') && edge.spec && route.quantities && route.lengthFt != null)) return false;
  if (!opts.priced) return false;
  const conduitOk = !!edge.spec.conduit && racewayNames(edge.spec.conduit, route.underground).some(n => opts.resolveName(n));
  return conduitOk && edge.spec.conductors.every(c => opts.resolveName(wireName(c.size)));
}

/** Today's MEASURE FEEDER rows (collectFeeders, one set per spec with every
 *  destination) and the estimated edges, reconciled:
 *   * a MEASURE set whose edges ALL resolved → replaced by the edges' rows
 *     (a typed qty on it carries over);
 *   * a MEASURE set with any edge unresolved → kept exactly as today (same
 *     item, so a typed qty survives), its evidence naming what is missing
 *     and the lengths found so far — nothing of that set is priced;
 *   * an edge no MEASURE set covers → its own rows (priced when resolved,
 *     a new MEASURE set when not). */
export function feederEstimateRows(estimates: FeederEstimate[], todayRows: GeneratedTakeoffRow[], opts: FeederRowsOptions): GeneratedTakeoffRow[] {
  const out: GeneratedTakeoffRow[] = [];
  const groups = new Map<string, GeneratedTakeoffRow[]>();
  for (const r of todayRows) if (r.feeder) groups.set(r.feeder.id, [...(groups.get(r.feeder.id) ?? []), r]);
  const covered = new Set<FeederEstimate>();
  for (const [, rows] of groups) {
    const meta = rows[0].feeder!;
    const nodes = meta.names.map(n => normalizeNode(n, { asPanel: true })).filter((n): n is string => !!n);
    const mine = estimates.filter(e => e.edge.spec?.key === meta.spec && (!nodes.length || nodes.includes(e.edge.to) || nodes.includes(e.edge.from)));
    mine.forEach(e => covered.add(e));
    if (mine.length && mine.every(e => isResolved(e, opts))) {
      // A typed / measured qty on this set's conduit line carries over,
      // shared across its runs in proportion to their estimated lengths.
      const conduitRow = rows.find(r => r.feeder!.part === 'conduit');
      const old = conduitRow ? opts.existing.find(l => isOverride(l) && keyItem(l.takeoff_key) === conduitRow.item) : undefined;
      const carry = new Map<FeederEstimate, Carry>();
      if (old) {
        const total = mine.reduce((t, e) => t + e.route.quantities!.conduitFt, 0);
        for (const e of mine) carry.set(e, { qty: Math.round(Number(old.qty) * (total > 0 ? e.route.quantities!.conduitFt / total : 1 / mine.length) * 100) / 100, from: old.description, source: old.qty_source === 'markup' ? 'markup' : 'manual', shared: mine.length > 1 ? Number(old.qty) : null });
      }
      out.push(...edgeRows(mine, opts, carry));
      continue;
    }
    const needs = mine.flatMap(e => (isResolved(e, opts) ? [`${e.edge.id} estimated ${e.route.lengthFt} ft (${e.route.tier}) — not priced until every run of this set is located`] : [`${e.edge.id}: ${e.route.holds.join('; ') || 'not estimated'}`]));
    for (const r of rows) out.push(needs.length ? { ...r, evidence: `${r.evidence} Feeder estimate — ${needs.join(' | ')}.` } : r);
  }
  out.push(...edgeRows(estimates.filter(e => !covered.has(e)), opts));
  return out;
}

interface Carry { qty: number; from: string; source: 'manual' | 'markup'; shared: number | null }

function edgeRows(estimates: FeederEstimate[], opts: FeederRowsOptions, carry: Map<FeederEstimate, Carry> = new Map()): GeneratedTakeoffRow[] {
  const rows: GeneratedTakeoffRow[] = [];
  for (const est of estimates) {
    const { edge, route } = est;
    const spec = edge.spec;
    const label = `${edge.from} → ${edge.to}`;
    const names = edgeNames(est);
    const id = edgeRowId(est);
    const resolved = route.status === 'estimated' && (route.tier === 'confirmed' || route.tier === 'suggested') && !!spec && !!route.quantities && route.lengthFt != null;
    const underground = route.underground;
    const conduitName = spec?.conduit ? racewayNames(spec.conduit, underground).find(n => opts.resolveName(n)) ?? null : null;
    const missingParts: string[] = [];
    if (spec && !conduitName) missingParts.push(`library item for ${spec.conduit ?? '?'} ${underground ? 'PVC underground' : 'EMT'}`);
    for (const c of spec?.conductors ?? []) if (!opts.resolveName(wireName(c.size))) missingParts.push(`library item for #${c.size} wire`);
    if (resolved && opts.priced && !missingParts.length) {
      const category = underground ? SITE_CATEGORY : FEEDER_CATEGORY;
      const tierText = route.tier === 'confirmed' ? 'confirmed scale' : 'suggested — confirm';
      const old = carry.get(est);
      const conduitItem = `Feeder — ${label}: ${spec!.conduit} ${underground ? 'PVC' : 'EMT'}${spec!.sets > 1 ? ` ×${spec!.sets}` : ''}`;
      const q = route.quantities!;
      const runFt = old ? Math.round((old.qty / spec!.sets) * 100) / 100 : route.lengthFt!;
      rows.push({
        feeder: { id, spec: spec!.key, names, part: 'conduit', count: spec!.sets, estimate: { lengthFt: route.lengthFt!, tier: route.tier! } },
        category, item: conduitItem, spec: conduitName!,
        qty: old ? old.qty : q.conduitFt, unit: 'LF', confidence: 'APPROX',
        evidence: old
          ? `Your typed ${old.shared ?? old.qty} ft on "${old.from}" (the measure line of this feeder)${old.shared != null ? `, shared across its runs by their estimated lengths = ${old.qty} ft here` : ''} carries over. The estimate was: ${route.math}`
          : `Feeder length estimate (${tierText}): ${route.math}`,
        ...(old ? { carryOverride: true, carrySource: old.source } : {}),
      });
      for (const c of spec!.conductors) {
        const ft = Math.round(runFt * c.count * 100) / 100;
        rows.push({
          feeder: { id, spec: spec!.key, names, part: 'wire', count: c.count, estimate: { lengthFt: route.lengthFt!, tier: route.tier! } },
          category, item: `Feeder — ${label}: #${c.size}${c.ground ? ' ground' : ''} wire (${c.count} per run)`, spec: wireName(c.size),
          qty: ft, unit: 'LF', confidence: 'APPROX',
          evidence: `${runFt} ft of route × ${c.count} conductors = ${ft} ft (${tierText}). ${old ? 'From your typed run.' : route.math}`,
        });
      }
      continue;
    }
    // Hold: today's 0-qty MEASURE rows, with what is missing.
    const needs = [
      ...route.holds,
      ...(resolved && !opts.priced ? ['this bid is not in estimating (not due and not a calibration job) — length shown only'] : []),
      ...missingParts.map(p => `needs: ${p}`),
    ];
    const wires = (spec?.conductors ?? []).map(c => `${c.count}#${c.size}${c.ground ? 'G' : ''}`).join(' + ');
    const shown = resolved && route.lengthFt != null ? ` Estimated ${route.lengthFt} ft (${route.tier}) — not priced: ${route.math}` : '';
    rows.push({
      feeder: { id, spec: spec?.key ?? '?', names, part: 'conduit', count: spec?.sets ?? 1 },
      category: FEEDER_CATEGORY,
      item: `MEASURE FEEDER — ${spec?.conduit ?? '?'} conduit${(spec?.sets ?? 1) > 1 ? ` ×${spec!.sets} (parallel sets)` : ''}, ${wires || 'size not stated'} — ${label}`,
      spec: spec?.conduit ? `${spec.conduit} EMT (incl. couplings/straps)` : 'EMT (incl. couplings/straps)',
      qty: 0, unit: 'LF', confidence: 'APPROX',
      evidence: `Feeder ${label}: ${needs.join('; ') || 'not estimated'}. Measure the run on the Plans view or type the length.${shown} Source: "${edge.quotes[0] ?? ''}".`,
    });
    for (const c of spec?.conductors ?? []) {
      rows.push({
        feeder: { id, spec: spec!.key, names, part: 'wire', count: c.count },
        category: FEEDER_CATEGORY, item: `MEASURE FEEDER — #${c.size}${c.ground ? ' ground' : ''} wire (${c.count} per run) — ${label}`,
        spec: wireName(c.size), qty: 0, unit: 'LF', confidence: 'APPROX',
        evidence: `Enter conductor-ft = measured route × ${c.count}. Feeder ${label}.`,
      });
    }
  }
  return rows;
}

/** Agent 2's own RUN / LOT / LS / EA feeder rows of an estimated feeder
 *  become visible notes (never priced): "replaced by the feeder estimate". */
export function noteReplacedFeederRows<T extends { category: string; item: string; spec?: string | null; qty: number | string; unit: string; evidence?: string | null; note?: string | null }>(
  takeoff: T[], estimates: FeederEstimate[], parse: (text: string) => { key: string } | null,
): T[] {
  const priced = estimates.filter(e => e.route.status === 'estimated');
  if (!priced.length) return takeoff;
  return takeoff.map(r => {
    const unit = String(r.unit ?? '').toUpperCase();
    if (unit === 'LF' || unit === 'FT') return r;
    const text = `${r.item} ${r.spec ?? ''}`;
    const spec = parse(text);
    if (!spec || !/feeder|service conductors?|service lateral/i.test(text)) return r;
    const id = feederIdentity(text);
    const hits = priced.filter(e => (id.names.length ? sameFeeder(id, { spec: e.edge.spec?.key ?? null, names: edgeNames(e) }) : e.edge.spec?.key === spec.key));
    if (!hits.length) return r;
    return { ...r, note: 'feeder_estimate', evidence: `${FEEDER_ESTIMATE_NOTE_PREFIX} ${hits.map(h => h.edge.id).join(', ')} — not priced, so the run is never counted twice.` };
  });
}

// ── Gap-closing T4 (b) — the wireway → disconnect taps ──────────────────────
/** A tap is a short nipple from the wireway into the switch; Chris carries the conductors' landing as Polaris taps
 *  (Kissimmee: 8 × 1.2 h, $45). Stated, not measured. */
export const TAP_FT = 5;
export interface TapLike { from: string; to: string; quote: string; spec?: { key: string; conduit: string | null; conductors: Array<{ count: number; size: string; ground: boolean }>; sets: number } | null; specQuote?: string | null }
export type TapRow = Omit<GeneratedTakeoffRow, 'unit'> & { unit: 'LF' | 'EA'; libraryCode?: string; holdReason?: string };

export function feederTapRows(taps: TapLike[], opts: Pick<FeederRowsOptions, 'resolveName'>): TapRow[] {
  const rows: TapRow[] = [];
  let polaris = 0;
  const landed: string[] = [];
  for (const t of taps) {
    const label = `${t.from} → ${t.to}`;
    const spec = t.spec;
    const conduitName = spec?.conduit ? racewayNames(spec.conduit, false).find(n => opts.resolveName(n)) ?? null : null;
    const wiresOk = !!spec && spec.conductors.every(c => opts.resolveName(wireName(c.size)));
    if (!spec || !conduitName || !wiresOk) {
      rows.push({
        category: FEEDER_CATEGORY, item: `Tap — ${label}`, spec: 'NEEDS SIZE — feeder tap', qty: 1, unit: 'EA', confidence: 'APPROX', holdReason: 'needs_size',
        evidence: `Feeder tap ${label} ("${t.quote}") — needs size: ${spec ? 'a library item for its conduit / wire' : 'no service conductor spec is stated'}; pick the size.`,
      });
      continue;
    }
    const wires = spec.conductors.map(c => `#${c.size}${c.ground ? ' G' : ''} ×${c.count}`).join(' + ');
    rows.push({
      category: FEEDER_CATEGORY, item: `Tap — ${label}: ${spec.conduit} EMT nipple`, spec: conduitName, qty: TAP_FT, unit: 'LF', confidence: 'APPROX',
      evidence: `Tap ${label} — ${wires} @ ~${TAP_FT} ft + ${spec.conduit} nipple (stated, not measured: the wireway sits beside the switch). One set of the service conductors: "${t.specQuote ?? ''}". Tap: "${t.quote}".`,
    });
    for (const c of spec.conductors) {
      rows.push({
        category: FEEDER_CATEGORY, item: `Tap — ${label}: #${c.size}${c.ground ? ' ground' : ''} wire (${c.count} per tap)`, spec: wireName(c.size),
        qty: c.count * TAP_FT, unit: 'LF', confidence: 'APPROX', evidence: `${c.count} conductors × ~${TAP_FT} ft (tap ${label}).`,
      });
      if (!c.ground) polaris += c.count;
    }
    landed.push(`${label} ${spec.conductors.filter(c => !c.ground).map(c => `${c.count} × #${c.size}`).join(' + ')}`);
  }
  if (polaris > 0) {
    rows.push({
      category: FEEDER_CATEGORY, item: `Polaris taps — ${polaris}`, spec: 'Polaris tap connector (Chris BOM)', qty: polaris, unit: 'EA', confidence: 'APPROX', libraryCode: 'TAP-POLARIS',
      evidence: `Polaris taps = the tapped phase + neutral conductors: ${landed.join('; ')} = ${polaris} (Chris carries Polaris taps 1.2 h + $45 each; Kissimmee 8 × 1.2 = 9.6 h).`,
    });
  }
  return rows;
}

// ── Gap-closing T4 (c) — the underground PVC labor adjustment (J4: setting, default 0) ──
export function undergroundAdjustmentRow(rows: Array<{ category: string; item: string; spec?: string | null; qty: number | string; unit: string; excluded?: boolean }>, pct: number, laborPerFtOf: (name: string) => number | null): TapRow | null {
  if (!(pct > 0)) return null;
  const parts: string[] = [];
  let hours = 0;
  for (const r of rows) {
    if (r.excluded || String(r.unit).toUpperCase() !== 'LF' || !(Number(r.qty) > 0)) continue;
    const name = String(r.spec ?? '');
    if (!/\bPVC\b/i.test(name) || !(/underground/i.test(name) || /site|underground/i.test(r.category))) continue;
    const per = laborPerFtOf(name);
    if (per == null) continue;
    hours += Number(r.qty) * per;
    parts.push(`${r.qty} ft × ${per.toFixed(4)} h/ft (${name})`);
  }
  if (!parts.length) return null;
  const adj = Math.round(hours * (pct / 100) * 100) / 100;
  return {
    category: SITE_CATEGORY, item: `Underground PVC labor adjustment +${pct}% (setting)`, spec: 'Labor adjustment — 1 EA = 1 h', qty: adj, unit: 'EA', confidence: 'APPROX', libraryCode: 'ADJ-UG-HR',
    evidence: `est_feeder_estimate.undergroundLaborAdjPct = ${pct}%: (${parts.join(' + ')}) = ${Math.round(hours * 100) / 100} h × ${pct}% = ${adj} h (Chris: +25% Kissimmee, +5% Orlando, 0 North Port / Rockledge — Q12).`,
  };
}
