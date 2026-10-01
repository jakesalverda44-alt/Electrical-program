// Accuracy round E1–E3 — site lighting circuits by geometry, pole bases,
// trenching. Pure. Runs on a bid still being estimated / a calibration job.
//   E1  panel → poles: the site sheet with the most counted pole marks at a
//       confirmed / suggested scale; the building = the extent of the
//       building-mounted fixture marks on that sheet (>= 3); entry = the
//       building edge point nearest the first pole; then a nearest-neighbour
//       chain through the poles, straight × the site route factor, + 2 ×
//       (burial + stub-up) per pole and one at the building. The interior
//       part (panel → that wall) comes off the panel's position on its own
//       sheet when it is located (flagged approximate), else it is left out
//       (said so). Conductors: the site circuits in Agent 1's panel schedule
//       (+ N + G), else 2#10 + #10G ("default — confirm"). Resolved, the
//       rows replace the ratio's site PVC row (one source).
//   E2  pole bases: base by others / anchor bolts installed by EC → an
//       anchor-bolt set per pole; EC pours → the pole-base assembly when the
//       library has one; otherwise a visible question.
//   E3  trenching = the site route LF, a line EXCLUDED by default ("Chris
//       carries no trenching on 5 of 5 BOMs — include if EC trenches").
import type { FeederEstimateResult } from './feederEstimate';
import type { FeederEstimateSettings } from './feederRoute';
import type { GeneratedTakeoffRow } from './footageAllowance';
import { SITE_CATEGORY } from './feederRows';
import { displayedToPdf, normalizeRotation } from './pageGeometry';

export interface SiteRow extends Omit<GeneratedTakeoffRow, 'unit' | 'qty'> {
  unit: 'LF' | 'EA';
  qty: number;
  libraryCode?: string | null;
  excluded?: boolean;
}

export interface SiteGeometryInput {
  feeders: FeederEstimateResult;
  countResult: { types?: Array<{ key: string; category?: string; status?: string; count?: number }>; marks?: Array<{ typeKey: string; sheetKey: string; x: number; y: number }> } | null;
  agent1: { panelCircuits?: Array<{ panel?: string; circuit?: string; description?: string }> | null; scopeNotes?: string[] | null } | null;
  /** Texts that may say who provides the pole bases (Agent 1 / Agent 2 notes, scope, exclusions). */
  texts: string[];
  /** The takeoff rows after the pre-mapping decisions (site pole rows carry LTG-POLE*). */
  takeoffRows: Array<{ item: string; qty: number | string; libraryCode?: string | null; note?: string | null }>;
  settings: FeederEstimateSettings;
  resolveName: (name: string) => boolean;
  /** Fix round B3 — one source per scope: 3 = the ratio carries the site run (the geometry replaces it);
   *  1 = the estimator typed / measured site footage; 2 = Agent 2 read a site footage. With 1 or 2 the
   *  geometry rows are shown at 0 and never counted a second time. */
  siteScope?: { source: 1 | 2 | 3; detail: string };
  /** Gap-closing T6 — the vector sheets' text runs (registering a service corner on another site sheet). */
  textSheets?: Array<{ sheetKey: string; geometry: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number }; runs: Array<{ str: string; x: number; y: number }> }>;
  /** Fix round 2 / N1 — the length the estimator typed on the geometry PVC line (qty overridden / measured):
   *  the #10 wire is derived from it (typed ft x conductors), the way a feeder's wire follows its typed run. */
  typedRunFt?: number | null;
}

export interface SiteGeometryResult {
  rows: SiteRow[];
  /** True when E1's geometry rows carry the site PVC (the ratio row goes to 0). */
  replacesRatioPvc: boolean;
  routeFt: number | null;
  holds: string[];
  math: string;
}

const PVC_1 = '1" PVC Sch 40 (incl. fittings/glue)';
const W10 = '#10 THHN/THWN copper conductor';
const r0 = (n: number) => Math.round(n);

/** Distinct site-lighting circuits in the panel schedule (excluding circuits
 *  another entry says are building-mounted lights). */
