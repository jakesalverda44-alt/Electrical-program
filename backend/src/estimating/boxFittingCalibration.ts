// Price accuracy round, C3 — boxes, rings, fittings and support hardware,
// calibrated on Chris's five real BOMs. Our estimate carried almost none of
// these hours (36th Street: boxes & rings 12.9 h, fittings ~14 h and
// hardware ~24 h on Chris's BOM against ~0 on ours). They become allowance
// LINES tied to what drives them — the takeoff's device/fixture points and
// its conduit footage — never a percentage of price:
//   * box sets (box + plaster ring or cover + bracket + ground screw) per point
//   * fittings (couplings, connectors, straps, elbows, bushings, locknuts)
//     per 100 ft of each raceway: EMT, PVC, MC/flex
//   * support hardware (anchors, screws, clips, hangers, chain, ceiling wire,
//     strut clamps, cable ties) per 100 ft of conduit plus per fixture.
// The seed EMT and PVC items are "incl. couplings/straps" / "incl.
// fittings/glue" — their rate is above Chris's bare-conduit rate by the
// fittings they already carry — so the EMT/PVC fitting HOURS here are the
// residual Chris carries on top of that (never counted twice).
// Pure: fixtures in, numbers out. boxFittingCalibration.test.ts re-derives
// DEFAULT_BOX_FITTING_RATES from the BOM fixtures and pins the LOO error.
import type { ParsedBom, BomRow } from './accubidBom';
import { classifyPointText, nnlsThroughOrigin } from './footageCalibration';
import { SEED_ITEMS } from './seed/laborUnits';

export type BfGroup = 'box' | 'fitEmt' | 'fitPvc' | 'fitMc' | 'hardware' | 'splice';
export const BF_GROUPS: BfGroup[] = ['box', 'fitEmt', 'fitPvc', 'fitMc', 'hardware', 'splice'];

const BOX_RE = /square box|box cover|plaster ring|mounting bracket|ground screw|handy box|device box|octagon box|box extension|mud ring|switch box|gangable box|masonry box|raised cover|industrial cover/i;
const HARDWARE_RE = /anchor|screw|\bbolt\b|\bnut\b|washer|ceiling wire|\bchain\b|s-hook|hanger|\bclip\b|strut clamp|beam clamp|cable tie|threaded rod|all ?thread|unistrut|\bstrut\b|purlin|tie wire|\bsupport\b/i;
const FITTING_RE = /coupling|connector|bushing|locknut|elbow|conduit body|\blb\b|expansion (?:fitting|coupling)|strap\s*-|1-hole strap|2-hole strap|offset|nipple|\bfitting|pvc cement|\bglue\b/i;
const NOT_FITTING_RE = /wire connector|twist-on|\blug\b|terminal|splice|wire nut/i;
/** C7 — twist-on wire connectors (splices at every box): the one fitting-
 *  like consumable Chris carries per termination, not per raceway foot. */
const SPLICE_RE = /wire connector|wire nut|wire splice|\bsplice\b/i;

/** Which C3 group a BOM row belongs to, or null (everything else). */
export function bfGroupOf(description: string): BfGroup | null {
  // "3/4\" EMT (incl. couplings/straps)" is conduit: the qualifier names what
  // the conduit's price bundles in, never the item itself.
  const d = (description ?? '').replace(/\((?:incl\.?|including)[^)]*\)|\b(?:incl\.?|including|w\/|with)\s+(?:fittings?|couplings?|straps?|glue)(?:\s*[\/,]\s*(?:fittings?|couplings?|straps?|glue))*/gi, ' ');
  if (/demolition/i.test(d)) return null;
  if (BOX_RE.test(d)) return 'box';
  if (SPLICE_RE.test(d)) return 'splice';
  // Pole-base anchor bolts are site work (the pole base), not support hardware.
  if (/anchor bolt/i.test(d)) return null;
  // A fitting first: "Coupling - EMT Set Screw Steel" is a coupling, not a screw.
  if (FITTING_RE.test(d) && !NOT_FITTING_RE.test(d) && !/anchor|cable tie|\bclip\b|strut clamp|hanger/i.test(d)) {
    if (/\bpvc\b/i.test(d)) return 'fitPvc';
    if (/\bmc\b|ac-90|\bflex\b|\bfmc\b|liquidtight|\blfmc\b/i.test(d)) return 'fitMc';
    return 'fitEmt';
  }
  if (HARDWARE_RE.test(d)) return 'hardware';
  return null;
}

export interface BfJob {
  job: string;
  points: { fixture: number; device: number; equipment: number };
  /** Raceway footage in 100-ft units. */
  emtC: number;
  pvcC: number;
  /** MC cable + flexible conduit (FMC/LFMC), 100-ft units. */
  mcC: number;
  hours: Record<BfGroup, number>;
  material: Record<BfGroup, number>;
  /** Hours the seed EMT/PVC items already carry above Chris's bare conduit
   *  rate on this job's own footage (their built-in fittings). */
  seedBuiltIn: { emt: number; pvc: number };
}

