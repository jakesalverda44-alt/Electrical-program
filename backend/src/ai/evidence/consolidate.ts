// Real-run fix 2 — one canonical entity per thing, before counting and
// review. Pure.
//
// The live Kissimmee run (2026-09-24) listed one thing under several names:
// RTU / RTU-1 / RTU-2 / "RTU-1/RTU-2"; ALC / "ALC PANEL" / LCP / "LIGHTING
// CONTACTOR ENCLOSURE"; PYLON / "PYLON SIGN"; "POWER POLES" / PP / P /
// PP#1-#6 / "POWER POLE TAG 1-6"; DUPLEX / "DUPLEX RECEPTACLE / FLOOR
// RECEPTACLE"; EWH / WH; EF / "EXHAUST FAN RECESSED …"; T / "T-1/T-2". Each
// synonym raised its own zero-count item, a synonym made a schedule row
// ambiguous ("ALC PANEL" named two targets, so neither got it), and a
// combined tag stacked on its members (RTU 1 + 1 + "RTU-1/RTU-2" 2 = 4).
//
// Identity comes from evidence the targets already carry:
//   * tag tokens — "RTU-1/RTU-2" = RTU-1 + RTU-2 (a combined tag is never a
//     type of its own); an un-numbered tag that is its numbered siblings'
//     base ("RTU", "PP") is the class; numbered siblings (PP#1 / PP#2,
//     DISCON A / DISCON B, M1 / M2) are always distinct;
//   * schedule row identity — the circuits a description cites: the same
//     circuits = the same load ("PYLON" and "PYLON SIGN", both A-18); a set
//     that is exactly the union of other types' circuits is those types
//     combined ("SIGN-JB", A-6/14/16 = FRONT WALL SIGN + SIDE WALL SIGN);
//   * normalized description — an abbreviation's expansion ("EF" = EXHAUST
//     FAN, "EWH" ⊇ "WH" = WATER HEATER) or a head phrase ("LIGHTING
//     CONTACTOR ENCLOSURE") found in the other's description; receptacle
//     qualifiers (GFCI / WP / simplex / quad / handy box …) must agree;
//   * the legend symbol — a legend entry of pole tags "1-6" is the tag
//     marker of PP#1 … PP#6 (a HOST marker: its marks are the poles).
// Fixtures are never touched here (catalog families do that, 3.3).
//
// Never silent, never doubled: every alias stays on the list as a 'merged'
// type with the reason and is kept as evidence on its canonical entity; an
// alias's own count is never added to the canonical's. A generic LEGEND
// symbol that matches two or more entities ("Motion sensor" vs M1 / M2) is
// UNCERTAIN: it is counted on its own, then (resolveUncertainSynonyms) a
// zero count folds it, marks that coincide with a candidate's raise ONE
// review question, and marks elsewhere prove a different device.
import { isFixtureCategory, normalizeTypeKey, type CountTarget } from '../countTargets';
import { circuitRefs, normDesc } from './schedules';

export type MergeKind = 'synonym' | 'class' | 'combined' | 'restates' | 'tag_legend';

export interface ConsolidationMerge {
  key: string;
  type: string;
  description: string;
  /** The canonical entities this name is part of (one for a synonym). */
  into: string[];
  kind: MergeKind;
  /** The evidence, in the estimator's words. */
  basis: string;
}

export interface UncertainSynonym { key: string; type: string; candidates: string[]; basis: string }

