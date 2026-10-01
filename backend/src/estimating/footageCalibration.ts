// Remodel + footage round, B2 — calibrating the branch-footage allowance
// against Chris's real Accubid BOMs. Pure: no I/O, no DB.
//
// Every BOM row's qty is RAW FEET (or a raw count for a device/fixture row) —
// the unit letter is only Accubid's pricing divisor (C = per 100, M = per
// 1000), never a unit of the quantity itself. So "#12 Black ... 1,056 M" is
// 1,056 ft of #12, and "Duplex Receptacle ... 5 C" is 5 receptacles.
//
// Per job this module reads two things off the same BOM:
//   - POINTS: how many fixtures / devices / equipment connections / site
//     poles Chris priced (classifyPointText — the SAME classifier
//     footageAllowance.ts runs over a live takeoff, so a ratio fitted here is
//     applied to counts measured the same way);
//   - FOOTAGE: branch EMT (1" and under), MC cable, #12/#10 THHN, and site
//     PVC (1" and under).
// fitFootageRatios() turns five jobs into per-point ratios; leaveOneOut()
// refits on four and predicts the fifth, which is the honest error to quote.

import { ParsedBom } from './accubidBom';

export type PointKind = 'fixture' | 'device' | 'equipment' | 'pole';

// ── The one point classifier (BOM rows AND takeoff rows) ────────────────────

const SKIP_RE = /\bdemolition\b|\bdemo\b|wall ?plate|\bplate\b|\blamps?\b(?!.*luminaire)|\bballast\b|\bfuse\b|\bbox\b|\bcover\b|\bring\b|\bbracket\b|\bconduit\b|\bwire\b|\bcable\b|\bpanel ?board\b|\bpanel [a-z0-9]+\b|\belectrical panel\b|\bpanel\b|\btransformer\b|\bmeter\b|\bfeeders?\b/i;
const POLE_RE = /\bpole (?:round|square)\b|\blight pole\b|\bpole straight\b|\bsteel (?:round |square )?pole\b|\bsite pole\b/i;
const FIXTURE_RE = /luminaire|\bfixture\b|\btroffer\b|\bdownlight\b|\bcan light\b|\bhigh ?bay\b|\bstrip ?light\b|\bwall ?pack\b|\bexit\b|\bemergency\b|\bbug ?eye\b|\bpendant\b|\bsconce\b|\bvanity\b|\bflood ?light\b|\bbollard\b|\blight fixture\b|\bpole[- ]top\b|\barea light\b|\bcanopy light\b|\btrack (?:mount )?luminaire\b|\bled\b.*\b(?:2x4|2x2|1x4|4'|8')/i;
const EQUIPMENT_RE = /safety switch|\bdisconnect\b|\bdisc\b|\bpower poles?\b|\bfans?\b|\bexhaust\b|\bequipment connection\b|\(connection\)|\bconnection\b|\bcompressor\b|\bcondens(?:er|ing)\b|\bair handler\b|\bahu\b|\brtu\b|\bwater heater\b|\bmotor\b|\bpump\b|\bcharger\b|\bhvac\b|\bunit heater\b|\bhand dryer\b|\bdoor operator\b|\bgate operator\b/i;
const DEVICE_RE = /receptacle|\bgfci?\b|\bduplex\b|\bquad\b|\bfourplex\b|toggle switch|\bswitch\b|\bdimmer\b|\boccupancy\b|\bvacancy\b|\bsensor\b|\btime ?(?:switch|clock)\b|\btimer\b|low voltage control|\bphotocell\b|\bcontactor\b|\$/i;

/** Gap-closing T8 (J10) — a LUMINAIRE that takes an MC whip: a fixture point that is not an exit / emergency /
 *  battery unit, not a site pole / pole head, not an exterior wall-mount / wall pack / flood / bollard. An exterior
 *  recessed downlight (a soffit can) is a luminaire (Chris whips Kissimmee's 11 soffit downlights: 1,942.5 ft /
 *  (133 + 11) = 13.5 ft). One test for BOM rows and takeoff rows. */
