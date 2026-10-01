// Accuracy round C5 — a feeder's route and length. Pure.
//   frame: both endpoints on one sheet → that sheet; two sheets of one level
//          → the sheets' alignment (sheetRelation.alignSheets); anything
//          else → a hold ("endpoints on different sheets — pin both on one
//          sheet").
//   horizontal: interior = Manhattan (x then y) × ft/pt; site/underground =
//          straight line × siteRouteFactor (1.15).
//   vertical (app_settings est_feeder_estimate, editable): gear exit 7 ft
//          AFF up to the deck (Agent 1 / job-profile deck height, else 14 ft,
//          flagged); roof equipment + 3 ft penetration; wall equipment
//          mounted at 5 ft; underground = 2 ft burial + 3 ft stub-up per end;
//          two pieces of gear within 15 ft run at the gear (no rise);
//          3 ft makeup per end.
//   slack: est_default_slack_pct.
// The math string is always returned — every priced length shows it.
import type { FeederEdge } from './feederGraph';
import type { Endpoint, EndpointHold } from './feederEndpoints';
import { isEndpoint, type NodeLocation } from './feederEndpoints';
import type { SheetScale } from './sheetScale';
import { describeScale } from './sheetScale';
import { alignSheets, mainPlanPosition, type RelationSheet } from '../ai/evidence/sheetRelation';

export interface FeederEstimateSettings {
  version: 1;
  panelExitFt: number;
  defaultDeckFt: number;
  wallMountFt: number;
  roofPenetrationFt: number;
  burialFt: number;
  stubUpFt: number;
  makeupFt: number;
  siteRouteFactor: number;
  /** Two pieces of gear closer than this run at the gear (no rise to the deck). */
  adjacentGearFt: number;
  /** Gap-closing T4 (J4) — a labor adjustment on buried PVC (Chris: +25% Kissimmee, +5% Orlando, 0 elsewhere).
   *  Default 0 = no row; Q12 decides. */
  undergroundLaborAdjPct: number;
}

export const DEFAULT_FEEDER_ESTIMATE: FeederEstimateSettings = {
  version: 1, panelExitFt: 7, defaultDeckFt: 14, wallMountFt: 5, roofPenetrationFt: 3,
  burialFt: 2, stubUpFt: 3, makeupFt: 3, siteRouteFactor: 1.15, adjacentGearFt: 15, undergroundLaborAdjPct: 0,
};

export function parseFeederEstimateSettings(raw: string | null | undefined): FeederEstimateSettings {
  if (!raw) return { ...DEFAULT_FEEDER_ESTIMATE };
  try {
    const j = JSON.parse(raw) as Partial<FeederEstimateSettings>;
    const out = { ...DEFAULT_FEEDER_ESTIMATE };
    for (const k of Object.keys(DEFAULT_FEEDER_ESTIMATE) as Array<keyof FeederEstimateSettings>) {
      if (k === 'version') continue;
      const v = Number(j[k]);
      if (Number.isFinite(v) && v >= 0) (out[k] as number) = v;
    }
    return out;
  } catch { return { ...DEFAULT_FEEDER_ESTIMATE }; }
}

