// Accuracy round C4 — where each feeder node is on the drawings. Pure.
// Per node, the first hit wins:
//   1. an estimator pin — a CONFIRMED est_markups count marker whose label
//      normalizes to the node ("Panel B", "RTU-1", "XFMR", "Transformer";
//      the existing "^panel" pins keep working) — confidence 'exact';
//   2. a locate mark (count_result.locate[], Builder R's C3) — the counter's
//      own confidence;
//   3. a counted mark of a type identified as the node: the type's tag is the
//      node, or an equipment-connection type tied to exactly one node family
//      (Kissimmee's "HVAC disconnect with unit" marks = the RTU nodes'
//      positions, by circuit tag when read, else interchangeable — said so);
//   4. a text-layer label on a vector sheet: the exact node words, never a
//      legend or notes entry (a run of > 6 words, or a column of stacked short
//      entries), exactly one candidate — 'approximate (label)';
//   5. none → a hold: "Pin <node> on the Plans view".
// Every position is in PDF user-space points of its sheet (the frame
// count_result marks and est_markups use).
import { normalizeNode } from './feederGraph';
import { displayedToPdf } from './pageGeometry';

export type EndpointSource = 'pin' | 'locate' | 'counted' | 'label';
export type EndpointConfidence = 'exact' | 'high' | 'low' | 'interchangeable' | 'approximate (label)';

export interface Endpoint {
  node: string;
  sheetKey: string;
  x: number;
  y: number;
  source: EndpointSource;
  confidence: EndpointConfidence;
  /** "located by counter", "counted HVAC DISCONNECT WITH UNIT (interchangeable with RTU-2)" … */
  note: string;
}

export interface EndpointHold { node: string; hold: string }

export interface PinLike { sheetKey: string; label: string; x: number; y: number }
export interface LocateLike { node: string; sheetKey: string; x: number; y: number; viewportId?: string | null; viewportKind?: string | null; confidence?: string | null }
export interface CountTypeLike { key: string; type?: string; description?: string; status?: string; count?: number; host?: boolean }
export interface CountMarkLike { typeKey: string; sheetKey: string; x: number; y: number; circuit?: string | null }
export interface TextSheet {
  sheetKey: string;
  label: string;
  geometry: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number };
  /** Displayed-point runs (viewports.ts TextRun). */
  runs: Array<{ str: string; x: number; y: number; w: number; h: number }>;
}

export interface EndpointInput {
  pins?: PinLike[];
  locate?: LocateLike[];
  types?: CountTypeLike[];
  marks?: CountMarkLike[];
  textSheets?: TextSheet[];
}

const FAMILY_RE = /^(RTU|AHU|COMP|CU|MAU|ERV|EF|WH|EWH|ACCU|HP|UH)-\d+$/;
const familyOf = (node: string) => FAMILY_RE.exec(node)?.[1] ?? null;
const HVAC_DISCONNECT_RE = /disconnect/i;
const HVAC_WORDS_RE = /\bhvac\b|\brtu\b|roof ?top|\bunit\b|a\/c\b|condens|\bahu\b|air handler|compressor/i;

