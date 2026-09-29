// Remodel + footage round, B2 — the branch/feeder footage allowance every
// analysis gets. Pure: no I/O. footageAllowanceDb.ts loads the inputs
// (takeoff rows, Agent 1 output, the count's mark geometry, sheet scales,
// the editable ratio settings) and hands the result to bidEstimate.ts as
// extra takeoff rows, so the lines ride the normal mapper / sync / override
// path: an estimator's typed qty (qty_overridden) and a confirmed measured
// run (apply-markups → qty_source 'markup') both survive every re-sync.
//
// Branch method v1 (ratio): conduit ft per point, calibrated on Chris's five
// BOMs (footageCalibration.ts — the ratios live in app_settings, editable),
// wire ft = conduit ft × Chris's conductor-ft-per-conduit-ft, MC whips per
// fixture, site PVC per site pole.
// Branch method v2 (geometry): per-circuit homeruns off the counted marks on
// a scaled sheet that has a panel position — Manhattan distance × ft/pt,
// plus a drop per device and the slack %. v2 is used only on a CONFIRMED
// scale (calibrated, or a title-block scale the estimator accepted — never a
// merely suggested one) with a known panel position, and only when it is
// within the configured % (default 40) of the ratio. Otherwise the ratio qty
// stays and the evidence shows "plan-geometry estimate X ft — check scale".
// Feeders: a feeder named with its size but no length becomes a visible
// 0-qty "measure" line — never a guessed length.

import { classifyPointText, PointKind } from './footageCalibration';

// ── Settings (app_settings.est_footage_ratios) ──────────────────────────────

export interface FootageSettings {
  version: 1;
  /** ft of branch EMT per point, by point kind. */
  emtPerPoint: { fixture: number; device: number; equipment: number };
  /** ft of MC (fixture whips/drops) per fixture. */
  mcPerFixture: number;
  /** Conductor-ft of #12/#10 per ft of branch conduit, at baseConductors per circuit. */
  wirePerConduitFt: number;
  /** Conductors per circuit behind wirePerConduitFt (Chris's jobs: 2#12 1#12G → 3). */
  baseConductors: number;
  /** Share of branch wire carried as #10 (long-run voltage drop). */
  wire10Share: number;
  /** ft of branch-size site PVC per site pole. */
  pvcSitePerPole: number;
  /** v1 vs v2 disagreement (%) above which geometry is only shown (ratio qty kept). */
  v2DisagreePct: number;
  /** v2: marks with no circuit tag are chained this many to a circuit. */
  pointsPerCircuit: number;
  /** Library item names the allowance lines map to (exact names/aliases). */
  items: { emt: string; wire12: string; wire10: string; mc: string; pvcSite: string };
  /** Shown in every line's evidence text. */
  calibratedOn: string;
  /** Leave-one-out mean absolute error, % — shown in the evidence text. */
  looErrorPct: { emt: number; mc: number; wire: number; pvcSite: number | null };
}

// The fitted values from footageCalibration.ts on the five BOM fixtures,
// rounded (footageCalibration.test.ts re-derives them and fails if these
// drift from the data). Migration 150 seeds the same JSON into app_settings.
export const DEFAULT_FOOTAGE_SETTINGS: FootageSettings = {
  version: 1,
  emtPerPoint: { fixture: 6.6, device: 6.6, equipment: 6.6 },
  mcPerFixture: 7.89,
  wirePerConduitFt: 5.54,
  baseConductors: 3,
  wire10Share: 0.47,
  pvcSitePerPole: 130,
  v2DisagreePct: 40,
  pointsPerCircuit: 8,
  items: {
    emt: '3/4" EMT (incl. couplings/straps)',
    wire12: '#12 THHN/THWN copper conductor',
    wire10: '#10 THHN/THWN copper conductor',
    mc: '12/2 MC cable',
    pvcSite: '1" PVC Sch 40 (incl. fittings/glue)',
  },
  calibratedOn: "5 of Chris's jobs",
  looErrorPct: { emt: 35, mc: 22, wire: 37, pvcSite: 130 },
};