export function isLuminaireText(text: string, category = ''): boolean {
  if (classifyPointText(text, category) !== 'fixture') return false;
  if (/\bexit\b|emergency|\bem\b|battery|unit equipment|egress|\bheads?\b/i.test(text)) return false;
  if (/\bpole\b|pole[- ]top|arm mount|\bsite light|area light|wall ?pack|wall[- ]mount|\bflood|\bbollard|canopy|\bdsxw?\d?\b/i.test(text)) return false;
  if (/exterior|site/i.test(category) && !/soffit|downlight|recessed|\bcan\b/i.test(text)) return false;
  return true;
}

/** Which kind of branch-circuit "point" a BOM row or takeoff row is, or null
 *  for anything that isn't one (raceway, wire, boxes, plates, lamps, panels,
 *  feeders, demolition — demolition is never new branch wiring). A takeoff
 *  row's category is a hint only: an exhaust fan listed under Interior
 *  Lighting is still an equipment connection. */
export function classifyPointText(text: string, category = ''): PointKind | null {
  const t = `${text}`.trim();
  if (!t) return null;
  if (/\bdemolition\b/i.test(category) || /\bdemolition\b|^demo\b/i.test(t)) return null;
  // A motor termination is the load end of a connection already counted at
  // its safety switch — never a second point.
  if (/\btermination\b/i.test(t)) return null;
  // Safety switches / disconnects before the generic "switch" device test.
  if (/safety switch|\bdisconnect\b/i.test(t)) return 'equipment';
  // Unambiguous device / fixture nouns before the skip list ("Single
  // Receptacle - Side Wire Only" is a receptacle, not wire).
  if (/receptacle/i.test(t) && !/wall ?plate|\bplate\b|\bbox\b|\bcover\b/i.test(t)) return 'device';
  if (/luminaire/i.test(t)) return 'fixture';
  if (POLE_RE.test(t) && !/power pole/i.test(t)) return 'pole';
  if (SKIP_RE.test(t) && !/luminaire|power poles?/i.test(t)) return null;
  if (/\bfans?\b|\bexhaust\b/i.test(t)) return 'equipment';
  if (FIXTURE_RE.test(t)) return 'fixture';
  if (EQUIPMENT_RE.test(t)) return 'equipment';
  if (DEVICE_RE.test(t)) return 'device';
  // Category fallback for a bare type tag ("Type A — ..." rows always carry
  // their description, but a legend symbol row may not).
  if (/lighting controls/i.test(category)) return 'device';
  if (/interior lighting|exterior|site lighting/i.test(category)) return 'fixture';
  return null;
}

// ── Per-job features off a parsed BOM ───────────────────────────────────────

export interface BomFootageJob {
  job: string;
  points: Record<PointKind, number>;
  /** Branch EMT, 1" and under (1/2", 3/4", 1"). */
  emtFt: number;
  mcFt: number;
  wire12Ft: number;
  wire10Ft: number;
  /** Site PVC, 1" and under (branch-size underground runs). */
  pvcSiteFt: number;
  /** Gap-closing T8 — luminaires taking an MC whip (isLuminaireText). */
  luminaires: number;
}

const BRANCH_SIZE_RE = /^(1\/2|3\/4|1)"/;