function labelPattern(node: string): RegExp | null {
  if (node === 'XFMR') return /\b(?:electric(?:al)?\s+)?transformer\b|\bxfmr\b|pad[- ]?mount/i;
  // A bare "METER" on a civil sheet is usually the water meter: an electric
  // qualifier is required.
  if (node === 'METER') return /\belectric(?:al)?\s+meter\b|\bmeter\s+(?:base|socket)\b|\bE\.?M\.?\b/;
  if (node === 'MDP') return /\bmdp\b/i;
  const p = node.match(/^PANEL (.+)$/);
  if (p) return new RegExp(`\\bpanel\\s+["“]?${p[1].replace(/[^A-Z0-9-]/gi, '')}["”]?(?![A-Z0-9])`, 'i');
  return null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function labelCandidates(node: string, sheets: TextSheet[]): Array<{ sheet: TextSheet; run: TextSheet['runs'][number] }> {
  const re = labelPattern(node);
  if (!re) return [];
  const out: Array<{ sheet: TextSheet; run: TextSheet['runs'][number] }> = [];
  for (const s of sheets) {
    for (const r of s.runs) {
      if (!re.test(r.str) || words(r.str) > 6) continue;
      if (/\bwater\b|\bgas\b/i.test(r.str)) continue;
      // A legend column: two or more other short entries stacked at the same x.
      const stacked = s.runs.filter(o => o !== r && words(o.str) <= 6 && Math.abs(o.x - r.x) <= 5 && Math.abs(o.y - r.y) <= 100).length;
      if (stacked >= 2) continue;
      out.push({ sheet: s, run: r });
    }
  }
  return out;
}

/** Every position of each node, one per sheet, in priority order. */
export function endpointCandidates(nodes: string[], input: EndpointInput): Map<string, Endpoint[] | EndpointHold> {
  const out = new Map<string, Endpoint[] | EndpointHold>();
  const pins = input.pins ?? [];
  const locate = input.locate ?? [];
  const types = (input.types ?? []).filter(t => !t.host && (t.status == null || t.status === 'counted'));
  const marks = input.marks ?? [];
  const marksOf = (key: string) => marks.filter(m => m.typeKey === key);

  // 3b — equipment-connection types tied to exactly one node family.
  const familyAssign = new Map<string, Endpoint>();
  const families = new Map<string, string[]>();
  for (const n of nodes) { const f = familyOf(n); if (f) families.set(f, [...(families.get(f) ?? []), n].sort()); }
  for (const [fam, members] of families) {
    const cands = types.filter(t => {
      const text = `${t.key} ${t.type ?? ''} ${t.description ?? ''}`;
      return HVAC_DISCONNECT_RE.test(text) && HVAC_WORDS_RE.test(text) && marksOf(t.key).length === members.length;
    });
    // A type can serve one family only when no other family has the same size.
    const sameSize = [...families.values()].filter(m => m.length === members.length).length;
    if (cands.length !== 1 || sameSize !== 1) continue;
    const t = cands[0];
    const ms = marksOf(t.key).slice().sort((a, b) => a.sheetKey.localeCompare(b.sheetKey) || a.x - b.x || a.y - b.y);
    // (The plan's "assigned by circuit tag if read" is NOT implemented: the count's marks carry a circuit only
    // on some jobs and the nodes carry none, so the marks pair with the units by sort order and are marked
    // interchangeable — totals are unaffected, a single run's length can be swapped between the units.)
    members.forEach((node, i) => {
      const m = ms[i];
      const others = members.filter(x => x !== node).join(', ');
      familyAssign.set(node, {
        node, sheetKey: m.sheetKey, x: m.x, y: m.y, source: 'counted', confidence: 'interchangeable',
        note: `counted ${t.key} mark (${ms.length} marks for ${members.length} ${fam} units — interchangeable with ${others}; no circuit tag read)`,
      });
    });
  }

  for (const node of nodes) {
    const list: Endpoint[] = [];
    const push = (e: Endpoint) => { if (!list.some(x => x.sheetKey === e.sheetKey)) list.push(e); };
    // 1 — estimator pins (one per sheet).
    for (const pin of pins.filter(p => normalizeNode(p.label, { asPanel: /^\s*panel\b/i.test(p.label) }) === node)) {
      push({ node, sheetKey: pin.sheetKey, x: pin.x, y: pin.y, source: 'pin', confidence: 'exact', note: `pinned by the estimator ("${pin.label}")` });
    }
    // 2 — locate marks.
    for (const loc of locate.filter(l => (normalizeNode(l.node, { asPanel: true }) ?? l.node.toUpperCase()) === node)) {
      const conf: EndpointConfidence = loc.confidence === 'low' ? 'low' : 'high';
      push({ node, sheetKey: loc.sheetKey, x: loc.x, y: loc.y, source: 'locate', confidence: conf, note: `located by the counter (${conf})` });
    }
    // 3a — a counted type that IS the node.
    const own = types.find(t => normalizeNode(t.key) === node && marksOf(t.key).length > 0);
    if (own) {
      const ms = marksOf(own.key);
      push({ node, sheetKey: ms[0].sheetKey, x: ms[0].x, y: ms[0].y, source: 'counted', confidence: ms.length === 1 ? 'high' : 'low', note: `counted ${own.key} mark${ms.length > 1 ? ` (first of ${ms.length})` : ''}` });
    }
    // 3b.
    const fam = familyAssign.get(node);
    if (fam) push(fam);
    // 4 — text label.
    const labels = labelCandidates(node, input.textSheets ?? []);
    if (labels.length === 1) {
      const { sheet, run } = labels[0];
      const g = sheet.geometry;
      const p = displayedToPdf(run.x + run.w / 2, run.y + run.h / 2, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
      push({ node, sheetKey: sheet.sheetKey, x: p.x, y: p.y, source: 'label', confidence: 'approximate (label)', note: `text label "${run.str.trim()}" on ${sheet.label} (a label sits on a leader line, 10–30 ft from the equipment)` });
    }
    out.set(node, list.length ? list : { node, hold: labels.length > 1 ? `Pin ${node} on the Plans view (${labels.length} labels could be it)` : `Pin ${node} on the Plans view` });
  }
  return out;
}

/** The best single position per node (first by priority). */
export function resolveEndpoints(nodes: string[], input: EndpointInput): Map<string, Endpoint | EndpointHold> {
  const all = endpointCandidates(nodes, input);
  return new Map([...all].map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

/** Both ends of an edge: a sheet they share when there is one (lowest
 *  combined priority), else each end's best position. */
export function pickEnds(a: Endpoint[] | EndpointHold | undefined, b: Endpoint[] | EndpointHold | undefined): [Endpoint | EndpointHold | undefined, Endpoint | EndpointHold | undefined] {
  if (!Array.isArray(a) || !Array.isArray(b)) return [Array.isArray(a) ? a[0] : a, Array.isArray(b) ? b[0] : b];
  let best: [number, number] | null = null;
  a.forEach((x, i) => b.forEach((y, j) => { if (x.sheetKey === y.sheetKey && (!best || i + j < best[0] + best[1])) best = [i, j]; }));
  return best ? [a[best[0]], b[best[1]]] : [a[0], b[0]];
}

export const isEndpoint = (e: Endpoint | EndpointHold | undefined): e is Endpoint => !!e && 'sheetKey' in e;