/** What PUT /api/settings accepts for est_feeder_estimate. */
export function validateFeederEstimateJson(raw: unknown): string[] {
  if (typeof raw !== 'string') return ['must be a JSON string'];
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return ['is not valid JSON']; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['must be a JSON object'];
  const errs: string[] = [];
  for (const k of Object.keys(DEFAULT_FEEDER_ESTIMATE) as Array<keyof FeederEstimateSettings>) {
    if (k === 'version') continue;
    const v = (o as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${k} must be a number`);
    else if (v < 0) errs.push(`${k} must be at least 0`);
    else if (k === 'undergroundLaborAdjPct' && v > 100) errs.push('undergroundLaborAdjPct must be at most 100');
  }
  return errs;
}

export interface RouteInput {
  edge: FeederEdge;
  from: Endpoint | EndpointHold | undefined;
  to: Endpoint | EndpointHold | undefined;
  scales: Map<string, SheetScale>;
  /** Count sheets for cross-sheet alignment (key, label, geometry, viewports, marks). */
  relationSheets?: Map<string, RelationSheet>;
  /** Sheets that are site / civil plans (underground routing). */
  siteSheets?: Set<string>;
  settings: FeederEstimateSettings;
  slackPct: number;
  deckFt: number | null;
  labelOf?: (sheetKey: string) => string;
  /** Gap-closing T4 — Agent 1's exterior / interior per node (nodeLocations). */
  locations?: Map<string, NodeLocation>;
}

export interface FeederQuantities { conduitFt: number; conductors: Array<{ size: string; ground: boolean; count: number; ft: number }> }

export interface FeederRoute {
  edgeId: string;
  status: 'estimated' | 'hold';
  holds: string[];
  lengthFt: number | null;
  tier: 'confirmed' | 'suggested' | 'unverified' | null;
  underground: boolean;
  frameSheetKey: string | null;
  routePoints: Array<{ x: number; y: number }>;
  math: string;
  quantities: FeederQuantities | null;
  /** C7 "Adopt as run" — the vertical ft and makeup ft inside lengthFt (before slack). */
  verticalFt?: number;
  makeupFt?: number;
}

const GEAR_RE = /^(PANEL|DISCON|WIREWAY|METER|MDP)\b/;

/** Gap-closing T4 (J3) — one end is Exterior / NEMA 3R and the other is not (both stated): the feeder passes
 *  through the wall, so the adjacent-gear shortcut never applies (Chris ≈ 33 ft per DISCON → PANEL feeder). */
function wallCrossing(inp: RouteInput): string | null {
  const a = inp.locations?.get(inp.edge.from), b = inp.locations?.get(inp.edge.to);
  if (!a || !b || a.exterior === b.exterior) return null;
  const ext = a.exterior ? [inp.edge.from, a] as const : [inp.edge.to, b] as const;
  const int = a.exterior ? [inp.edge.to, b] as const : [inp.edge.from, a] as const;
  return `${ext[0]} "${ext[1].quote}", ${int[0]} "${int[1].quote}"`;
}
const ROOF_RE = /^(RTU|EF|MAU|ERV)-/;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

export function routeFeeder(inp: RouteInput): FeederRoute {
  const { edge, settings: s } = inp;
  const lab = inp.labelOf ?? ((k: string) => k);
  const base: FeederRoute = { edgeId: edge.id, status: 'hold', holds: [], lengthFt: null, tier: null, underground: false, frameSheetKey: null, routePoints: [], math: '', quantities: null };
  if (!edge.spec) base.holds.push(`needs size: no conduit/conductor spec for ${edge.from} → ${edge.to}`);
  for (const [side, e] of [[edge.from, inp.from], [edge.to, inp.to]] as const) if (!isEndpoint(e)) base.holds.push(`needs: ${side} location — ${e?.hold ?? `Pin ${side} on the Plans view`}`);
  if (!isEndpoint(inp.from) || !isEndpoint(inp.to)) { base.math = base.holds.join('; '); return base; }
  const a = inp.from, b = inp.to;

  // Frame.
  let frame = a.sheetKey;
  let pa = { x: a.x, y: a.y }, pb = { x: b.x, y: b.y };
  let frameNote = '';
  if (a.sheetKey !== b.sheetKey) {
    const sa = inp.relationSheets?.get(a.sheetKey), sb = inp.relationSheets?.get(b.sheetKey);
    const al = sa && sb ? alignSheets(sa, sb) : null;
    const ia = sa ? mainPlanPosition({ typeKey: '', x: a.x, y: a.y }, sa) : null;
    const ib = sb ? mainPlanPosition({ typeKey: '', x: b.x, y: b.y }, sb) : null;
    if (!al || !ia || !ib || inp.siteSheets?.has(a.sheetKey) !== inp.siteSheets?.has(b.sheetKey)) {
      base.holds.push(`endpoints on different sheets (${lab(a.sheetKey)}, ${lab(b.sheetKey)}) — pin both on one sheet`);
      base.math = base.holds.join('; ');
      return base;
    }
    // Work in sheet A's displayed inches → points (distances only).
    const mb = al.map(ib);
    pa = { x: ia.x * 72, y: ia.y * 72 };
    pb = { x: mb.x * 72, y: mb.y * 72 };
    frameNote = ` (${lab(b.sheetKey)} aligned onto ${lab(a.sheetKey)}: ${al.note})`;
  }
  const scale = inp.scales.get(frame);
  if (!scale || scale.tier === 'unverified' || scale.ftPerPt == null) {
    base.holds.push(`needs scale: confirm the scale on ${lab(frame)}${scale ? ` (${scale.basis})` : ''}`);
    base.tier = scale?.tier ?? 'unverified';
    base.math = base.holds.join('; ');
    return base;
  }
  if (base.holds.length) { base.tier = scale.tier; base.math = base.holds.join('; '); return base; }

  const underground = edge.kind === 'service_lateral' || !!inp.siteSheets?.has(frame);
  const ftPerPt = scale.ftPerPt;
  let horizPt: number; let horizText: string; let horizFt: number;
  if (underground) {
    horizPt = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    horizFt = horizPt * ftPerPt * s.siteRouteFactor;
    horizText = `straight ${r0(horizPt)} pt × ${ftPerPt.toFixed(4)} ft/pt × ${s.siteRouteFactor} route factor = ${r1(horizFt)} ft`;
  } else {
    horizPt = Math.abs(pb.x - pa.x) + Math.abs(pb.y - pa.y);
    horizFt = horizPt * ftPerPt;
    horizText = `Manhattan ${r0(horizPt)} pt × ${ftPerPt.toFixed(4)} ft/pt = ${r1(horizFt)} ft`;
  }
  // Vertical.
  const deck = inp.deckFt ?? s.defaultDeckFt;
  const deckNote = inp.deckFt != null ? `deck ${deck} ft` : `deck ${deck} ft default`;
  const parts: string[] = [];
  let vert = 0;
  if (underground) {
    const v = 2 * (s.burialFt + s.stubUpFt);
    vert += v; parts.push(`underground 2 × (${s.burialFt} ft burial + ${s.stubUpFt} ft stub-up) = ${v} ft`);
  } else if (GEAR_RE.test(edge.from) && GEAR_RE.test(edge.to) && horizFt < s.adjacentGearFt && !wallCrossing(inp)) {
    // DEVIATION from the plan (Builder P's addition, review nit): two pieces of gear within adjacentGearFt (15 ft) run
    // at the gear with no rise, so a disconnect beside its panel does not climb to the deck and back. The gap
    // analysis shows it gives 16 / 11 ft against Chris's ~33 ft for an exterior disconnect → interior panel (the
    // wall crossing); there is no wall information to apply it only when both ends are on the same side of a wall.
    parts.push(`adjacent gear (< ${s.adjacentGearFt} ft) — run at the gear, no rise`);
  } else {
    const wc = wallCrossing(inp);
    if (wc) parts.push(`exterior → interior: through the wall and over (Q2) — ${wc}`);
    const end = (node: string) => {
      if (GEAR_RE.test(node)) { const v = Math.max(0, deck - s.panelExitFt); vert += v; parts.push(`${node} rise ${v} ft (${deckNote} − ${s.panelExitFt} ft exit)`); }
      else if (ROOF_RE.test(node)) { vert += s.roofPenetrationFt; parts.push(`${node} roof ${s.roofPenetrationFt} ft`); }
      else { const v = Math.max(0, deck - s.wallMountFt); vert += v; parts.push(`${node} drop ${v} ft (${deckNote} − ${s.wallMountFt} ft mount)`); }
    };
    end(edge.from); end(edge.to);
  }
  const makeup = 2 * s.makeupFt;
  parts.push(`makeup 2 × ${s.makeupFt} ft`);
  const raw = horizFt + vert + makeup;
  const lengthFt = r0(raw * (1 + inp.slackPct / 100));
  const spec = edge.spec!;
  const conduitFt = lengthFt * spec.sets;
  const conductors = spec.conductors.map(c => ({ size: c.size, ground: c.ground, count: c.count, ft: lengthFt * c.count }));
  const conduitName = underground ? `${spec.conduit ?? '?'} PVC` : `${spec.conduit ?? '?'} EMT`;
  const endText = (e: Endpoint) => `${e.node} (${lab(e.sheetKey)}, ${e.note})`;
  const math = `${endText(a)} → ${endText(b)}: ${horizText}${frameNote} [${describeScale(scale)}] + ${parts.join(' + ')} = ${r1(raw)} ft × ${(1 + inp.slackPct / 100).toFixed(2)} slack = ${lengthFt} ft`
    + ` → ${conduitName} ${conduitFt} ft${spec.sets > 1 ? ` (${spec.sets} parallel sets)` : ''}, ${conductors.map(c => `#${c.size}${c.ground ? ' G' : ''} ${c.ft} ft`).join(', ')}.`;
  // Gap-closing T13 — a `suggested` endpoint (an unlabeled panel mark) is never more than a suggestion.
  const tier = (a.confidence === 'suggested' || b.confidence === 'suggested') && scale.tier === 'confirmed' ? 'suggested' : scale.tier;
  return {
    edgeId: edge.id, status: 'estimated', holds: [], lengthFt, tier, underground, frameSheetKey: frame,
    // Drawn only for a one-sheet route (a cross-sheet length is confirmed, not adopted as a run).
    routePoints: a.sheetKey !== b.sheetKey ? [] : underground ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }],
    math, quantities: { conduitFt, conductors }, verticalFt: vert, makeupFt: makeup,
  };
}
