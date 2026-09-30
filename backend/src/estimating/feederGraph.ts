// Accuracy round C1 — the feeder graph. Pure: no I/O.
//
// Nodes are normalized equipment names (PANEL A, DISCON A, METER, WIREWAY,
// XFMR = the utility transformer / pad, MDP, RTU-1 …). Edges are the
// feeders between them, with the conduit + conductors the drawings state:
//   * Agent 1 panels[].fedFrom ("DISCON A (200A fused switch)" → DISCON A →
//     PANEL A);
//   * Agent 1 equipment[] descriptions ("feeds Panel A 4#3/0,#6G,2"C",
//     "Meter base …, parallel (2)4#3/0 2"C service", "Rooftop unit, 60/3,
//     Panel B ckt 1,3,5, 3#6,#10G,3/4"C" → PANEL B → RTU-1, kind equipment);
//   * the service (a stated service spec → XFMR → METER, the service lateral;
//     METER → WIREWAY when the service text names the wireway);
//   * takeoff rows (Agent 2's, or Agent 1's quantities) that read as feeder
//     specs with "X to Y" / "X->Y" / "X-Y" endpoints ("Xfmr-meter and
//     meter-wireway", "Discon A->Panel A, Discon B->Panel B");
//   * scope notes that state a feeder spec for a set of edges ("Feeders
//     4#3/0,#6G,2"C to each panel").
// A feeder the text calls existing is skipped (as collectFeeders does), and
// listed so the estimator sees why. A spec that can't be read is a
// 'needs_size' hold — never guessed. A disconnect fed from a wireway with
// no stated spec is a tap connection (a note, no length edge).
import { parseConductorRun, parseFeederSpec, type Agent1Like } from './footageAllowance';

export type FeederEdgeKind = 'service_lateral' | 'service' | 'feeder' | 'equipment';

export interface FeederRunSpec {
  key: string;
  conduit: string | null;
  /** Totals over every parallel set (as parseConductorRun). */
  conductors: Array<{ count: number; size: string; ground: boolean }>;
  sets: number;
}

export interface FeederEdge {
  id: string;
  from: string;
  to: string;
  kind: FeederEdgeKind;
  spec: FeederRunSpec | null;
  /** 'needs_size' when no conduit/conductor spec could be read. */
  hold: 'needs_size' | null;
  quotes: string[];
}

export interface FeederTap { from: string; to: string; quote: string }

export interface FeederGraph {
  nodes: string[];
  edges: FeederEdge[];
  taps: FeederTap[];
  /** Feeders skipped because the text calls them existing. */
  skipped: Array<{ to: string; quote: string; reason: string }>;
}

export interface FeederGraphInput {
  agent1: (Agent1Like & {
    service?: { mainAmps?: number | null; voltage?: string | null } | null;
    panels?: Array<{ name?: string; fedFrom?: string | null; nemaRating?: string | null; location?: string | null; amps?: number | null }> | null;
    equipment?: Array<{ tag?: string; description?: string | null; amps?: number | null }> | null;
    quantities?: Array<{ category?: string; item?: string; spec?: string | null; unit?: string }> | null;
  }) | null | undefined;
  /** Agent 2's takeoff rows. */
  takeoffRows?: Array<{ category?: string; item?: string; spec?: string | null; unit?: string }>;
}

