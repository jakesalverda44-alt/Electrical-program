// Price accuracy round, C3 — boxes / rings / fittings / support hardware as
// allowance LINES on every bid still being estimated, from the takeoff's own
// points and conduit footage (boxFittingCalibration.ts has the fit):
//   Box allowance         qty = device/fixture/equipment points (EA)
//   EMT fittings          qty = EMT ft   (item priced per 100 ft)
//   PVC fittings          qty = PVC ft
//   MC / flex connectors  qty = MC + flex ft
//   Support hardware      qty = EMT + MC/flex ft, and fixtures (EA)
// The rates live on the library items (ALW-*, editable in the Labor
// Library); app_settings est_box_fitting_allowance turns the allowance on or
// off and scales each group. One source per scope, like wiringScopes:
//   * boxes — a point already priced as an assembly that includes its box
//     (e.g. "20A duplex receptacle circuit, complete") is not counted, and
//     box lines in the takeoff (J-boxes, Agent 2 or the estimator's own)
//     come off the count;
//   * fittings / hardware — an estimator's own line in that group replaces
//     the allowance (it drops to 0, saying why).
// Pure: footageAllowanceDb.ts supplies rows, existing lines and the resolver.
import { classifyPointText } from './footageCalibration';
import { bfGroupOf } from './boxFittingCalibration';
import { isLumpSumDemolition } from './mapper';

export const BOX_FITTING_CATEGORY = 'Boxes, Fittings & Hardware (allowance)';

export interface BoxFittingSettings {
  version: 1;
  /** 1 = on, 0 = off. */
  enabled: number;
  /** Multipliers on the calibrated allowance, per group (1 = as calibrated). */
  scale: { box: number; fittings: number; hardware: number; splice: number };
  items: { box: string; fitEmt: string; fitPvc: string; fitMc: string; hwRaceway: string; hwFixture: string; splice: string };
  calibratedOn: string;
  /** Leave-one-out mean absolute error (%) of the hours, per group. */
  looErrorPct: { box: number; fittings: number; hardware: number; splice: number; total: number };
}

export const DEFAULT_BOX_FITTING_SETTINGS: BoxFittingSettings = {
  version: 1,
  enabled: 1,
  scale: { box: 1, fittings: 1, hardware: 1, splice: 1 },
  items: {
    box: 'Box allowance — box, ring or cover, bracket, ground screw (per point)',
    fitEmt: 'EMT fittings allowance — couplings, connectors, straps (per 100 ft)',
    fitPvc: 'PVC fittings allowance — elbows, couplings, adapters (per 100 ft)',
    fitMc: 'MC / flex connector allowance (per 100 ft)',
    hwRaceway: 'Support hardware allowance — anchors, clips, hangers, screws (per 100 ft)',
    hwFixture: 'Support hardware allowance — per fixture',
    splice: 'Wire connector allowance — twist-on splices (per point)',
  },
  calibratedOn: "5 of Chris's jobs",
  looErrorPct: { box: 35, fittings: 27, hardware: 15, splice: 28, total: 19 },
};

function nonNeg(v: unknown, f: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : f;
}