export interface Consolidation {
  /** Every input target: canonical ones unchanged except their symbolHint
   *  (the aliases are named for the counter) and an inherited trade
   *  assignment; aliases carry `mergedInto`; a tag legend is role 'host'. */
  targets: CountTarget[];
  merges: ConsolidationMerge[];
  uncertain: UncertainSynonym[];
  /** alias key -> its ONE canonical key (synonyms only). */
  aliasOf: Map<string, string>;
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const STOP = new Set(['THE', 'AND', 'WITH', 'FOR', 'EACH', 'VIA', 'PER', 'FROM', 'TO', 'OF', 'ON', 'IN', 'AT', 'BY', 'ALL', 'NEW', 'EXISTING', 'NEMA', 'TYPE', 'SEE', 'NOTE', 'TAG', 'MARK', 'SYMBOL', 'ONLY', 'ABOVE', 'BELOW', 'TYP', 'TYPICAL', 'CKT', 'CKTS', 'CIRCUIT', 'CIRCUITS', 'SEC', 'SECTION']);

/** Significant words: normDesc (abbreviations expanded, plurals folded),
 *  no stop words, nothing with a digit ("5-20R", "2X4", "3R"). */
function sig(s: string): string[] {
  return normDesc(s).split(' ').filter(w => w.length >= 2 && !STOP.has(w) && !/\d/.test(w));
}

/** The first clause of a description ("Duplex receptacle, shallow 2x4 handy
 *  box" -> "Duplex receptacle"), a leading "(2)" dropped. */
function headOf(desc: string): string[] {
  const first = desc.replace(/^\s*\(\s*\d+\s*\)\s*/, '').split(/[,;(]|\s[-–—]\s/)[0] ?? '';
  return sig(first).slice(0, 5);
}

/** A tag that is an abbreviation of a run of its own description's words:
 *  EF -> EXHAUST FAN ("Bathroom exhaust fans"), EWH -> ELECTRIC WATER HEATER,
 *  ALC -> AUTOMATIC LIGHTING CONTROL, PP -> POWER POLE. */
function tagExpansion(tagBase: string, desc: string): string[] | null {
  if (!/^[A-Z]{2,5}$/.test(tagBase)) return null;
  const w = sig(desc);
  for (let i = 0; i + tagBase.length <= w.length; i++) {
    const run = w.slice(i, i + tagBase.length);
    if (run.map(x => x[0]).join('') === tagBase) return run;
  }
  return null;
}

function containsRun(hay: string[], run: string[]): boolean {
  if (!run.length || run.length > hay.length) return false;
  for (let i = 0; i + run.length <= hay.length; i++) if (run.every((w, k) => hay[i + k] === w)) return true;
  return false;
}

interface TagInfo {
  /** "RTU-1" -> RTU; "PP#4" -> PP; "DISCON A" -> DISCON; "SIGN" -> SIGN. */
  base: string;
  /** "1", "4", "A" — null for an un-numbered tag. */
  num: string | null;
  /** A combined tag's members, as target keys ("RTU-1/RTU-2"). */
  members: string[] | null;
  /** A tag range legend ("POWER POLE TAG 1-6"). */
  range: [number, number] | null;
}

export function tagInfoOf(tagRaw: string): TagInfo {
  const tag = normalizeTypeKey(tagRaw);
  const combined = /^([A-Z][A-Z ]*?)\s*[-#]?\s*([0-9]+[A-Z]?|[A-Z])\s*\/\s*([A-Z][A-Z ]*?)?\s*[-#]?\s*([0-9]+[A-Z]?|[A-Z])$/.exec(tag);
  if (combined && (combined[3] === undefined || combined[3].trim() === combined[1].trim())) {
    const base = combined[1].trim();
    const sep = /-/.test(tag) ? '-' : /#/.test(tag) ? '#' : /\d/.test(combined[2]) ? '' : ' ';
    return { base, num: null, members: [`${base}${sep}${combined[2]}`, `${base}${sep}${combined[4]}`].map(normalizeTypeKey), range: null };
  }
  const range = /^([A-Z][A-Z #]*?)\s*#?\s*(\d{1,2})\s*-\s*(\d{1,2})$/.exec(tag);
  if (range && Number(range[3]) > Number(range[2])) return { base: range[1].replace(/#/g, '').trim(), num: null, members: null, range: [Number(range[2]), Number(range[3])] };
  const numbered = /^([A-Z]{1,8})\s*[-#]?\s*(\d{1,3}[A-Z]?)$/.exec(tag) ?? /^([A-Z]{3,}(?: [A-Z]{3,})*) ([A-Z])$/.exec(tag);
  if (numbered) return { base: numbered[1].trim(), num: numbered[2], members: null, range: null };
  return { base: tag, num: null, members: null, range: null };
}

/** The circuits a description cites, normalized ("ckts B-1,3,5" -> B1 B3
 *  B5) — on a known panel only ("CMR-9" is a sensor model, not circuit 9 of
 *  panel CMR); with no panel list, a 1-2 letter panel name. */
function circuitsOf(desc: string, panels: Set<string> | null): Set<string> {
  return new Set(circuitRefs(desc).filter(c => (panels?.size ? panels.has(c.panel) : c.panel.length <= 2)).map(c => `${c.panel}${c.circuit}`));
}

/** Receptacle qualifiers that must agree both ways (the typicals' rule). */
const QUALS: Array<[RegExp, string]> = [[/\bGFC?I\b/, 'GFCI'], [/\bWP\b|\bWEATHERPROOF\b/, 'WP'], [/\bSIMPLEX\b|\bSINGLE\b/, 'SIMPLEX'],
  [/\bQUAD(?:PLEX)?\b/, 'QUAD'], [/\bHANDY\b|\bPHONE\b|\bSHALLOW\b/, 'HANDY'], [/\bUSB\b/, 'USB'], [/\bISOLATED\b|\bIG\b/, 'IG'], [/\bTWIST\b|\bLOCKING\b/, 'LOCK'], [/\bDEDICATED\b/, 'DED']];
function qualifiers(s: string): Set<string> {
  const t = ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  return new Set(QUALS.filter(([re]) => re.test(t)).map(([, q]) => q));
}
const RECEPT_RE = /\bRECEPT|\bOUTLET|\bDUPLEX\b|\bSIMPLEX\b|\bGFC?I\b|\bQUADPLEX\b/i;

interface Info {
  t: CountTarget;
  idx: number;
  tag: TagInfo;
  circuits: Set<string>;
  words: string[];
  head: string[];
  expansion: string[] | null;
  recept: boolean;
}

function infoOf(t: CountTarget, idx: number, panels: Set<string> | null): Info {
  const tag = tagInfoOf(t.type);
  return {
    t, idx, tag, circuits: circuitsOf(t.description, panels), words: sig(`${t.type} ${t.description}`), head: headOf(t.description),
    expansion: tagExpansion(tag.base, t.description), recept: RECEPT_RE.test(`${t.type} ${t.description}`),
  };
}

const FAMILY = (c: CountTarget['category']) => (c === 'equipment' || c === 'lighting_control' || c === 'device' || c === 'panel_circuit');

/** Priority of the canonical name: an equipment-schedule type whose
 *  description cites its circuits (a schedule row owns its quantity), then
 *  any type citing circuits, then the drawn legend symbol; ties keep the
 *  earlier one. */
function rank(i: Info): number {
  return (i.circuits.size ? 4 : 0) + (i.circuits.size && i.t.source === 'equipment_schedule' ? 2 : 0) + (i.t.source === 'legend' ? 1 : 0);
}

const eqSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

/** Does `a`'s identity phrase appear in `b`'s description (a restatement)? */
function phraseIn(a: Info, b: Info): string | null {
  const bw = sig(b.t.description);
  if (a.expansion && containsRun(bw, a.expansion)) return a.expansion.join(' ');
  if (a.head.length >= 2 && containsRun(bw, a.head)) return a.head.join(' ');
  if (a.head.length === 1 && b.head.length >= 1 && b.head[0] === a.head[0] && a.head[0].length >= 5) return a.head[0];
  return null;
}

/** Receptacle types match only with the same qualifiers ("DUPLEX" never is
 *  the handy-box or GFCI duplex); a device never matches a non-device
 *  receptacle; slash alternatives ("duplex / floor") are one entity. */
function compatible(a: Info, b: Info): boolean {
  if (!FAMILY(a.t.category) || !FAMILY(b.t.category)) return false;
  if (a.recept !== b.recept) return false;
  if (a.recept) {
    const qa = qualifiers(`${a.t.type} ${a.t.description}`), qb = qualifiers(`${b.t.type} ${b.t.description}`);
    return eqSet(qa, qb);
  }
  return true;
}

/** Numbered siblings (PP#1 / PP#2, DISCON A / B, M1 / M2) are distinct. */
function distinctSiblings(a: Info, b: Info): boolean {
  return !!(a.tag.num && b.tag.num && a.tag.base === b.tag.base && a.tag.num !== b.tag.num);
}

/** A base is the class of a numbered family: the same letters, or their
 *  initials ("POWER POLE" -> PP). */
function sameBase(a: string, b: string): boolean {
  if (a === b) return true;
  const init = (s: string) => sig(s).map(w => w[0]).join('');
  return (a.length >= 2 && /^[A-Z]+$/.test(a) && init(b) === a) || (b.length >= 2 && /^[A-Z]+$/.test(b) && init(a) === b);
}

export function consolidateTargets(targetsIn: CountTarget[], opts: { panels?: string[] } = {}): Consolidation {
  const targets = targetsIn.map(t => ({ ...t }));
  const panels = opts.panels?.length ? new Set(opts.panels.map(p => p.toUpperCase().replace(/^PANEL(BOARD)?\s*/, '').replace(/["'\s]/g, ''))) : null;
  const infos = targets.map((t, i) => infoOf(t, i, panels));
  const candidates = infos.filter(i => !isFixtureCategory(i.t.category) && i.t.role !== 'host' && FAMILY(i.t.category));
  const merges: ConsolidationMerge[] = [];
  const uncertain: UncertainSynonym[] = [];
  const merged = new Set<string>();
  const byKey = new Map(infos.map(i => [i.t.key, i]));
  const mark = (i: Info, into: string[], kind: MergeKind, basis: string) => {
    if (merged.has(i.t.key) || !into.length) return;
    merged.add(i.t.key);
    merges.push({ key: i.t.key, type: i.t.type, description: i.t.description, into, kind, basis });
  };

  // 1. Combined tags: "RTU-1/RTU-2" = its members, never a type of its own.
  for (const i of candidates) {
    const m = i.tag.members;
    if (!m) continue;
    const present = m.filter(k => byKey.has(k) && k !== i.t.key);
    if (present.length === m.length) mark(i, present, 'combined', `the combined tag ${i.t.type} names ${present.join(' + ')} — counted once, on each member`);
  }

  // 2. A circuit set that is exactly the union of other types' circuits:
  //    those types combined ("Wall sign J-boxes, A-6, A-14, A-16").
  for (const i of candidates) {
    if (merged.has(i.t.key) || i.circuits.size < 2) continue;
    const parts = candidates.filter(o => o !== i && !merged.has(o.t.key) && o.circuits.size && [...o.circuits].every(c => i.circuits.has(c)) && !eqSet(o.circuits, i.circuits));
    const union = new Set(parts.flatMap(p => [...p.circuits]));
    const disjoint = parts.reduce((s, p) => s + p.circuits.size, 0) === union.size;
    if (parts.length >= 2 && disjoint && eqSet(union, i.circuits)) {
      mark(i, parts.map(p => p.t.key), 'combined', `its circuits ${[...i.circuits].join(', ')} are exactly ${parts.map(p => `${p.t.type} (${[...p.circuits].join(', ')})`).join(' + ')}`);
    }
  }

  // 3. Synonym clusters (union-find): the same circuits, or one's identity
  //    phrase restating the other's.
  const parent = new Map<string, string>();
  const find = (k: string): string => { const p = parent.get(k) ?? k; if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
  const basisOf = new Map<string, string>();
  const union = (a: Info, b: Info, why: string) => {
    const ra = find(a.t.key), rb = find(b.t.key);
    if (ra === rb) return;
    parent.set(ra, rb);
    basisOf.set(`${a.t.key}|${b.t.key}`, why);
  };
  const open = () => candidates.filter(i => !merged.has(i.t.key) && !i.tag.range && !i.tag.members);
  const live = open();
  for (let x = 0; x < live.length; x++) {
    for (let y = x + 1; y < live.length; y++) {
      const a = live[x], b = live[y];
      if (distinctSiblings(a, b) || !compatible(a, b)) continue;
      if (a.circuits.size && eqSet(a.circuits, b.circuits)) { union(a, b, `the same circuit${a.circuits.size > 1 ? 's' : ''} ${[...a.circuits].join(', ')}`); continue; }
      // A numbered member is never a synonym of another name by words alone.
      if (a.tag.num || b.tag.num) continue;
      // Two types that each cite DIFFERENT circuits are different loads.
      if (a.circuits.size && b.circuits.size) continue;
      const pa = phraseIn(a, b), pb = phraseIn(b, a);
      if (pa || pb) union(a, b, `the same item — "${(pa ?? pb)!.toLowerCase()}"`);
    }
  }
  // A cluster member whose phrase ALSO restates an entity outside its
  // cluster is ambiguous: take it out (it is handled as generic below).
  const clusters = new Map<string, Info[]>();
  for (const i of live) { const r = find(i.t.key); clusters.set(r, [...(clusters.get(r) ?? []), i]); }
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const canon = members.slice().sort((p, q) => rank(q) - rank(p) || p.idx - q.idx)[0];
    for (const m of members) {
      if (m === canon) continue;
      const why = [...basisOf.entries()].filter(([k]) => k.split('|').includes(m.t.key)).map(([, v]) => v)[0] ?? 'the same item';
      mark(m, [canon.t.key], 'synonym', `another name for ${canon.t.type} — ${why}`);
    }
  }

  // 4. Classes: an un-numbered name that is a numbered family's base (RTU,
  //    PP, "POWER POLES", P "power poles") — or a combined tag's base whose
  //    members are not listed (T = "T-1/T-2") — is that family.
  const families = new Map<string, Info[]>();
  for (const i of candidates) {
    if (merged.has(i.t.key)) continue;
    if (i.tag.num) families.set(i.tag.base, [...(families.get(i.tag.base) ?? []), i]);
    else if (i.tag.members) families.set(i.tag.base, [...(families.get(i.tag.base) ?? []), i]);
  }
  for (const i of candidates) {
    if (merged.has(i.t.key) || i.tag.num || i.tag.members) continue;
    for (const [base, fam] of families) {
      // The same tag letters, or the name's / head phrase's initials are
      // the family's letters ("POWER POLES" and P "Power poles" -> PP).
      const headInit = i.head.length >= 2 ? i.head.map(w => w[0]).join('') : '';
      const baseHit = i.tag.base === base || (i.tag.range ? sameBase(i.tag.base.replace(/\bTAG\b/g, '').trim(), base) : false)
        || (!i.tag.range && base.length >= 2 && (sameBase(normDesc(i.t.type), base) || headInit === base));
      if (!baseHit) continue;
      if (i.circuits.size) continue; // a specific load, not the class
      const members = fam.filter(f => !merged.has(f.t.key));
      if (!members.length) continue;
      if (i.tag.range) {
        const [lo, hi] = i.tag.range;
        const inRange = members.filter(m => m.tag.num && Number(m.tag.num) >= lo && Number(m.tag.num) <= hi);
        if (!inRange.length) continue;
        mark(i, inRange.map(m => m.t.key), 'tag_legend', `the legend's tag marker for ${inRange.map(m => m.t.type).join(', ')} — each mark is one of them (bound by its circuit)`);
        targets[i.idx].role = 'host';
        break;
      }
      const into = members.map(m => m.t.key);
      // A drawn legend symbol of the class is counted and decided by its
      // marks (it may be drawn where no member tag is): never folded blind.
      if (i.t.source === 'legend') {
        uncertain.push({ key: i.t.key, type: i.t.type, candidates: into, basis: `"${i.t.type}" is the general symbol for ${members.map(m => m.t.type).join(', ')}` });
        break;
      }
      mark(i, into, 'class', `the general name for ${members.map(m => m.t.type).join(', ')} — they are counted one by one`);
      break;
    }
  }

  // 5. Generic names that restate two or more entities: a notes / schedule
  //    restatement ("SIGN — pylon and wall signs by vendor") folds; a drawn
  //    legend symbol ("Motion sensor" vs M1 / M2) is counted and decided
  //    by its marks (resolveUncertainSynonyms).
  const canonicalOf = (k: string) => {
    const m = merges.find(x => x.key === k);
    return m && m.kind === 'synonym' ? m.into[0] : k;
  };
  for (const i of candidates) {
    if (merged.has(i.t.key) || uncertain.some(u => u.key === i.t.key) || i.tag.num || i.tag.members || i.tag.range || i.circuits.size) continue;
    const token = i.tag.base.split(' ').length === 1 && i.tag.base.length >= 3 ? i.tag.base : null;
    const hits = new Set<string>();
    for (const o of candidates) {
      if (o === i || !compatible(i, o) || merged.has(o.t.key) && merges.find(x => x.key === o.t.key)?.kind !== 'synonym') continue;
      const tokenHit = token && token !== o.tag.base && new RegExp(`(^| )${token}( |$)`).test(normalizeTypeKey(o.t.type).replace(/[^A-Z0-9 ]/g, ' '));
      const phraseHit = (i.head.length >= 2 && containsRun(sig(o.t.description), i.head)) || (i.expansion && containsRun(sig(o.t.description), i.expansion));
      if (tokenHit || phraseHit) hits.add(canonicalOf(o.t.key));
    }
    hits.delete(i.t.key);
    if (hits.size < 2) continue;
    const into = [...hits];
    const names = into.map(k => byKey.get(k)?.t.type ?? k).join(', ');
    if (i.t.source === 'legend') uncertain.push({ key: i.t.key, type: i.t.type, candidates: into, basis: `"${i.t.type}" could be any of ${names}` });
    else mark(i, into, 'restates', `restates ${names} together — each is its own line`);
  }

  // A synonym whose canonical name turned out to be a class / combined /
  // restating name itself ("POWER POLES" = P = the PP#n family) points at
  // what that name stands for.
  for (let pass = 0; pass < 3; pass++) {
    for (const m of merges) {
      if (!m.into.some(k => merges.some(x => x.key === k))) continue;
      const next = m.into.flatMap(k => merges.find(x => x.key === k)?.into ?? [k]);
      const via = merges.find(x => m.into.includes(x.key))!;
      m.into = [...new Set(next)];
      if (m.kind === 'synonym' && via.kind !== 'synonym') { m.kind = via.kind; m.basis = `${m.basis}; ${via.type}: ${via.basis}`; }
    }
  }

  // Apply: aliases point at their canonical entities; a canonical entity
  // names its aliases for the counter and inherits a trade assignment an
  // alias states (the canonical says nothing).
  const aliasOf = new Map<string, string>();
  for (const m of merges) {
    const t = targets[byKey.get(m.key)!.idx];
    t.mergedInto = m.into;
    t.mergeKind = m.kind;
    t.mergeReason = m.basis;
    if (m.kind === 'synonym') aliasOf.set(m.key, m.into[0]);
  }
  for (const m of merges) {
    if (m.kind !== 'synonym' && m.kind !== 'combined' && m.kind !== 'class') continue;
    const alias = targets[byKey.get(m.key)!.idx];
    for (const k of m.into) {
      const c = targets[byKey.get(k)!.idx];
      c.aliases = [...(c.aliases ?? []), alias.key];
      if (m.kind === 'synonym') {
        c.symbolHint = `${c.symbolHint}${c.symbolHint ? '; ' : ''}also listed as ${alias.type}${alias.description && alias.description !== alias.type ? ` ("${alias.description.slice(0, 60)}")` : ''}`;
        if (!c.assignment && alias.assignment) c.assignment = alias.assignment;
      }
    }
  }
  return { targets, merges, uncertain, aliasOf };
}

/** The live counting / merge inputs name aliases by their own key (a
 *  carried supplement mark, a typical package the reader bound to "DUPLEX"):
 *  map a key to its canonical one. */
export function canonicalKey(key: string, aliasOf: Map<string, string> | undefined): string {
  return aliasOf?.get(key) ?? key;
}

/** Fix 2 — after the merge: an uncertain generic legend symbol that counted
 *  zero folds into its candidates (a restatement, never its own item); one
 *  whose marks sit where a candidate's marks are asks ONE question; one
 *  whose marks are elsewhere is a different device (kept, noted). */
export function resolveUncertainSynonyms<T extends { key: string; type: string; status: string; count: number; flags: string[]; reason: string; mergedInto?: string; synonymQuestion?: { candidates: string[]; coincident: number; count: number } }>(
  types: T[],
  uncertain: UncertainSynonym[],
  marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number }>,
  radiusPt = 0.35 * 72,
): void {
  for (const u of uncertain) {
    const t = types.find(x => x.key === u.key);
    if (!t) continue;
    if (t.status === 'zero') {
      t.status = 'merged';
      t.mergedInto = u.candidates.map(k => types.find(x => x.key === k)?.type ?? k).join(' / ');
      t.reason = `restates ${t.mergedInto} — none drawn on its own`;
      t.flags.push(`${t.type}: ${u.basis}; none of its own drawn — folded, never a line of its own.`);
      continue;
    }
    if (t.status !== 'counted') continue;
    const mine = marks.filter(m => m.typeKey === u.key);
    const theirs = marks.filter(m => u.candidates.includes(m.typeKey));
    const coincident = mine.filter(m => theirs.some(o => o.sheetKey === m.sheetKey && Math.hypot(o.x - m.x, o.y - m.y) <= radiusPt)).length;
    if (coincident) {
      t.synonymQuestion = { candidates: u.candidates, coincident, count: t.count };
      t.flags.push(`${t.type}: ${coincident} of its ${t.count} marks sit on ${u.candidates.join(' / ')} marks — the same device under two names? Needs review.`);
    } else {
      t.flags.push(`${t.type}: ${u.basis}, but its ${t.count} mark${t.count === 1 ? '' : 's'} are elsewhere — a different device, counted on its own.`);
    }
  }
}

/** Real-run fix 3 — a pole-tag legend's marks ARE the poles: a mark whose
 *  circuit tag ("B20,24") shares a circuit with exactly ONE member (PP#4:
 *  "circuits B-20,24"; or the member's own schedule rows) is that member's.
 *  A mark with no circuit, or one that fits several members, stays with the
 *  legend (never guessed). Mutates `placed[].typeKey`; returns the bindings. */
export function bindHostTagMarks(
  targets: CountTarget[],
  sheets: Array<{ status: string; sheet: { key: string }; placed: Array<{ typeKey: string; circuit?: string }> }>,
  scheduleCircuits: Map<string, Set<string>> = new Map(),
): Array<{ tag: string; member: string; circuit: string; sheetKey: string }> {
  const out: Array<{ tag: string; member: string; circuit: string; sheetKey: string }> = [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  const markCircuits = (c: string) => {
    const m = /^([A-Z]{1,2})(.*)$/.exec(c.toUpperCase().replace(/[^A-Z0-9,/&]/g, ''));
    return m ? m[2].split(/[,/&]/).filter(Boolean).map(n => `${m[1]}${Number(n)}`) : [];
  };
  for (const tag of targets.filter(t => t.mergeKind === 'tag_legend' && t.mergedInto?.length)) {
    const members = tag.mergedInto!.map(k => byKey.get(k)).filter((t): t is CountTarget => !!t)
      .map(t => ({ key: t.key, circuits: new Set([...circuitsOf(t.description, null), ...(scheduleCircuits.get(t.key) ?? [])]) }));
    for (const s of sheets) {
      if (s.status !== 'counted') continue;
      for (const p of s.placed) {
        if (p.typeKey !== tag.key || !p.circuit) continue;
        const cs = markCircuits(p.circuit);
        const hits = members.filter(m => cs.some(c => m.circuits.has(c)));
        if (hits.length !== 1) continue;
        p.typeKey = hits[0].key;
        out.push({ tag: tag.key, member: hits[0].key, circuit: p.circuit, sheetKey: s.sheet.key });
      }
    }
  }
  return out;
}