export function siteCircuits(pc: NonNullable<SiteGeometryInput['agent1']>['panelCircuits']): { panel: string | null; circuits: string[] } {
  const rows = pc ?? [];
  const nums = (c: string) => (c.match(/\d{1,2}/g) ?? []).map(Number);
  const site = new Set<number>(), notSite = new Set<number>();
  let panel: string | null = null;
  for (const r of rows) {
    const d = String(r.description ?? '');
    const ns = nums(String(r.circuit ?? ''));
    if (/site light/i.test(d)) { ns.forEach(n => site.add(n)); panel = panel ?? (r.panel ?? null); }
    else if (ns.length === 1 && /soffit|wall ?pack|downlight|building/i.test(d)) notSite.add(ns[0]);
  }
  const circuits = [...site].filter(n => !notSite.has(n)).sort((a, b) => a - b).map(n => `${panel ?? ''}-${n}`);
  return { panel, circuits };
}

export function siteGeometryRows(inp: SiteGeometryInput): SiteGeometryResult {
  const holds: string[] = [];
  const rows: SiteRow[] = [];
  const cr = inp.countResult ?? {};
  const s = inp.settings;
  // Positions are positions: a merged photometric twin's marks still show
  // where the fixture is (W1/W2 merged into the E-sheet D/L types).
  const poleTypes = new Set((cr.types ?? []).filter(t => t.category === 'site_lighting').map(t => t.key));
  const bldgTypes = new Set((cr.types ?? []).filter(t => t.category === 'exterior_building').map(t => t.key));
  const poles = Σpoles(inp.takeoffRows);

  // E2 — pole bases.
  if (poles > 0) {
    const t = inp.texts.join(' \n ');
    const pours = /\b(?:ec|electrical contractor|electrician|this contractor)\b[^.\n]{0,40}\b(?:pours?|provides?|forms?)\b[^.\n]{0,20}\b(?:pole\s+)?(?:bases|foundations)\b/i.test(t);
    const byOthers = /\b(?:pole\s+)?(?:bases|foundations)\b[^.\n]{0,20}\b(?:by|furnished by|provided by)\s+(?:others|g\.?c\.?|general contractor|owner)\b|anchor bolts?[^.\n]{0,60}\bec installs\b|\btemplates?[^.\n]{0,40}\bec installs\b/i.test(t);
    const verify = /verify who pours|confirm who provides pole bases|who (?:pours|provides) (?:the )?(?:pole )?bases/i.exec(t)?.[0];
    if (pours && inp.resolveName('pole base')) {
      rows.push({ category: SITE_CATEGORY, item: 'Pole bases — poured by EC', spec: 'pole base', qty: poles, unit: 'EA', confidence: 'APPROX', evidence: `The documents say the electrical contractor pours the bases — ${poles} pole bases.` });
    } else if (byOthers || pours) {
      rows.push({ category: 'Exterior Site Lighting', item: 'Pole anchor-bolt set + template (base by others)', spec: 'Pole anchor-bolt set + template, base by others (Chris BOM)', libraryCode: 'POLE-ANCHOR', qty: poles, unit: 'EA', confidence: 'APPROX',
        evidence: `Anchor bolts / templates set by EC on bases by others — ${poles} poles × Chris's 0.7 h template + 4 × 0.12 h bolts.${verify ? ` The documents also say "${verify}" — confirm.` : ''}` });
    } else {
      rows.push({ category: 'Exterior Site Lighting', item: 'Pole bases — who pours them?', spec: 'NEEDS ANSWER — pole bases', qty: poles, unit: 'EA', confidence: 'APPROX', evidence: `Who pours the pole bases? Nothing in the documents says (${poles} poles). Answer: anchor bolts only (base by others) or the pole-base assembly.` });
    }
  }

  // E1 — site circuits by geometry.
  let math = '';
  let routeFt: number | null = null;
  const marks = (cr.marks ?? []);
  const cands = inp.feeders.siteSheets
    .map(k => ({ k, scale: inp.feeders.scaleBySheet[k], poles: marks.filter(m => m.sheetKey === k && poleTypes.has(m.typeKey)) }))
    .filter(c => c.poles.length && c.scale && c.scale.tier !== 'unverified' && c.scale.ftPerPt != null)
    .sort((a, b) => b.poles.length - a.poles.length);
  const best = cands[0];
  const label = (k: string) => (inp.feeders.sheetOf[k]?.label ?? k).replace(/\s+".*$/, '');
  if (!best) holds.push('needs: site poles on a scaled site sheet (a pole mark on a site plan with a confirmed or suggested scale)');
  const bldg = best ? marks.filter(m => m.sheetKey === best.k && bldgTypes.has(m.typeKey)) : [];
  if (best && bldg.length < 3) holds.push(`needs: the building outline on ${label(best.k)} (fewer than 3 building-mounted fixture marks)`);
  if (best && bldg.length >= 3) {
    const f = best.scale.ftPerPt!;
    const xs = bldg.map(m => m.x), ys = bldg.map(m => m.y);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const toEdge = (p: { x: number; y: number }) => {
      const cx = Math.min(Math.max(p.x, box.x0), box.x1), cy = Math.min(Math.max(p.y, box.y0), box.y1);
      if (cx !== p.x || cy !== p.y) return { x: cx, y: cy };
      const d = [p.x - box.x0, box.x1 - p.x, p.y - box.y0, box.y1 - p.y];
      const i = d.indexOf(Math.min(...d));
      return i === 0 ? { x: box.x0, y: p.y } : i === 1 ? { x: box.x1, y: p.y } : i === 2 ? { x: p.x, y: box.y0 } : { x: p.x, y: box.y1 };
    };
    const sc = siteCircuits(inp.agent1?.panelCircuits);
    // Gap-closing T6 — the start: the service corner (METER / XFMR / the site circuits' panel) on this sheet, or on
    // another site sheet registered onto it by their shared text; else today's entry (the building edge nearest the
    // first pole), flagged "start approximate".
    const startPick = serviceStart(inp, best.k, sc.panel);
    const entryFallback = (() => {
      const left = best.poles.map(p => ({ x: p.x, y: p.y }));
      const first = left.reduce((b, p) => (Math.hypot(toEdge(p).x - p.x, toEdge(p).y - p.y) < Math.hypot(toEdge(b).x - b.x, toEdge(b).y - b.y) ? p : b), left[0]);
      return toEdge(first);
    })();
    const start = startPick?.point ?? entryFallback;
    const startText = startPick ? startPick.text : 'building entry (start approximate — the service corner is not located on a site sheet)';
    // Radial when the panel schedule gives one site circuit per pole (Kissimmee A-15 / A-17 / A-19 = 209 / 418 / 209 VA):
    // each pole its own Manhattan homerun from the start + 2 × (burial + stub-up) + the interior run, 2#10 + #10G each.
    const radial = sc.circuits.length > 0 && sc.circuits.length >= best.poles.length;
    let pt = 0;
    const runs: number[] = [];
    if (radial) {
      for (const p of best.poles) { const d = Math.abs(p.x - start.x) + Math.abs(p.y - start.y); runs.push(d); pt += d; }
    } else {
      const left = best.poles.map(p => ({ x: p.x, y: p.y }));
      let cur = start;
      while (left.length) {
        let bi = 0;
        for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - cur.x, left[i].y - cur.y) < Math.hypot(left[bi].x - cur.x, left[bi].y - cur.y)) bi = i;
        const nxt = left.splice(bi, 1)[0];
        pt += Math.hypot(nxt.x - cur.x, nxt.y - cur.y);
        cur = nxt;
      }
    }
    const horiz = radial ? pt * f : pt * f * s.siteRouteFactor;
    const stubs = radial ? best.poles.length * 2 * (s.burialFt + s.stubUpFt) : (best.poles.length + 1) * (s.burialFt + s.stubUpFt);
    // Interior: the site circuits' panel to the nearest building edge on its own sheet.
    const panelNode = sc.panel ? `PANEL ${sc.panel}` : null;
    const pe = panelNode ? inp.feeders.endpointOf[panelNode] : undefined;
    let interior = 0; let interiorText = 'interior run (panel → building wall) not included — locate the panel on the Plans view';
    if (pe) {
      const ps = inp.feeders.scaleBySheet[pe.sheetKey];
      const pmarks = marks.filter(m => m.sheetKey === pe.sheetKey && !poleTypes.has(m.typeKey));
      if (ps?.ftPerPt && ps.tier !== 'unverified' && pmarks.length >= 10) {
        const bx = { x0: Math.min(...pmarks.map(m => m.x)), x1: Math.max(...pmarks.map(m => m.x)), y0: Math.min(...pmarks.map(m => m.y)), y1: Math.max(...pmarks.map(m => m.y)) };
        const dWall = Math.min(pe.x - bx.x0, bx.x1 - pe.x, pe.y - bx.y0, bx.y1 - pe.y);
        interior = Math.max(0, dWall) * ps.ftPerPt + Math.max(0, s.defaultDeckFt - s.panelExitFt) + s.makeupFt;
        interiorText = `interior ${panelNode} → nearest wall on ${label(pe.sheetKey)} ≈ ${r0(interior)} ft (approximate: nearest wall + rise + makeup)`;
      }
    }
    const interiorTotal = radial ? interior * best.poles.length : interior;
    routeFt = r0(horiz + stubs + interiorTotal);
    const n = sc.circuits.length;
    const conductors = radial ? 3 : n ? n + 2 : 3;
    const extra = radial && n > best.poles.length ? ` (${n - best.poles.length} more site circuit${n - best.poles.length === 1 ? '' : 's'} than poles — pylon / landscape — not included, Q3)` : '';
    const condText = radial ? `one site circuit per pole (${sc.circuits.slice(0, best.poles.length).join(', ')}): 2#10 + #10G per run${extra}`
      : n ? `${n} site circuits (${sc.circuits.join(', ')}) + N + G = ${conductors} #10` : '2#10 + #10G (default — confirm)';
    const resolved = inp.resolveName(PVC_1) && inp.resolveName(W10);
    math = radial
      ? `Site lighting from ${label(best.k)} (${best.scale.basis}): ${startText} → each of ${best.poles.length} poles its own homerun (radial, Manhattan): ${runs.map(d => `${r0(d * f)} ft`).join(' + ')} = ${r0(horiz)} ft (${r0(pt)} pt × ${f.toFixed(4)} ft/pt) + stub-ups ${best.poles.length} × 2 × (${s.burialFt} + ${s.stubUpFt}) = ${stubs} ft + ${interiorText}${interior ? ` × ${best.poles.length} runs` : ''} = ${routeFt} ft; ${condText}.`
      : `Site lighting from ${label(best.k)} (${best.scale.basis}): ${startText} → ${best.poles.length} poles nearest-first (one circuit feeds several poles: chained), ${r0(pt)} pt × ${f.toFixed(4)} ft/pt × ${s.siteRouteFactor} = ${r0(horiz)} ft + stub-ups ${best.poles.length + 1} × (${s.burialFt} + ${s.stubUpFt}) = ${stubs} ft + ${interiorText} = ${routeFt} ft; ${condText}.`;
    if (!resolved) holds.push('needs: library items for 1" PVC and #10 wire');
    else {
      const other = inp.siteScope && inp.siteScope.source !== 3 ? inp.siteScope : null;
      const gone = other ? `Replaced by ${other.source === 1 ? 'your own' : "Agent 2's"} site footage (${other.detail}) — set to 0 so the site run is never counted twice. The geometry estimate was ${routeFt} ft: ` : '';
      rows.push({ category: SITE_CATEGORY, item: 'Site lighting circuits — 1" PVC underground', spec: PVC_1, qty: other ? 0 : routeFt, unit: 'LF', confidence: 'APPROX', evidence: `${gone}Site geometry estimate (suggested — confirm): ${math}` });
      const typed = !other && inp.typedRunFt && inp.typedRunFt > 0 ? inp.typedRunFt : null;
      rows.push({ category: SITE_CATEGORY, item: `Site lighting circuits — #10 wire (${conductors} per run)`, spec: W10, qty: other ? 0 : (typed ?? routeFt) * conductors, unit: 'LF', confidence: 'APPROX',
        evidence: typed ? `Derived from your typed run on the site PVC line: ${typed} ft × ${conductors} conductors = ${typed * conductors} ft. The geometry estimate was ${routeFt} ft.` : `${gone}${routeFt} ft × ${conductors} conductors. ${math}` });
    }
  }

  // E3 — trenching, excluded by default.
  const underFeeders = inp.feeders.estimates.filter(e => e.route.status === 'estimated' && e.route.underground).reduce((t, e) => t + (e.route.lengthFt ?? 0), 0);
  // Review SF-B — the trench follows a run the estimator typed on the site PVC line.
  const typedRoute = routeFt != null && inp.typedRunFt && inp.typedRunFt > 0 && !(inp.siteScope && inp.siteScope.source !== 3) ? inp.typedRunFt : null;
  const trench = (typedRoute ?? routeFt ?? 0) + underFeeders;
  if (trench > 0) {
    rows.push({ category: SITE_CATEGORY, item: 'Trenching — site route', spec: 'Trenching & backfill allowance', qty: r0(trench), unit: 'LF', confidence: 'APPROX', excluded: true,
      evidence: `Trench = the site route ${typedRoute != null ? `${typedRoute} ft (your typed run)` : `${routeFt ?? 0} ft`} + underground feeders ${r0(underFeeders)} ft. Excluded by default: Chris carries no trenching on 5 of 5 BOMs — include if EC trenches.` });
  }
  return { rows, replacesRatioPvc: rows.some(r => r.item.startsWith('Site lighting circuits — 1"') && r.qty > 0), routeFt, holds, math: math || holds.join('; ') };
}