export function parseBoxFittingSettings(raw: string | null | undefined): BoxFittingSettings {
  const d = DEFAULT_BOX_FITTING_SETTINGS;
  let o: Record<string, any> = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
  if (!o || typeof o !== 'object') o = {};
  const sc = o.scale ?? {};
  const it = o.items ?? {};
  const loo = o.looErrorPct ?? {};
  const str = (v: unknown, f: string) => (typeof v === 'string' && v.trim() ? v.trim() : f);
  return {
    version: 1,
    enabled: nonNeg(o.enabled, d.enabled) > 0 ? 1 : 0,
    scale: { box: nonNeg(sc.box, d.scale.box), fittings: nonNeg(sc.fittings, d.scale.fittings), hardware: nonNeg(sc.hardware, d.scale.hardware), splice: nonNeg(sc.splice, d.scale.splice) },
    items: {
      box: str(it.box, d.items.box), fitEmt: str(it.fitEmt, d.items.fitEmt), fitPvc: str(it.fitPvc, d.items.fitPvc),
      fitMc: str(it.fitMc, d.items.fitMc), hwRaceway: str(it.hwRaceway, d.items.hwRaceway), hwFixture: str(it.hwFixture, d.items.hwFixture),
      splice: str(it.splice, d.items.splice),
    },
    calibratedOn: str(o.calibratedOn, d.calibratedOn),
    looErrorPct: {
      box: nonNeg(loo.box, d.looErrorPct.box), fittings: nonNeg(loo.fittings, d.looErrorPct.fittings),
      hardware: nonNeg(loo.hardware, d.looErrorPct.hardware), splice: nonNeg(loo.splice, d.looErrorPct.splice), total: nonNeg(loo.total, d.looErrorPct.total),
    },
  };
}