const SIZE_RE = /^\s*((?:\d+-)?\d+(?:\/\d+)?)"/;
function seedRate(kind: 'EMT' | 'PVC', size: string): number | null {
  const label = kind === 'EMT' ? 'EMT (incl. couplings/straps)' : 'PVC';
  const hit = SEED_ITEMS.find(i => i.unit === 'C' && i.name.startsWith(`${size}" `) && i.name.includes(label));
  return hit ? hit.laborHours : null;
}

function zero(): Record<BfGroup, number> { return { box: 0, fitEmt: 0, fitPvc: 0, fitMc: 0, hardware: 0, splice: 0 }; }

export function extractBfJob(job: string, bom: ParsedBom): BfJob {
  const points = { fixture: 0, device: 0, equipment: 0 };
  const hours = zero();
  const material = zero();
  let emtC = 0; let pvcC = 0; let mcC = 0;
  const seedBuiltIn = { emt: 0, pvc: 0 };
  for (const r of bom.rows as BomRow[]) {
    const d = r.description;
    const conduit = d.match(/Conduit\s*-\s*(EMT|PVC|FMC|LFMC|RMC|RGD|IMC)\b/i);
    if (conduit) {
      const kind = conduit[1].toUpperCase();
      const size = d.match(SIZE_RE)?.[1] ?? null;
      const c = r.qty / 100;
      if (kind === 'EMT' || kind === 'PVC') {
        if (kind === 'EMT') emtC += c; else pvcC += c;
        const seed = size ? seedRate(kind, size) : null;
        if (seed != null && r.laborUnit != null) seedBuiltIn[kind === 'EMT' ? 'emt' : 'pvc'] += Math.max(0, seed - r.laborUnit) * c;
      } else if (kind === 'FMC' || kind === 'LFMC') mcC += c;
      continue;
    }
    if (/mc cable/i.test(d)) { mcC += r.qty / 100; continue; }
    const g = bfGroupOf(d);
    if (g) {
      hours[g] += r.totalFieldLaborHours ?? 0;
      material[g] += r.totalMaterial ?? 0;
      continue;
    }
    const kind = classifyPointText(d);
    if (kind === 'fixture' || kind === 'device' || kind === 'equipment') points[kind] += r.qty;
  }
  return { job, points, emtC, pvcC, mcC, hours, material, seedBuiltIn };
}

// ── The fitted rates ────────────────────────────────────────────────────────

export interface BoxFittingRates {
  /** Box sets per point, by point kind (hours / material per point). */
  boxPerPoint: { fixture: { hours: number; material: number }; device: { hours: number; material: number }; equipment: { hours: number; material: number } };
  /** Per 100 ft of each raceway. EMT/PVC hours are net of the seed item's
   *  built-in fittings. */
  fitEmtPerC: { hours: number; material: number };
  fitPvcPerC: { hours: number; material: number };
  fitMcPerC: { hours: number; material: number };
  /** Support hardware: per 100 ft of branch conduit (EMT + MC/flex) and per fixture. */
  hardwarePerConduitC: { hours: number; material: number };
  hardwarePerFixture: { hours: number; material: number };
  /** Twist-on wire connectors per point (every point's box has splices). */
  splicePerPoint: { hours: number; material: number };
}

function sum(xs: number[]): number { return xs.reduce((s, x) => s + x, 0); }
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export type BoxModel = 'pooled' | 'per_kind';

function fitBox(jobs: BfJob[], model: BoxModel): BoxFittingRates['boxPerPoint'] {
  const pts = (j: BfJob) => j.points.fixture + j.points.device + j.points.equipment;
  if (model === 'pooled') {
    const h = ratio(sum(jobs.map(j => j.hours.box)), sum(jobs.map(pts)));
    const m = ratio(sum(jobs.map(j => j.material.box)), sum(jobs.map(pts)));
    return { fixture: { hours: h, material: m }, device: { hours: h, material: m }, equipment: { hours: h, material: m } };
  }
  const X = jobs.map(j => [j.points.fixture, j.points.device + j.points.equipment]);
  const ch = nnlsThroughOrigin(X, jobs.map(j => j.hours.box));
  const cm = nnlsThroughOrigin(X, jobs.map(j => j.material.box));
  return { fixture: { hours: ch[0], material: cm[0] }, device: { hours: ch[1], material: cm[1] }, equipment: { hours: ch[1], material: cm[1] } };
}

const conduitC = (j: BfJob) => j.emtC + j.mcC;