const EQUIP_TAG_RE = /\b(RTU|AHU|COMP|CU|MAU|ERV|EF|WH|EWH|ACCU|HP|UH)\s*[-#]?\s*(\d{1,2})\b/i;

/** A name → its node, or null. `asPanel`: a bare tag ("A") is a panel name. */
export function normalizeNode(raw: string | null | undefined, opts: { asPanel?: boolean } = {}): string | null {
  const t0 = String(raw ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t0) return null;
  const t = t0.toUpperCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\bDISC(?:ON(?:NECT)?)?\s*[-#]?\s*([A-Z]{1,2}\d{0,2}|\d{1,2})\b/)) && !/^(?:SWITCH|W|WITH|UNIT)$/.test(m[1])) return `DISCON ${m[1]}`;
  if (/\bXFMR\b|\bTRANSFORMER\b|\bPAD[- ]?MOUNT|\bUTILITY\b/.test(t)) return 'XFMR';
  if (/\bMETER(?:\s*(?:BASE|SOCKET|CAN))?\b|^MB$|\bMB\b(?=\s*[-—–])/.test(t)) return 'METER';
  if (/\bWIREWAY\b|\bGUTTER\b/.test(t)) return 'WIREWAY';
  if (/\bMDP\b|\bMSB\b|MAIN (?:DISTRIBUTION|SWITCHBOARD)/.test(t)) return 'MDP';
  if ((m = t.match(/\bPANEL(?:BOARD)?\s*[-#]?\s*([A-Z]{1,3}\d{0,2}(?:-\d)?)\b/)) && !/^(?:WALL|DOOR|CKT|CKTS|CIRCUITS?)$/.test(m[1])) return `PANEL ${m[1]}`;
  if ((m = t.match(EQUIP_TAG_RE))) return `${m[1].toUpperCase()}-${Number(m[2])}`;
  if (opts.asPanel && /^[A-Z]{1,3}\d{0,2}$/.test(t)) return `PANEL ${t}`;
  return null;
}

/** The node names a job has (the C3 locate targets read the same list). */
export function feederNodes(input: FeederGraphInput): string[] {
  return feederGraph(input).nodes;
}

const isExistingText = (t: string) => /\bexisting\b|\(e\)|to remain/i.test(t);

function specOf(text: string): FeederRunSpec | null {
  const s = parseFeederSpec(text);
  return s ? { key: s.key, conduit: s.conduit, conductors: s.conductors, sets: s.sets } : null;
}

/** "X to Y", "X->Y", "X-Y" pairs in a text, as normalized nodes. */
export function endpointPairs(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const parts = String(text ?? '').split(/,|;|\band\b/i);
  for (const p of parts) {
    const m = p.match(/^\s*(.+?)\s*(?:->|→|–>|—>|\bto\b|-(?=\s*[a-z]))\s*(.+?)\s*$/i);
    if (!m) continue;
    const a = normalizeNode(m[1]);
    const b = normalizeNode(m[2]);
    if (a && b && a !== b) out.push([a, b]);
  }
  return out;
}

/** The panel an equipment circuit is on ("Panel B ckt 1,3,5", "ckts A15,17", "B-1,3,5"). */
function panelOfCircuit(text: string): string | null {
  const t = text ?? '';
  let m = t.match(/\bpanel\s+([A-Z]{1,2}\d?)\s*,?\s*(?:ckts?|circuits?)\b/i);
  if (m) return `PANEL ${m[1].toUpperCase()}`;
  m = t.match(/\bckts?\.?\s*([A-Z]{1,2})-?\d{1,2}\b/i);
  if (m) return `PANEL ${m[1].toUpperCase()}`;
  m = t.match(/\b([A-Z])-\d{1,2}(?:\s*,\s*\d{1,2})+\b/);
  if (m) return `PANEL ${m[1].toUpperCase()}`;
  return null;
}

export function feederGraph(input: FeederGraphInput): FeederGraph {
  const a1 = input.agent1 ?? {};
  const edges = new Map<string, FeederEdge>();
  const nodes = new Set<string>();
  const taps: FeederTap[] = [];
  const skipped: FeederGraph['skipped'] = [];
  const rows = [...(input.takeoffRows ?? []), ...((a1.quantities ?? []) as NonNullable<FeederGraphInput['takeoffRows']>)];

  const addEdge = (from: string, to: string, kind: FeederEdgeKind, spec: FeederRunSpec | null, quote: string) => {
    nodes.add(from); nodes.add(to);
    const id = `${from}→${to}`;
    const cur = edges.get(id);
    if (cur) {
      if (!cur.spec && spec) { cur.spec = spec; cur.hold = null; }
      if (quote && !cur.quotes.includes(quote)) cur.quotes.push(quote);
      return;
    }
    edges.set(id, { id, from, to, kind, spec, hold: spec ? null : 'needs_size', quotes: quote ? [quote] : [] });
  };

  // Panels (and the disconnects Agent 1 lists as panels).
  const panels = (a1.panels ?? []).filter(p => p?.name);
  const existingPanel = new Set<string>();
  for (const p of panels) {
    const node = normalizeNode(p.name, { asPanel: true });
    if (!node) continue;
    nodes.add(node);
    if (isExistingText(`${p.nemaRating ?? ''} ${p.location ?? ''}`)) existingPanel.add(node);
  }
  for (const p of panels) {
    const to = normalizeNode(p.name, { asPanel: true });
    const fed = String(p.fedFrom ?? '').trim();
    if (!to || !fed) continue;
    if (isExistingText(fed) || existingPanel.has(to)) { skipped.push({ to, quote: fed, reason: 'existing feeder (text says existing)' }); continue; }
    const fromNodes = fed.split(/\s*\/\s*|\s+or\s+/i).map(x => normalizeNode(x)).filter((x): x is string => !!x);
    const spec = specOf(fed);
    if (to.startsWith('DISCON') && !spec && fromNodes.includes('WIREWAY')) {
      taps.push({ from: 'WIREWAY', to, quote: fed });
      continue;
    }
    const from = fromNodes[0] ?? (/ckts?\b/i.test(fed) ? panelOfCircuit(fed) : null);
    if (!from || from === to) continue;
    addEdge(from, to, 'feeder', spec, fed);
  }

  // Equipment.
  const serviceTexts: string[] = [];
  for (const e of a1.equipment ?? []) {
    const d = String(e.description ?? '');
    const tagNode = normalizeNode(e.tag) ?? normalizeNode(d);
    if (/meter/i.test(`${e.tag ?? ''} ${d}`) && specOf(d)) { serviceTexts.push(d); nodes.add('METER'); continue; }
    if (/wireway|gutter/i.test(`${e.tag ?? ''} ${d}`)) { nodes.add('WIREWAY'); continue; }
    // "feeds Panel A 4#3/0,#6G,2"C" on a disconnect.
    const feeds = d.match(/\bfeeds?\s+(panel\s+[A-Z0-9-]+)\s*(.*)$/i);
    if (feeds && tagNode) {
      const to = normalizeNode(feeds[1]);
      if (to && !isExistingText(d)) { addEdge(tagNode, to, 'feeder', specOf(feeds[2]) ?? specOf(d), `${e.tag}: ${d}`); continue; }
    }
    if (!tagNode || !EQUIP_TAG_RE.test(tagNode.replace('-', ' '))) continue;
    if (isExistingText(d)) { skipped.push({ to: tagNode, quote: d, reason: 'existing equipment circuit' }); continue; }
    const run = parseConductorRun(d);
    const large = run?.conductors.some(c => !c.ground && (/\/0|kcmil/.test(c.size) || Number(c.size) <= 8));
    const amps = Number(e.amps ?? 0);
    const panel = panelOfCircuit(d);
    if (!panel || !(large || amps >= 40)) continue;
    addEdge(panel, tagNode, 'equipment', large && run ? { key: run.key, conduit: run.conduit, conductors: run.conductors, sets: run.sets } : null, `${e.tag}: ${d}`);
  }
  // The same equipment named again with no spec (e.g. "RTU-1 … HVAC
  // disconnect with unit") joins its edge's quotes.
  for (const e of a1.equipment ?? []) {
    const tagNode = normalizeNode(e.tag);
    if (!tagNode) continue;
    for (const ed of edges.values()) if (ed.to === tagNode && !ed.quotes.some(q => q.includes(String(e.description ?? '')))) ed.quotes.push(`${e.tag}: ${e.description ?? ''}`);
  }

  // Takeoff rows with endpoints, and service conductors.
  for (const r of rows) {
    const text = `${r.item ?? ''} ${r.spec ?? ''}`;
    if (isExistingText(text)) {
      if (specOf(text)) skipped.push({ to: '', quote: text.trim(), reason: 'existing feeder (text says existing)' });
      continue;
    }
    const spec = specOf(text);
    if (!spec) continue;
    const pairs = endpointPairs(String(r.spec ?? '')).concat(endpointPairs(String(r.item ?? '')));
    if (/\bservice\b/i.test(text)) serviceTexts.push(text);
    for (const [from, to] of pairs) addEdge(from, to, from === 'XFMR' ? 'service_lateral' : from === 'METER' || to === 'WIREWAY' ? 'service' : 'feeder', spec, text.trim());
  }

  // Scope notes: a service spec, or a feeder spec "to each panel".
  for (const n of a1.scopeNotes ?? []) {
    if (isExistingText(n)) continue;
    const spec = specOf(n);
    if (!spec) continue;
    if (/\bservice\b/i.test(n)) { serviceTexts.push(n); continue; }
    if (/\bfeeders?\b.*\b(?:each|every|all)\s+panels?\b|\bto\s+(?:each|both)\s+panels?\b/i.test(n)) {
      for (const ed of edges.values()) if (ed.kind === 'feeder' && ed.to.startsWith('PANEL') && !ed.spec) { ed.spec = spec; ed.hold = null; ed.quotes.push(n); }
    }
  }

  // The service: a stated service spec runs XFMR → METER (the lateral), and
  // METER → WIREWAY when the service text names the wireway.
  const svc = serviceTexts.map(t => ({ t, spec: specOf(t) })).find(x => x.spec);
  if (svc && ![...edges.values()].some(e => e.kind === 'service_lateral')) {
    addEdge('XFMR', 'METER', 'service_lateral', svc.spec, svc.t.trim());
  }
  if (svc && nodes.has('WIREWAY') && serviceTexts.some(t => /meter\s*(?:\/|-|and|to)\s*wireway|to\s+wireway|meter-wireway/i.test(t)) && !edges.has('METER→WIREWAY')) {
    addEdge('METER', 'WIREWAY', 'service', svc.spec, serviceTexts.find(t => /wireway/i.test(t))!.trim());
  }
  for (const e of edges.values()) {
    if (e.from === 'XFMR') e.kind = 'service_lateral';
    else if (e.from === 'METER' || (e.to === 'WIREWAY' && e.from !== 'XFMR')) e.kind = 'service';
  }
  // Any node Agent 1 names as service equipment.
  if (a1.service && (a1.service.mainAmps ?? 0) > 0 && svc) nodes.add('XFMR');

  const seen = new Set<string>();
  const skippedOnce = skipped.filter(x => (seen.has(x.quote) ? false : (seen.add(x.quote), true)));
  return { nodes: [...nodes].sort(), edges: [...edges.values()], taps, skipped: skippedOnce };
}
