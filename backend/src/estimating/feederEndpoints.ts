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
export type EndpointConfidence = 'exact' | 'high' | 'low' | 'interchangeable' | 'approximate (label)' | 'suggested';

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
  /** Gap-closing T13 — takeoff / scope texts that may say which existing panel is which ("Existing Panels A/B reused"). */
  hints?: string[];
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

  // Gap-closing T13 (J16) — exactly one UNLABELED panel mark type ("ELECTRICAL PANEL", at most one mark per sheet) and
  // exactly one panel node nothing located → offered as that node, tier `suggested`, quoted, never `confirmed`.
  // Two or more unlabeled panel types → the hold says so. A labeled panel's mark ("PANEL B") is never reused.
  const unlabeled = types.filter(t => /\bpanel\b/i.test(`${t.key} ${t.type ?? ''}`) && !normalizeNode(t.key) && !normalizeNode(t.type ?? '')
    && marksOf(t.key).length > 0 && new Set(marksOf(t.key).map(m => m.sheetKey)).size === marksOf(t.key).length);
  const unlocated = nodes.filter(n => /^PANEL /.test(n) && !Array.isArray(out.get(n)));
  if (unlabeled.length === 1 && unlocated.length === 1) {
    const t = unlabeled[0];
    const node = unlocated[0];
    const letter = node.replace(/^PANEL /, '');
    const hint = (input.hints ?? []).slice().sort((x, y) => x.length - y.length).find(h => new RegExp(`\\bpanels?\\s+(?:[A-Z]\\/)?${letter}\\b[^.;]*\\breus|existing panels? ${letter}\\b`, 'i').test(h));
    out.set(node, marksOf(t.key).map(m => ({
      node, sheetKey: m.sheetKey, x: m.x, y: m.y, source: 'counted' as const, confidence: 'suggested' as const,
      note: `suggested — the only unlabeled panel mark "${t.key}" for the only panel not located${hint ? ` ("${hint.trim().slice(0, 90)}")` : ''}; confirm or pin ${node}`,
    })));
  } else if (unlabeled.length >= 2) {
    for (const node of unlocated) out.set(node, { node, hold: `Pin ${node} on the Plans view (${unlabeled.length} unlabeled panel marks could be it: ${unlabeled.map(t => t.key).join(', ')})` });
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

// ── Gap-closing T4 — which side of the wall each node is on ──────────────────
export interface NodeLocation { exterior: boolean; quote: string }
const EXTERIOR_RE = /\bexterior\b|\boutdoors?\b|\boutside\b|\bnema\s*3r\b|\b3r\b|weather ?proof|\bwp\b/i;
/** Agent 1's panels[] location / nemaRating (and an equipment entry's description) per node: exterior when the
 *  entry says Exterior / NEMA 3R, interior when an entry states a location that does not; a node whose entries
 *  disagree, or that states nothing, is unknown (absent — today's routing rule applies). */
export function nodeLocations(agent1: { panels?: Array<{ name?: string; location?: string | null; nemaRating?: string | null }> | null; equipment?: Array<{ tag?: string; description?: string | null }> | null } | null | undefined): Map<string, NodeLocation> {
  const seen = new Map<string, NodeLocation[]>();
  const add = (node: string | null, text: string) => {
    if (!node || !text.trim()) return;
    seen.set(node, [...(seen.get(node) ?? []), { exterior: EXTERIOR_RE.test(text), quote: text.trim() }]);
  };
  for (const p of agent1?.panels ?? []) add(normalizeNode(p.name, { asPanel: true }), [p.location, p.nemaRating].filter(Boolean).join(', '));
  for (const e of agent1?.equipment ?? []) {
    const node = normalizeNode(e.tag);
    if (node && /^(?:METER|WIREWAY|DISCON |XFMR|MDP)/.test(node) && EXTERIOR_RE.test(String(e.description ?? ''))) add(node, String(e.description));
  }
  const out = new Map<string, NodeLocation>();
  for (const [node, list] of seen) {
    const ext = list.filter(l => l.exterior), int = list.filter(l => !l.exterior);
    if (ext.length && !int.length) out.set(node, ext[0]);
    else if (int.length && !ext.length) out.set(node, int[0]);
  }
  return out;
}