export function fitRates(jobs: BfJob[], boxModel: BoxModel): BoxFittingRates {
  const X = jobs.map(j => [conduitC(j), j.points.fixture]);
  const hh = nnlsThroughOrigin(X, jobs.map(j => j.hours.hardware));
  const hm = nnlsThroughOrigin(X, jobs.map(j => j.material.hardware));
  return {
    boxPerPoint: fitBox(jobs, boxModel),
    fitEmtPerC: {
      hours: Math.max(0, ratio(sum(jobs.map(j => j.hours.fitEmt - j.seedBuiltIn.emt)), sum(jobs.map(j => j.emtC)))),
      material: ratio(sum(jobs.map(j => j.material.fitEmt)), sum(jobs.map(j => j.emtC))),
    },
    fitPvcPerC: {
      hours: Math.max(0, ratio(sum(jobs.map(j => j.hours.fitPvc - j.seedBuiltIn.pvc)), sum(jobs.map(j => j.pvcC)))),
      material: ratio(sum(jobs.map(j => j.material.fitPvc)), sum(jobs.map(j => j.pvcC))),
    },
    fitMcPerC: {
      hours: ratio(sum(jobs.map(j => j.hours.fitMc)), sum(jobs.map(j => j.mcC))),
      material: ratio(sum(jobs.map(j => j.material.fitMc)), sum(jobs.map(j => j.mcC))),
    },
    hardwarePerConduitC: { hours: hh[0], material: hm[0] },
    hardwarePerFixture: { hours: hh[1], material: hm[1] },
    splicePerPoint: {
      hours: ratio(sum(jobs.map(j => j.hours.splice)), sum(jobs.map(j => j.points.fixture + j.points.device + j.points.equipment))),
      material: ratio(sum(jobs.map(j => j.material.splice)), sum(jobs.map(j => j.points.fixture + j.points.device + j.points.equipment))),
    },
  };
}

/** Hours a job's drivers predict, per group (fittings net of the seed's
 *  built-in share, the way a live bid prices them). */
export type BfReportGroup = 'box' | 'fittings' | 'hardware' | 'splice';
export function predictHours(r: BoxFittingRates, j: Pick<BfJob, 'points' | 'emtC' | 'pvcC' | 'mcC'>): Record<BfReportGroup, number> {
  return {
    splice: r.splicePerPoint.hours * (j.points.fixture + j.points.device + j.points.equipment),
    box: r.boxPerPoint.fixture.hours * j.points.fixture + r.boxPerPoint.device.hours * j.points.device + r.boxPerPoint.equipment.hours * j.points.equipment,
    fittings: r.fitEmtPerC.hours * j.emtC + r.fitPvcPerC.hours * j.pvcC + r.fitMcPerC.hours * j.mcC,
    hardware: r.hardwarePerConduitC.hours * (j.emtC + j.mcC) + r.hardwarePerFixture.hours * j.points.fixture,
  };
}

/** What Chris actually carried, per group, on the same (net) basis. */
export function actualHours(j: BfJob): Record<BfReportGroup, number> {
  return {
    splice: j.hours.splice,
    box: j.hours.box,
    fittings: Math.max(0, j.hours.fitEmt - j.seedBuiltIn.emt) + Math.max(0, j.hours.fitPvc - j.seedBuiltIn.pvc) + j.hours.fitMc,
    hardware: j.hours.hardware,
  };
}

export interface BfLooRow {
  job: string;
  actual: Record<BfReportGroup, number>;
  predicted: Record<BfReportGroup, number>;
  errorPct: Record<BfReportGroup | 'total', number>;
}
export interface BfLoo { boxModel: BoxModel; rows: BfLooRow[]; mae: Record<BfReportGroup | 'total', number> }

const pct = (p: number, a: number) => (a > 0 ? ((p - a) / a) * 100 : 0);

export function leaveOneOutBf(jobs: BfJob[], boxModel: BoxModel): BfLoo {
  const rows = jobs.map(held => {
    const r = fitRates(jobs.filter(j => j !== held), boxModel);
    const predicted = predictHours(r, held);
    const actual = actualHours(held);
    const tp = predicted.box + predicted.fittings + predicted.hardware + predicted.splice;
    const ta = actual.box + actual.fittings + actual.hardware + actual.splice;
    return {
      job: held.job, actual, predicted,
      errorPct: {
        box: pct(predicted.box, actual.box), fittings: pct(predicted.fittings, actual.fittings), hardware: pct(predicted.hardware, actual.hardware),
        splice: pct(predicted.splice, actual.splice), total: pct(tp, ta),
      },
    };
  });
  const mae = (k: keyof BfLooRow['errorPct']) => sum(rows.map(r => Math.abs(r.errorPct[k]))) / Math.max(1, rows.length);
  return { boxModel, rows, mae: { box: mae('box'), fittings: mae('fittings'), hardware: mae('hardware'), splice: mae('splice'), total: mae('total') } };
}

export interface BfCalibration { rates: BoxFittingRates; loo: BfLoo; alternative: BfLoo; jobs: BfJob[] }

/** The box model (one rate per point vs fixture/device rates) is whichever
 *  predicts the held-out job better — never the better in-sample fit. */
export function calibrateBoxFittings(jobs: BfJob[]): BfCalibration {
  const pooled = leaveOneOutBf(jobs, 'pooled');
  const perKind = leaveOneOutBf(jobs, 'per_kind');
  const win = perKind.mae.box < pooled.mae.box ? perKind : pooled;
  return { rates: fitRates(jobs, win.boxModel), loo: win, alternative: win === pooled ? perKind : pooled, jobs };
}