// ── Gap-closing T6 — the service corner on the pole sheet ───────────────────
type Geom = { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number };
function pdfToDisplayed(x: number, y: number, g: Geom): { x: number; y: number } {
  const rx = x - g.originX, ry = y - g.originY;
  switch (normalizeRotation(g.rotation)) {
    case 0: return { x: rx, y: g.heightPt - ry };
    case 90: return { x: ry, y: rx };
    case 180: return { x: g.widthPt - rx, y: ry };
    case 270: return { x: g.heightPt - ry, y: g.widthPt - rx };
  }
}

/** Two site sheets at the same scale registered by their shared unique text (building labels such as "BLDG. AREA =
 *  7,381 SQ. FT." drawn on both): the displayed offset b → a that at least 3 shared labels agree on (within 3 pt);
 *  a legend that sits elsewhere on one sheet disagrees and is outvoted. Null when fewer than 3 agree. */
export function registerByText(a: { runs: Array<{ str: string; x: number; y: number }> }, b: { runs: Array<{ str: string; x: number; y: number }> }): { dx: number; dy: number; labels: string[] } | null {
  const key = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase();
  const uniq = (runs: Array<{ str: string; x: number; y: number }>) => {
    const m = new Map<string, Array<{ x: number; y: number }>>();
    for (const r of runs) { const k = key(r.str); if (k.length >= 5 && /[A-Z]/.test(k)) m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const ua = uniq(a.runs), ub = uniq(b.runs);
  const pairs: Array<{ k: string; dx: number; dy: number }> = [];
  for (const [k, v] of ua) { const w = ub.get(k); if (v.length === 1 && w?.length === 1) pairs.push({ k, dx: v[0].x - w[0].x, dy: v[0].y - w[0].y }); }
  let best: Array<typeof pairs[number]> = [];
  for (const p of pairs) {
    const agree = pairs.filter(q => Math.abs(q.dx - p.dx) <= 3 && Math.abs(q.dy - p.dy) <= 3);
    if (agree.length > best.length) best = agree;
  }
  if (best.length < 3) return null;
  const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  return { dx: med(best.map(p => p.dx)), dy: med(best.map(p => p.dy)), labels: best.map(p => p.k) };
}

/** The METER / XFMR / site-panel endpoint as a point on the pole sheet (PDF points), with how it got there. */
function serviceStart(inp: SiteGeometryInput, poleSheet: string, sitePanel: string | null): { point: { x: number; y: number }; text: string } | null {
  const nodes = ['METER', 'XFMR', ...(sitePanel ? [`PANEL ${sitePanel}`] : [])];
  const label = (k: string) => (inp.feeders.sheetOf[k]?.label ?? k).replace(/\s+".*$/, '');
  const scaleOf = (k: string) => inp.feeders.scaleBySheet[k]?.ftPerPt ?? null;
  for (const node of nodes) {
    const e = inp.feeders.endpointOf[node];
    if (!e) continue;
    if (e.sheetKey === poleSheet) return { point: { x: e.x, y: e.y }, text: `${node} (${e.note})` };
    if (!inp.feeders.siteSheets.includes(e.sheetKey)) continue;
    const ta = inp.textSheets?.find(t => t.sheetKey === poleSheet), tb = inp.textSheets?.find(t => t.sheetKey === e.sheetKey);
    const fa = scaleOf(poleSheet), fb = scaleOf(e.sheetKey);
    if (!ta || !tb || !fa || !fb || Math.abs(fa - fb) / fa > 0.01) continue;
    const reg = registerByText(ta, tb);
    if (!reg) continue;
    const d = pdfToDisplayed(e.x, e.y, tb.geometry);
    const q = displayedToPdf(d.x + reg.dx, d.y + reg.dy, ta.geometry.originX, ta.geometry.originY, ta.geometry.widthPt, ta.geometry.heightPt, ta.geometry.rotation);
    return { point: q, text: `${node} (${e.note}, on ${label(e.sheetKey)}; registered onto ${label(poleSheet)} by ${reg.labels.length} shared labels: ${reg.labels.slice(0, 3).map(l => `"${l}"`).join(', ')})` };
  }
  return null;
}

function Σpoles(rows: SiteGeometryInput['takeoffRows']): number {
  return rows.filter(r => !r.note && /^LTG-POLE(?:-30|-LAB)?$/.test(r.libraryCode ?? '')).reduce((t, r) => t + (Number(r.qty) || 0), 0);
}