export function extractBomFootageJob(job: string, bom: ParsedBom): BomFootageJob {
  const points: Record<PointKind, number> = { fixture: 0, device: 0, equipment: 0, pole: 0 };
  let emtFt = 0; let mcFt = 0; let wire12Ft = 0; let wire10Ft = 0; let pvcSiteFt = 0; let luminaires = 0;
  for (const r of bom.rows) {
    const d = r.description;
    if (/conduit - emt/i.test(d)) { if (BRANCH_SIZE_RE.test(d)) emtFt += r.qty; continue; }
    if (/conduit - pvc/i.test(d)) { if (BRANCH_SIZE_RE.test(d)) pvcSiteFt += r.qty; continue; }
    if (/mc cable/i.test(d)) { mcFt += r.qty; continue; }
    if (/wire thhn/i.test(d)) {
      if (/^#12 /.test(d)) wire12Ft += r.qty;
      else if (/^#10 /.test(d)) wire10Ft += r.qty;
      continue;
    }
    const kind = classifyPointText(d);
    if (kind) points[kind] += r.qty;
    if (kind === 'fixture' && isLuminaireText(d)) luminaires += r.qty;
  }
  return { job, points, emtFt, mcFt, wire12Ft, wire10Ft, pvcSiteFt, luminaires };
}

// ── Fitting ──────────────────────────────────────────────────────────────────

export interface EmtPerPoint { fixture: number; device: number; equipment: number }

export interface FittedFootageRatios {
  emtPerPoint: EmtPerPoint;
  /** Which EMT model won leave-one-out: one pooled ratio per point, or
   *  separate non-negative ratios per point kind. */
  emtModel: 'pooled' | 'per_kind';
  mcPerFixture: number;
  /** Gap-closing T8 — pooled MC ft per luminaire (the alternative basis; its LOO is reported). */
  mcPerLuminaire: number;
  /** Conductor-feet of #12/#10 per foot of branch EMT (Chris's jobs are all
   *  3-wire 20A circuits sharing homeruns, so this is ~5.5, not 3). */
  wirePerConduitFt: number;
  /** Share of branch wire that is #10 (voltage-drop upsizing on long runs). */
  wire10Share: number;
  /** Site PVC per site pole — only jobs with poles inform it. */
  pvcSitePerPole: number;
  pvcJobs: number;
}

function sum(xs: number[]): number { return xs.reduce((s, x) => s + x, 0); }

/** Least squares through the origin with every coefficient >= 0 (exhaustive
 *  active-set search — at most 3 predictors, so 7 subsets). */
export function nnlsThroughOrigin(X: number[][], y: number[]): number[] {
  const p = X[0]?.length ?? 0;
  let best: { sse: number; coef: number[] } | null = null;
  for (let mask = 1; mask < (1 << p); mask++) {
    const idx = Array.from({ length: p }, (_, i) => i).filter(i => mask & (1 << i));
    // Normal equations A c = b on the chosen columns.
    const A = idx.map(i => idx.map(j => sum(X.map(r => r[i] * r[j]))));
    const b = idx.map(i => sum(X.map((r, k) => r[i] * y[k])));
    const c = solve(A, b);
    if (!c || c.some(v => v < 0 || !Number.isFinite(v))) continue;
    const coef = new Array(p).fill(0);
    idx.forEach((i, k) => { coef[i] = c[k]; });
    const sse = sum(X.map((r, k) => (sum(r.map((x, i) => x * coef[i])) - y[k]) ** 2));
    if (!best || sse < best.sse - 1e-9) best = { sse, coef };
  }
  return best?.coef ?? new Array(p).fill(0);
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const KINDS: Array<keyof EmtPerPoint> = ['fixture', 'device', 'equipment'];

function branchPoints(j: BomFootageJob): number {
  return j.points.fixture + j.points.device + j.points.equipment;
}

function fitEmt(jobs: BomFootageJob[], model: 'pooled' | 'per_kind'): EmtPerPoint {
  if (model === 'pooled') {
    const r = sum(jobs.map(j => j.emtFt)) / Math.max(1, sum(jobs.map(branchPoints)));
    return { fixture: r, device: r, equipment: r };
  }
  const c = nnlsThroughOrigin(jobs.map(j => KINDS.map(k => j.points[k])), jobs.map(j => j.emtFt));
  return { fixture: c[0], device: c[1], equipment: c[2] };
}

export function predictEmt(r: EmtPerPoint, points: Record<PointKind, number>): number {
  return r.fixture * points.fixture + r.device * points.device + r.equipment * points.equipment;
}

function fitWithModel(jobs: BomFootageJob[], model: 'pooled' | 'per_kind'): FittedFootageRatios {
  const poleJobs = jobs.filter(j => j.points.pole > 0);
  const wire = sum(jobs.map(j => j.wire12Ft + j.wire10Ft));
  return {
    emtPerPoint: fitEmt(jobs, model),
    emtModel: model,
    mcPerFixture: sum(jobs.map(j => j.mcFt)) / Math.max(1, sum(jobs.map(j => j.points.fixture))),
    mcPerLuminaire: sum(jobs.map(j => j.mcFt)) / Math.max(1, sum(jobs.map(j => j.luminaires ?? 0))),
    wirePerConduitFt: wire / Math.max(1, sum(jobs.map(j => j.emtFt))),
    wire10Share: sum(jobs.map(j => j.wire10Ft)) / Math.max(1, wire),
    pvcSitePerPole: poleJobs.length ? sum(poleJobs.map(j => j.pvcSiteFt)) / sum(poleJobs.map(j => j.points.pole)) : 0,
    pvcJobs: poleJobs.length,
  };
}

export interface LooRow {
  job: string;
  actual: { emtFt: number; mcFt: number; wireFt: number; pvcSiteFt: number };
  predicted: { emtFt: number; mcFt: number; wireFt: number; pvcSiteFt: number | null };
  /** (predicted - actual) / actual * 100; null when there's nothing to compare. */
  errorPct: { emt: number | null; mc: number | null; wire: number | null; pvcSite: number | null; mcLuminaire?: number | null };
}

export interface LooReport {
  model: 'pooled' | 'per_kind';
  rows: LooRow[];
  /** Mean absolute leave-one-out error, %. */
  mae: { emt: number; mc: number; wire: number; pvcSite: number | null; mcLuminaire?: number };
}

function pctErr(pred: number, actual: number): number | null {
  return actual > 0 ? ((pred - actual) / actual) * 100 : null;
}

function mean(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? sum(v.map(Math.abs)) / v.length : null;
}

/** Refit on every job but one, predict the one left out. Wire is predicted
 *  END TO END (counts → EMT → wire), the way a live bid gets it. */
export function leaveOneOut(jobs: BomFootageJob[], model: 'pooled' | 'per_kind'): LooReport {
  const rows: LooRow[] = jobs.map(held => {
    const r = fitWithModel(jobs.filter(j => j !== held), model);
    const emt = predictEmt(r.emtPerPoint, held.points);
    const wire = emt * r.wirePerConduitFt;
    const mc = r.mcPerFixture * held.points.fixture;
    const pvc = held.points.pole > 0 && r.pvcJobs > 0 ? r.pvcSitePerPole * held.points.pole : null;
    const actualWire = held.wire12Ft + held.wire10Ft;
    return {
      job: held.job,
      actual: { emtFt: held.emtFt, mcFt: held.mcFt, wireFt: actualWire, pvcSiteFt: held.pvcSiteFt },
      predicted: { emtFt: emt, mcFt: mc, wireFt: wire, pvcSiteFt: pvc },
      errorPct: {
        emt: pctErr(emt, held.emtFt),
        mc: pctErr(mc, held.mcFt),
        wire: pctErr(wire, actualWire),
        pvcSite: pvc != null ? pctErr(pvc, held.pvcSiteFt) : null,
        mcLuminaire: pctErr(r.mcPerLuminaire * (held.luminaires ?? 0), held.mcFt),
      },
    };
  });
  return {
    model,
    rows,
    mae: {
      emt: mean(rows.map(r => r.errorPct.emt)) ?? 0,
      mc: mean(rows.map(r => r.errorPct.mc)) ?? 0,
      wire: mean(rows.map(r => r.errorPct.wire)) ?? 0,
      pvcSite: mean(rows.map(r => r.errorPct.pvcSite)),
      mcLuminaire: mean(rows.map(r => r.errorPct.mcLuminaire ?? null)) ?? 0,
    },
  };
}

export interface FootageCalibration {
  ratios: FittedFootageRatios;
  loo: LooReport;
  /** The losing EMT model's leave-one-out, for the report. */
  alternative: LooReport;
  jobs: BomFootageJob[];
}

/** Fit on every job; the EMT model (pooled vs per-kind) is whichever has the
 *  lower leave-one-out EMT error — never the one that merely fits best
 *  in-sample. */
export function calibrateFootage(jobs: BomFootageJob[]): FootageCalibration {
  const pooled = leaveOneOut(jobs, 'pooled');
  const perKind = leaveOneOut(jobs, 'per_kind');
  const winner = perKind.mae.emt < pooled.mae.emt ? perKind : pooled;
  const loser = winner === pooled ? perKind : pooled;
  return { ratios: fitWithModel(jobs, winner.model), loo: winner, alternative: loser, jobs };
}