function finiteNonNeg(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Parses the stored JSON over the defaults — a missing, malformed or
 *  negative field falls back to its default, never NaN into a price. */
export function parseFootageSettings(raw: string | null | undefined): FootageSettings {
  const d = DEFAULT_FOOTAGE_SETTINGS;
  let o: Record<string, any> = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  const e = o.emtPerPoint ?? {};
  const it = o.items ?? {};
  const loo = o.looErrorPct ?? {};
  const str = (v: unknown, f: string) => (typeof v === 'string' && v.trim() ? v.trim() : f);
  return {
    version: 1,
    emtPerPoint: {
      fixture: finiteNonNeg(e.fixture, d.emtPerPoint.fixture),
      device: finiteNonNeg(e.device, d.emtPerPoint.device),
      equipment: finiteNonNeg(e.equipment, d.emtPerPoint.equipment),
    },
    mcPerFixture: finiteNonNeg(o.mcPerFixture, d.mcPerFixture),
    wirePerConduitFt: finiteNonNeg(o.wirePerConduitFt, d.wirePerConduitFt),
    baseConductors: Math.max(1, finiteNonNeg(o.baseConductors, d.baseConductors)),
    wire10Share: Math.min(1, finiteNonNeg(o.wire10Share, d.wire10Share)),
    pvcSitePerPole: finiteNonNeg(o.pvcSitePerPole, d.pvcSitePerPole),
    v2DisagreePct: finiteNonNeg(o.v2DisagreePct, d.v2DisagreePct),
    pointsPerCircuit: Math.max(1, Math.round(finiteNonNeg(o.pointsPerCircuit, d.pointsPerCircuit))),
    items: {
      emt: str(it.emt, d.items.emt), wire12: str(it.wire12, d.items.wire12), wire10: str(it.wire10, d.items.wire10),
      mc: str(it.mc, d.items.mc), pvcSite: str(it.pvcSite, d.items.pvcSite),
    },
    calibratedOn: str(o.calibratedOn, d.calibratedOn),
    looErrorPct: {
      emt: finiteNonNeg(loo.emt, d.looErrorPct.emt),
      mc: finiteNonNeg(loo.mc, d.looErrorPct.mc),
      wire: finiteNonNeg(loo.wire, d.looErrorPct.wire),
      pvcSite: loo.pvcSite === null ? null : finiteNonNeg(loo.pvcSite, d.looErrorPct.pvcSite ?? 0),
    },
  };
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The takeoff row shape bidEstimate.ts reads out of agent2_output. */
export interface TakeoffRowLike {
  category: string;
  item: string;
  spec?: string | null;
  qty: number | string;
  unit: string;
  /** Remodel (Builder A1) — when present, only 'new'/'relocated' rows are new work. */
  status?: string | null;
}

/** A row this module (or B1's allowance parser) adds to the takeoff. */
export interface GeneratedTakeoffRow {
  category: string;
  /** Stable label — it is the takeoff key, so it must not carry the qty. */
  item: string;
  /** The library item name the mapper should resolve to. */
  spec: string;
  qty: number;
  unit: 'LF';
  confidence: 'APPROX';
  /** Written to est_bid_lines.evidence_note: the math behind the qty. */
  evidence: string;
}

export interface GeometryPoint { x: number; y: number; kind: PointKind; circuit?: string | null }
export interface GeometrySheet {
  sheetKey: string;
  label: string;
  /** Feet per PDF point (est_sheets.ft_per_pt); null = not scaled. */
  ftPerPt: number | null;
  panels: Array<{ x: number; y: number; label?: string }>;
  points: GeometryPoint[];
}

export interface Agent1Like {
  panels?: Array<{ name?: string; fedFrom?: string | null }> | null;
  equipment?: Array<{ tag?: string; description?: string | null }> | null;
  scopeNotes?: string[] | null;
}

export interface Agent2AllowanceLike { item: string; footage?: number | string | null; notes?: string | null }

export interface FootageInput {
  takeoffRows: TakeoffRowLike[];
  agent1?: Agent1Like | null;
  agent2Allowances?: Agent2AllowanceLike[];
  geometry?: GeometrySheet[] | null;
  settings: FootageSettings;
  dropFt: number;
  slackPct: number;
  sqFt?: number | null;
}

export const BRANCH_CATEGORY = 'Branch Wiring (allowance)';
export const FEEDER_CATEGORY = 'Feeders (allowance)';

// ── Point counts off the takeoff ─────────────────────────────────────────────

export interface PointCounts { fixture: number; device: number; equipment: number; pole: number }

function isNewWork(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.toLowerCase();
  return s === 'new' || s === 'relocated';
}

export function countPoints(rows: TakeoffRowLike[]): PointCounts {
  const c: PointCounts = { fixture: 0, device: 0, equipment: 0, pole: 0 };
  for (const r of rows) {
    const unit = String(r.unit ?? '').trim().toUpperCase();
    if (unit !== 'EA' && unit !== 'EACH') continue;
    const qty = typeof r.qty === 'number' ? r.qty : Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!isNewWork(r.status)) continue;
    if (r.category === BRANCH_CATEGORY || r.category === FEEDER_CATEGORY) continue;
    const kind = classifyPointText(`${r.item ?? ''} ${r.spec ?? ''}`, r.category ?? '');
    if (kind) c[kind] += qty;
  }
  return c;
}

/** Conductors per branch circuit, off text like "2#12 1#10G" / "3#12 + 1#12 G". */
export function parseBranchConductors(texts: string[]): number | null {
  for (const t of texts) {
    if (!/branch/i.test(t)) continue;
    const groups = [...t.matchAll(/(\d+)\s*#\s*(1[02]|14)(?:\s*G\b|\b)/gi)];
    if (groups.length) return groups.reduce((s, g) => s + Number(g[1]), 0);
  }
  return null;
}

// ── v2 geometry ──────────────────────────────────────────────────────────────

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Nearest-neighbour order starting from `start`. */
function nnOrder<T extends { x: number; y: number }>(start: { x: number; y: number }, pts: T[]): T[] {
  const left = [...pts];
  const out: T[] = [];
  let cur = start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (manhattan(cur, left[i]) < manhattan(cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0];
    out.push(cur as T);
  }
  return out;
}

export interface GeometryResult {
  /** Per-circuit route length, ft (homerun + chain + drops + slack). */
  routeFt: number;
  covered: PointCounts;
  circuits: number;
  sheets: Array<{ label: string; points: number; routeFt: number }>;
  /** Points on sheets that have no usable scale or no panel position. */
  uncoveredPoints: number;
}

export function branchFootageFromGeometry(sheets: GeometrySheet[], opts: { dropFt: number; slackPct: number; pointsPerCircuit: number }): GeometryResult {
  const covered: PointCounts = { fixture: 0, device: 0, equipment: 0, pole: 0 };
  const out: GeometryResult['sheets'] = [];
  let routeFt = 0; let circuits = 0; let uncoveredPoints = 0;
  for (const s of sheets) {
    const pts = s.points.filter(p => p.kind !== 'pole');
    if (!s.ftPerPt || !(s.ftPerPt > 0) || !s.panels.length) { uncoveredPoints += pts.length; continue; }
    const groups: GeometryPoint[][] = [];
    const byCircuit = new Map<string, GeometryPoint[]>();
    const untagged: GeometryPoint[] = [];
    for (const p of pts) {
      const c = (p.circuit ?? '').trim();
      if (c) { const g = byCircuit.get(c) ?? []; g.push(p); byCircuit.set(c, g); } else untagged.push(p);
    }
    groups.push(...byCircuit.values());
    for (const kind of ['fixture', 'device', 'equipment'] as PointKind[]) {
      const ofKind = untagged.filter(p => p.kind === kind);
      if (!ofKind.length) continue;
      const nearestPanel = s.panels.reduce((b, p) => (manhattan(p, ofKind[0]) < manhattan(b, ofKind[0]) ? p : b), s.panels[0]);
      const ordered = nnOrder(nearestPanel, ofKind);
      for (let i = 0; i < ordered.length; i += opts.pointsPerCircuit) groups.push(ordered.slice(i, i + opts.pointsPerCircuit));
    }
    let sheetPt = 0;
    for (const g of groups) {
      // Homerun from the panel nearest to the group, then chain device to device.
      let bestPanel = s.panels[0]; let bestD = Infinity;
      for (const pnl of s.panels) for (const p of g) { const d = manhattan(pnl, p); if (d < bestD) { bestD = d; bestPanel = pnl; } }
      const chain = nnOrder(bestPanel, g);
      let len = manhattan(bestPanel, chain[0]);
      for (let i = 1; i < chain.length; i++) len += manhattan(chain[i - 1], chain[i]);
      sheetPt += len;
      circuits += 1;
      for (const p of g) covered[p.kind] += 1;
    }
    const sheetFt = sheetPt * s.ftPerPt * (1 + opts.slackPct / 100) + pts.length * opts.dropFt;
    routeFt += sheetFt;
    out.push({ label: s.label, points: pts.length, routeFt: sheetFt });
  }
  return { routeFt, covered, circuits, sheets: out, uncoveredPoints };
}

// ── Feeders ──────────────────────────────────────────────────────────────────

export interface FeederSpec {
  key: string;
  conduit: string | null;
  conductors: Array<{ count: number; size: string; ground: boolean }>;
  to: string[];
  quote: string;
}

const WIRE_SIZE = '(\\d\\/0|\\d{1,2}|\\d{3}\\s*kcmil)';

/** Pulls a feeder's conduit + conductors out of free text like
 *  'feeds Panel A 4#3/0,#6G,2"C' or '3#6 + 1#10G, 3/4" C'. Null when the
 *  text names no conductor of #8 or larger (a branch circuit, not a feeder). */
export function parseFeederSpec(text: string): Omit<FeederSpec, 'to'> | null {
  const spec = parseConductorRun(text);
  if (!spec) return null;
  const phase = spec.conductors.filter(c => !c.ground);
  const isFeederSize = (s: string) => /\/0|kcmil/.test(s) || Number(s) <= 8;
  if (!phase.length || !phase.some(c => isFeederSize(c.size))) return null;
  return spec;
}

/** Conduit + conductors off free text, any wire size ("1/2\" EMT 2#12
 *  1#10G", "3/4\" 3#6 1#10G"). Null when no conductor is named. */
export function parseConductorRun(text: string): Omit<FeederSpec, 'to'> | null {
  const t = text.replace(/\s+/g, ' ');
  const conductors: FeederSpec['conductors'] = [];
  const re = new RegExp(`(?:\\((\\d+)\\)\\s*#?\\s*|(\\d+)\\s*#\\s*|#\\s*)${WIRE_SIZE}(\\s*AWG)?(\\s*(?:CU|AL))?(\\s*(?:G|GND|GRND|GROUND)\\b)?`, 'gi');
  for (const m0 of t.matchAll(re)) {
    // A bare "#N" with no count, no AWG/CU and no ground marker is a tag
    // number ("compressor unit #1"), not a conductor.
    if (m0[1] == null && m0[2] == null && !m0[4] && !m0[5] && !m0[6]) continue;
    const m = [m0[0], m0[1], m0[2], m0[3], m0[6]] as Array<string | undefined>;
    const count = Number(m[1] ?? m[2] ?? 1);
    const size = (m[3] as string).replace(/\s+/g, ' ').toLowerCase();
    conductors.push({ count: Number.isFinite(count) && count > 0 ? count : 1, size, ground: !!m[4] });
  }
  if (!conductors.length) return null;
  const cm = t.match(/(\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*"\s*(?:C\b|conduit|EMT|PVC)/i)
    ?? t.match(/(?:^|[\s,(])(\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*"(?!\s*(?:AFF|A\.F\.F|H\b|W\b|D\b|x\b))/i);
  const conduit = cm ? `${cm[1]}"` : null;
  const key = `${conduit ?? '?'}|${conductors.map(c => `${c.count}#${c.size}${c.ground ? 'G' : ''}`).join('+')}`;
  return { key, conduit, conductors, quote: text.trim().slice(0, 160) };
}

export function collectFeeders(agent1: Agent1Like | null | undefined, allowances: Agent2AllowanceLike[] = []): FeederSpec[] {
  const found = new Map<string, FeederSpec>();
  const add = (text: string | null | undefined, to: string) => {
    if (!text || /\bexisting\b/i.test(text)) return; // existing-to-remain feeders are not new work
    const spec = parseFeederSpec(text);
    if (!spec) return;
    const cur = found.get(spec.key);
    if (cur) { if (to && !cur.to.includes(to)) cur.to.push(to); } else found.set(spec.key, { ...spec, to: to ? [to] : [] });
  };
  for (const p of agent1?.panels ?? []) add(p.fedFrom ?? null, p.name ? `Panel ${p.name}` : '');
  for (const e of agent1?.equipment ?? []) add(e.description ?? null, e.tag ?? '');
  for (const n of agent1?.scopeNotes ?? []) if (/feeder/i.test(n)) add(n, '');
  // A feeder Agent 2 already carries as its own allowance row (B1) is not
  // added a second time.
  const allowanceKeys = new Set(allowances.map(a => parseFeederSpec(a.item)?.key).filter(Boolean) as string[]);
  return [...found.values()].filter(f => !allowanceKeys.has(f.key));
}

// ── The allowance ────────────────────────────────────────────────────────────

export interface FootageSummary {
  points: PointCounts;
  conductors: number;
  method: 'none' | 'v1' | 'v2' | 'v2+v1';
  v1EmtFt: number;
  v2: GeometryResult | null;
  emtFt: number;
  wireFt: number;
  mcFt: number;
  pvcSiteFt: number;
  flags: string[];
  feeders: FeederSpec[];
}

function r0(n: number): number { return Math.round(n); }
function f2(n: number): string { return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); }

function describePoints(p: PointCounts): string {
  return `${p.fixture + p.device + p.equipment} points (${p.fixture} fixtures, ${p.device} devices, ${p.equipment} equipment connections)`;
}

export function computeFootageAllowance(input: FootageInput): { rows: GeneratedTakeoffRow[]; summary: FootageSummary } {
  const s = input.settings;
  const allowances = input.agent2Allowances ?? [];
  const points = countPoints(input.takeoffRows);
  const texts = [
    ...input.takeoffRows.map(r => `${r.item ?? ''} ${r.spec ?? ''}`),
    ...allowances.map(a => a.item),
  ];
  const conductors = parseBranchConductors(texts) ?? s.baseConductors;
  const flags: string[] = [];
  const e = s.emtPerPoint;
  const v1Of = (p: PointCounts) => p.fixture * e.fixture + p.device * e.device + p.equipment * e.equipment;
  const v1EmtFt = v1Of(points);

  // v2 — only sheets with a scale and a panel position; everything else stays v1.
  let v2: GeometryResult | null = null;
  let method: FootageSummary['method'] = v1EmtFt > 0 ? 'v1' : 'none';
  let emtFt = v1EmtFt;
  let wireFt = v1EmtFt * s.wirePerConduitFt * (conductors / s.baseConductors);
  if (input.geometry?.length) {
    const g = branchFootageFromGeometry(input.geometry, { dropFt: input.dropFt, slackPct: input.slackPct, pointsPerCircuit: s.pointsPerCircuit });
    if (g.circuits > 0) {
      v2 = g;
      const coveredTotal = g.covered.fixture + g.covered.device + g.covered.equipment;
      const takeoffTotal = points.fixture + points.device + points.equipment;
      // The marks and the takeoff can disagree (a reviewer changed a count);
      // v1 prices whatever the geometry didn't reach, never less than 0.
      const rest: PointCounts = {
        fixture: Math.max(0, points.fixture - g.covered.fixture),
        device: Math.max(0, points.device - g.covered.device),
        equipment: Math.max(0, points.equipment - g.covered.equipment),
        pole: 0,
      };
      const v1Covered = v1Of(g.covered);
      const v1Rest = v1Of(rest);
      const lo = Math.min(v1Covered, g.routeFt);
      const disagreePct = lo > 0 ? (Math.abs(v1Covered - g.routeFt) / lo) * 100 : 0;
      if (disagreePct > s.v2DisagreePct) {
        // Coordinator decision (Q3): the RATIO is preferred. Geometry that
        // disagrees by more than the threshold never sets the qty — it is
        // shown for the estimator to check, and the ratio qty stays.
        method = 'v1';
        flags.push(`Plan-geometry estimate ${r0(g.routeFt)} ft for the ${coveredTotal} mapped points (ratio: ${r0(v1Covered)} ft, ${r0(disagreePct)}% apart) — check scale and panel position. Qty kept at the ratio.`);
      } else {
        method = rest.fixture + rest.device + rest.equipment > 0 ? 'v2+v1' : 'v2';
        emtFt = g.routeFt + v1Rest;
        wireFt = g.routeFt * conductors + v1Rest * s.wirePerConduitFt * (conductors / s.baseConductors);
      }
      if (coveredTotal > takeoffTotal) flags.push(`The plan marks show ${coveredTotal} points but the takeoff has ${takeoffTotal} — the geometry covers marks the takeoff no longer counts.`);
    }
  }

  const mcFt = points.fixture * s.mcPerFixture;
  const pvcSiteFt = points.pole * s.pvcSitePerPole;
  const feeders = collectFeeders(input.agent1, allowances);
  const summary: FootageSummary = { points, conductors, method, v1EmtFt, v2, emtFt, wireFt, mcFt, pvcSiteFt, flags, feeders };

  const rows: GeneratedTakeoffRow[] = [];
  const cal = `calibrated on ${s.calibratedOn}`;
  const methodLabel = method === 'v1' ? 'Method v1 (ratio)'
    : method === 'v2' ? 'Method v2 (plan geometry)'
    : method === 'v2+v1' ? `Method v2 (plan geometry) for ${v2 ? v2.covered.fixture + v2.covered.device + v2.covered.equipment : 0} mapped points + v1 (ratio) for the rest`
    : 'Method v1 (ratio)';
  const flagText = flags.length ? ` NOTE: ${flags.join(' ')}` : '';

  if (points.fixture + points.device + points.equipment > 0) {
    const emtMath = method === 'v1' || method === 'none'
      ? `${describePoints(points)} × ${f2(e.fixture)} ft EMT per point (${cal}; leave-one-out error ±${r0(s.looErrorPct.emt)}%) = ${r0(emtFt)} ft.`
      : `${describePoints(points)}: geometry ${v2 ? r0(v2.routeFt) : 0} ft (${v2?.circuits ?? 0} circuits, Manhattan homeruns × sheet scale + ${f2(input.dropFt)} ft drop per device + ${f2(input.slackPct)}% slack); ratio for the same points ${r0(v1EmtFt)} ft (${cal}). Carried: ${r0(emtFt)} ft.`;
    rows.push({
      category: BRANCH_CATEGORY, item: 'Branch conduit allowance — EMT', spec: s.items.emt,
      qty: r0(emtFt), unit: 'LF', confidence: 'APPROX',
      evidence: `${methodLabel}. ${emtMath}${flagText}`,
    });
    const wireMath = `${r0(emtFt)} ft conduit × ${method === 'v2' ? `${conductors} conductors` : `${f2(s.wirePerConduitFt * (conductors / s.baseConductors))} conductor-ft per conduit-ft (Chris's jobs: ${f2(s.wirePerConduitFt)} at ${s.baseConductors}-wire circuits${conductors !== s.baseConductors ? `, scaled to ${conductors} conductors from the panel circuit wiring` : ''})`} = ${r0(wireFt)} ft`;
    const w10 = wireFt * s.wire10Share;
    const w12 = wireFt - w10;
    rows.push({
      category: BRANCH_CATEGORY, item: 'Branch wire allowance — #12 THHN', spec: s.items.wire12,
      qty: r0(w12), unit: 'LF', confidence: 'APPROX',
      evidence: `${methodLabel}. ${wireMath}; ${r0((1 - s.wire10Share) * 100)}% as #12 = ${r0(w12)} ft (${cal}; leave-one-out error ±${r0(s.looErrorPct.wire)}%).`,
    });
    rows.push({
      category: BRANCH_CATEGORY, item: 'Branch wire allowance — #10 THHN', spec: s.items.wire10,
      qty: r0(w10), unit: 'LF', confidence: 'APPROX',
      evidence: `${methodLabel}. ${wireMath}; ${r0(s.wire10Share * 100)}% as #10 for long-run voltage drop = ${r0(w10)} ft (${cal}).`,
    });
  }
  if (points.fixture > 0 && s.mcPerFixture > 0) {
    rows.push({
      category: BRANCH_CATEGORY, item: 'Fixture whip allowance — 12/2 MC', spec: s.items.mc,
      qty: r0(mcFt), unit: 'LF', confidence: 'APPROX',
      evidence: `Method v1 (ratio). ${points.fixture} fixtures × ${f2(s.mcPerFixture)} ft MC per fixture (${cal}; leave-one-out error ±${r0(s.looErrorPct.mc)}%) = ${r0(mcFt)} ft.`,
    });
  }
  if (points.pole > 0 && s.pvcSitePerPole > 0) {
    rows.push({
      category: BRANCH_CATEGORY, item: 'Site lighting conduit allowance — PVC', spec: s.items.pvcSite,
      qty: r0(pvcSiteFt), unit: 'LF', confidence: 'APPROX',
      evidence: `Method v1 (ratio). ${points.pole} site poles × ${f2(s.pvcSitePerPole)} ft PVC per pole (only 2 of Chris's jobs have poles — low confidence${s.looErrorPct.pvcSite != null ? `, leave-one-out error ±${r0(s.looErrorPct.pvcSite)}%` : ''}) = ${r0(pvcSiteFt)} ft. Measure the site runs when the site plan is scaled.`,
    });
  }

  for (const f of feeders) {
    const where = f.to.length ? ` — ${f.to.join(', ')}` : '';
    const wires = f.conductors.map(c => `${c.count}#${c.size}${c.ground ? 'G' : ''}`).join(' + ');
    const quote = `Source: "${f.quote}".`;
    rows.push({
      category: FEEDER_CATEGORY, item: `MEASURE FEEDER — ${f.conduit ?? '?'} conduit, ${wires}${where}`,
      spec: f.conduit ? `${f.conduit} EMT (incl. couplings/straps)` : 'EMT (incl. couplings/straps)',
      qty: 0, unit: 'LF', confidence: 'APPROX',
      evidence: `Feeder size is on the plans but no length. Measure the run on the Plans view (Measure tool on this line) — the confirmed run replaces this 0. ${quote}`,
    });
    for (const c of f.conductors) {
      rows.push({
        category: FEEDER_CATEGORY, item: `MEASURE FEEDER — #${c.size}${c.ground ? ' ground' : ''} wire (${c.count} per run)${where}`,
        spec: `#${c.size} THHN/THWN copper conductor`,
        qty: 0, unit: 'LF', confidence: 'APPROX',
        evidence: `Enter conductor-ft = measured run × ${c.count}${f.to.length > 1 ? ` × ${f.to.length} runs` : ''}. ${quote}`,
      });
    }
  }
  return { rows, summary };
}