/** What PUT /api/settings accepts for est_box_fitting_allowance. */
export function validateBoxFittingSettingsJson(raw: unknown): string[] {
  if (typeof raw !== 'string') return ['must be a JSON string'];
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return ['is not valid JSON']; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['must be a JSON object'];
  const errs: string[] = [];
  const obj = o as Record<string, unknown>;
  const num = (path: string, v: unknown, max?: number) => {
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${path} must be a number`); return; }
    if (v < 0) errs.push(`${path} must be at least 0`);
    if (max != null && v > max) errs.push(`${path} must be at most ${max}`);
  };
  num('enabled', obj.enabled, 1);
  const sc = obj.scale;
  if (sc !== undefined) {
    if (!sc || typeof sc !== 'object') errs.push('scale must be an object');
    else for (const k of ['box', 'fittings', 'hardware', 'splice']) num(`scale.${k}`, (sc as Record<string, unknown>)[k], 10);
  }
  return errs;
}

export interface BfRowLike {
  category: string;
  item: string;
  spec?: string | null;
  qty: number | string;
  unit: string;
}
export interface BfExistingLine {
  category: string;
  description: string;
  unit: string;
  qty: number;
  source: 'takeoff' | 'manual';
  qty_overridden?: boolean;
  qty_source?: string | null;
  excluded?: boolean;
  takeoff_key?: string | null;
}

export interface BoxFittingRow {
  category: string;
  item: string;
  spec: string;
  qty: number;
  unit: 'EA' | 'LF';
  confidence: 'APPROX';
  evidence: string;
}

export interface BoxFittingDrivers {
  points: { fixture: number; device: number; equipment: number };
  /** Points already priced as an assembly that includes its box. */
  pointsWithBox: number;
  /** Box lines already in the takeoff / the estimator's lines (EA). */
  boxLines: number;
  emtFt: number;
  pvcFt: number;
  mcFt: number;
}

const LINEAR = /^(LF|FT|FEET|FOOT)$/i;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (r: { item?: string; spec?: string | null; description?: string }) => `${r.item ?? r.description ?? ''} ${r.spec ?? ''}`;
function lfOf(qty: number, unit: string): number | null {
  const u = String(unit ?? '').trim().toUpperCase();
  if (LINEAR.test(u)) return qty;
  if (u === 'C') return qty * 100;
  if (u === 'M') return qty * 1000;
  return null;
}
function raceway(t: string): 'emt' | 'pvc' | 'mc' | null {
  if (/fittings? allowance|connector allowance|hardware allowance/i.test(t)) return null;
  if (/\bthhn\b|\bthwn\b|\bxhhw\b|conductor/i.test(t) && !/\bemt\b|\bpvc\b|conduit/i.test(t)) return null;
  if (/\bmc\b|mc cable|\bflex\b|\bfmc\b|\blfmc\b|liquidtight/i.test(t)) return 'mc';
  if (/\bpvc\b/i.test(t)) return 'pvc';
  if (/\bemt\b/i.test(t)) return 'emt';
  return null;
}

/** The drivers, off the takeoff rows the bid will price (Agent 2's rows
 *  after the one-source rule, plus the generated allowance rows) and the
 *  estimator's own manual lines. */
export function boxFittingDrivers(
  rows: BfRowLike[],
  manual: BfExistingLine[],
  pointHasBox: (row: BfRowLike) => boolean,
): BoxFittingDrivers {
  const d: BoxFittingDrivers = { points: { fixture: 0, device: 0, equipment: 0 }, pointsWithBox: 0, boxLines: 0, emtFt: 0, pvcFt: 0, mcFt: 0 };
  const add = (t: string, qty: number, unit: string, category: string, row: BfRowLike | null) => {
    if (!(qty > 0)) return;
    if (/demoli/i.test(category) || isLumpSumDemolition(category, t)) return;
    const lf = lfOf(qty, unit);
    if (lf != null) {
      const k = raceway(t);
      if (k === 'emt') d.emtFt += lf; else if (k === 'pvc') d.pvcFt += lf; else if (k === 'mc') d.mcFt += lf;
      return;
    }
    if (String(unit).trim().toUpperCase() !== 'EA') return;
    if (bfGroupOf(t) === 'box' || /\bj-?box(?:es)?\b|junction box|pull box|\b4" square box\b/i.test(t)) { d.boxLines += qty; return; }
    const kind = classifyPointText(t, category);
    if (kind !== 'fixture' && kind !== 'device' && kind !== 'equipment') return;
    d.points[kind] += qty;
    if (row && pointHasBox(row)) d.pointsWithBox += qty;
  };
  for (const r of rows) {
    if (r.category === BOX_FITTING_CATEGORY) continue;
    add(text(r), num(r.qty), r.unit, r.category, r);
  }
  for (const l of manual) {
    if (l.source !== 'manual' || l.excluded || l.category === BOX_FITTING_CATEGORY) continue;
    add(l.description, num(l.qty), l.unit, l.category, null);
  }
  return d;
}

/** The estimator's own lines per group (a manual line, or a hand-typed qty
 *  on a takeoff line, whose words name a box / fitting / hardware item). */
function ownGroupLines(existing: BfExistingLine[]): { fittings: string[]; hardware: string[]; splice: string[] } {
  const out = { fittings: [] as string[], hardware: [] as string[], splice: [] as string[] };
  for (const l of existing) {
    if (l.excluded || l.category === BOX_FITTING_CATEGORY || !(num(l.qty) > 0)) continue;
    const own = l.source === 'manual' || !!l.qty_overridden || l.qty_source === 'markup';
    if (!own) continue;
    const g = bfGroupOf(l.description);
    if (g === 'hardware') out.hardware.push(l.description);
    else if (g === 'splice') out.splice.push(l.description);
    else if (g === 'fitEmt' || g === 'fitPvc' || g === 'fitMc') out.fittings.push(l.description);
  }
  return out;
}

export function computeBoxFittingRows(input: {
  rows: BfRowLike[];
  existing: BfExistingLine[];
  settings: BoxFittingSettings;
  pointHasBox: (row: BfRowLike) => boolean;
}): { rows: BoxFittingRow[]; drivers: BoxFittingDrivers } {
  const { settings: s } = input;
  const drivers = boxFittingDrivers(input.rows, input.existing, input.pointHasBox);
  if (!s.enabled) return { rows: [], drivers };
  const own = ownGroupLines(input.existing);
  const cal = `calibrated on ${s.calibratedOn}`;
  const out: BoxFittingRow[] = [];
  // A group with nothing to drive it (no points, no footage of that raceway)
  // adds no line at all — never a row of 0-qty noise.
  const row = (item: string, spec: string, qty: number, unit: 'EA' | 'LF', evidence: string, driver: number) => {
    if (!(driver > 0)) return;
    out.push({ category: BOX_FITTING_CATEGORY, item, spec, qty: Math.max(0, Math.round(qty)), unit, confidence: 'APPROX', evidence });
  };
  const scaleNote = (k: 'box' | 'fittings' | 'hardware' | 'splice') => (s.scale[k] !== 1 ? ` × ${s.scale[k]} (your scale)` : '');

  // Boxes.
  const pts = drivers.points.fixture + drivers.points.device + drivers.points.equipment;
  const boxQty = Math.max(0, pts - drivers.pointsWithBox - drivers.boxLines) * s.scale.box;
  row('Box allowance', s.items.box, boxQty, 'EA',
    `Box allowance, ESTIMATED: ${pts} points (${drivers.points.fixture} fixtures, ${drivers.points.device} devices, ${drivers.points.equipment} equipment)`
    + `${drivers.pointsWithBox ? ` − ${drivers.pointsWithBox} already priced with their box` : ''}`
    + `${drivers.boxLines ? ` − ${drivers.boxLines} box lines in the takeoff` : ''}${scaleNote('box')} — one box set per point, ${cal} (leave-one-out ±${s.looErrorPct.box}% on hours)`, pts);

  // Fittings, per raceway.
  const fitNote = own.fittings.length ? `Replaced by your own fitting lines (${own.fittings.slice(0, 3).join('; ')})` : null;
  const fit = (item: string, spec: string, ft: number, what: string) =>
    row(item, spec, fitNote ? 0 : ft * s.scale.fittings, 'LF', fitNote ?? `${what}, ESTIMATED: ${Math.round(ft)} ft in the takeoff${scaleNote('fittings')} — ${cal} (leave-one-out ±${s.looErrorPct.fittings}% on hours)`, ft);
  fit('EMT fittings allowance', s.items.fitEmt, drivers.emtFt, 'Couplings, connectors and straps beyond what the EMT item carries');
  fit('PVC fittings allowance', s.items.fitPvc, drivers.pvcFt, 'PVC elbows, couplings and adapters beyond what the PVC item carries');
  fit('MC / flex connector allowance', s.items.fitMc, drivers.mcFt, 'MC / flex connectors');

  // Support hardware.
  const hwNote = own.hardware.length ? `Replaced by your own hardware lines (${own.hardware.slice(0, 3).join('; ')})` : null;
  const conduitFt = drivers.emtFt + drivers.mcFt;
  row('Support hardware allowance — raceway', s.items.hwRaceway, hwNote ? 0 : conduitFt * s.scale.hardware, 'LF',
    hwNote ?? `Anchors, clips, hangers, screws, ceiling wire, ESTIMATED: ${Math.round(conduitFt)} ft of EMT + MC/flex${scaleNote('hardware')} — ${cal} (leave-one-out ±${s.looErrorPct.hardware}% on hours)`, conduitFt);
  row('Support hardware allowance — fixtures', s.items.hwFixture, hwNote ? 0 : drivers.points.fixture * s.scale.hardware, 'EA',
    hwNote ?? `Fixture support hardware, ESTIMATED: ${drivers.points.fixture} fixtures${scaleNote('hardware')} — ${cal}`, drivers.points.fixture);
  // Wire connectors (twist-on splices) — per point, like the box sets.
  const splNote = own.splice.length ? `Replaced by your own wire connector lines (${own.splice.slice(0, 3).join('; ')})` : null;
  const splPts = Math.max(0, pts - drivers.pointsWithBox);
  row('Wire connector allowance', s.items.splice, splNote ? 0 : splPts * s.scale.splice, 'EA',
    splNote ?? `Twist-on wire connectors, ESTIMATED: ${pts} points${drivers.pointsWithBox ? ` − ${drivers.pointsWithBox} priced as a complete circuit` : ''}${scaleNote('splice')} — ${cal} (leave-one-out ±${s.looErrorPct.splice}% on hours)`, pts);
  return { rows: out, drivers };
}
