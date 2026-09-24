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
import { tagInfoOf, type TagInfo } from './tags';

export { tagInfoOf } from './tags';

export type MergeKind = 'synonym' | 'class' | 'combined' | 'tag_legend';

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
  /** Review fix S3 — questions the consolidation cannot settle. */
  questions: ConsolidationQuestion[];
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

/** The circuits a description cites as its OWN (review fix S4: never one it
 *  "controls", "serves", "feeds" or is "for": "time clock, controls sign
 *  circuits A-6, A-14" cites none of its own), normalized ("ckts B-1,3,5"
 *  -> B1 B3 B5) — on a known panel only (review fix S5: without the
 *  drawing's panel list, nothing is a circuit — "T-1", "SP-1", "CMR-9"). */
export function circuitsOf(desc: string, panels: Set<string> | null): Set<string> {
  if (!panels?.size) return new Set();
  const own = desc.toUpperCase().replace(/\b(?:CONTROLS|CONTROLLING|CONTROLLED|SERVES|SERVING|FEEDS|FEEDING|FOR)\b[^,;()]*/g, ' ');
  return new Set(circuitRefs(own).filter(c => panels.has(c.panel)).map(c => `${c.panel}${c.circuit}`));
}

/** Receptacle qualifiers that must agree both ways (the typicals' rule). */
const QUALS: Array<[RegExp, string]> = [[/\bGFC?I\b/, 'GFCI'], [/\bWP\b|\bWEATHERPROOF\b/, 'WP'], [/\bSIMPLEX\b|\bSINGLE\b/, 'SIMPLEX'],
  [/\bQUAD(?:PLEX)?\b/, 'QUAD'], [/\bHANDY\b|\bPHONE\b|\bSHALLOW\b/, 'HANDY'], [/\bUSB\b/, 'USB'], [/\bISOLATED\b|\bIG\b/, 'IG'], [/\bTWIST\b|\bLOCKING\b/, 'LOCK'], [/\bDEDICATED\b/, 'DED']];
export function qualifiers(s: string): Set<string> {
  const t = ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  return new Set(QUALS.filter(([re]) => re.test(t)).map(([, q]) => q));
}
const RECEPT_RE = /\bRECEPT|\bOUTLET|\bDUPLEX\b|\bSIMPLEX\b|\bGFC?I\b|\bQUADPLEX\b/i;

/** Review fix S1 — a plain receptacle (simplex / duplex / floor): the family
 *  whose marks a second sheet may draw under another class name. Never a
 *  GFCI, WP, quad, handy-box … type. */
export function isPlainReceptacle(t: Pick<CountTarget, 'type' | 'description' | 'category'>): boolean {
  if (t.category !== 'device' || !RECEPT_RE.test(`${t.type} ${t.description}`)) return false;
  const q = qualifiers(`${t.type} ${t.description}`);
  return [...q].every(x => x === 'SIMPLEX');
}

interface Info {
  t: CountTarget;
  idx: number;
  tag: TagInfo;
  circuits: Set<string>;
  head: string[];
  expansion: string[] | null;
  recept: boolean;
}

function infoOf(t: CountTarget, idx: number, panels: Set<string> | null): Info {
  const tag = tagInfoOf(t.type);
  return {
    t, idx, tag, circuits: circuitsOf(t.description, panels), head: headOf(t.description),
    expansion: tagExpansion(tag.base, t.description), recept: RECEPT_RE.test(`${t.type} ${t.description}`),
  };
}

const FAMILY = (c: CountTarget['category']) => (c === 'equipment' || c === 'lighting_control' || c === 'device' || c === 'panel_circuit');

/** Priority of the canonical name: an equipment-schedule type that cites its
 *  circuits (a schedule row owns its quantity), then any type citing
 *  circuits, then the drawn legend symbol; ties keep the earlier one. */
function rank(i: Info): number {
  return (i.circuits.size ? 4 : 0) + (i.circuits.size && i.t.source === 'equipment_schedule' ? 2 : 0) + (i.t.source === 'legend' ? 1 : 0);
}

const eqSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

/** Modifiers that never make a different item ("electric water heater" =
 *  "water heater"); a legend symbol's own trailing mounting words
 *  ("exhaust fan recessed"). Anything else ("instantaneous", "kitchen",
 *  "circulating pump") is a different item. */
const NEUTRAL = new Set(['ELECTRIC', 'ELECTRICAL', 'NEW', 'EXISTING']);
const MOUNTING = new Set(['RECESSED', 'SURFACE', 'CEILING', 'WALL', 'ROOF', 'MOUNTED', 'BATHROOM', 'RESTROOM', 'TYPICAL', 'PENDANT']);
const core = (i: Info) => (i.expansion ?? i.head).filter(w => !NEUTRAL.has(w));
const same = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((w, k) => w === b[k]);

/** Review fix B2 / S4 — DIRECT evidence that two names are one item:
 *   * a shared tag: one tag's words are all of the other's leading words
 *     (PYLON / PYLON SIGN, ALC / ALC PANEL), the two tags expand to the same
 *     words (EWH / WH -> WATER HEATER), or one tag abbreviates a run of the
 *     other's description (LCP -> "LIGHTING CONTROL PANEL");
 *   * the same core words (neutral modifiers aside);
 *   * a legend symbol restating it: the symbol's core (mounting words
 *     aside) is a run of the other's description.
 *  Equal circuits are necessary when both cite circuits, never enough: an
 *  ice machine and a drink machine on A-6 are two machines. */
function directEvidence(a: Info, b: Info): string | null {
  if (!compatible(a, b) || distinctSiblings(a, b)) return null;
  if (a.circuits.size && b.circuits.size && !eqSet(a.circuits, b.circuits)) return null;
  const circ = a.circuits.size && b.circuits.size ? ` on the same circuit${a.circuits.size > 1 ? 's' : ''} ${[...a.circuits].join(', ')}` : '';
  // A numbered member is its own item; only a shared circuit AND a shared
  // tag could make another name of it.
  const tagA = normalizeTypeKey(a.t.type).split(/[\s/-]+/), tagB = normalizeTypeKey(b.t.type).split(/[\s/-]+/);
  const leading = (x: string[], y: string[]) => x.length < y.length && x.every((w, k) => w === y[k]);
  if ((a.tag.num || b.tag.num) && !(circ && (leading(tagA, tagB) || leading(tagB, tagA)))) return null;
  if (leading(tagA, tagB) || leading(tagB, tagA)) return `a shared tag (${a.t.type} / ${b.t.type})${circ}`;
  const nd = (x: string) => normDesc(x).split(' ').filter(w => !NEUTRAL.has(w)).join(' ');
  if (!a.tag.num && !b.tag.num && a.t.type.length <= 5 && b.t.type.length <= 5 && nd(a.t.type) === nd(b.t.type) && nd(a.t.type) !== normalizeTypeKey(a.t.type)) return `the same tag (${a.t.type} = ${b.t.type} = ${nd(a.t.type).toLowerCase()})${circ}`;
  // An abbreviation of the OTHER's whole item (its core, a legend's mounting
  // words aside) — or, when both cite the same circuits, of any run of its
  // description ("LCP" = the "lighting control panel" on B-25). "EF" is
  // never "kitchen exhaust fan".
  const coreOf = (y: Info) => (y.t.source === 'legend' ? core(y).filter(w => !MOUNTING.has(w)) : core(y));
  const abbrevOf = (x: Info, y: Info): string[] | null => {
    if (!/^[A-Z]{2,5}$/.test(x.tag.base) || x.tag.num) return null;
    const run = initialsRun(x.tag.base, y.t.description);
    if (!run) return null;
    return circ || same(run.filter(w => !NEUTRAL.has(w)), coreOf(y)) ? run : null;
  };
  const ab = abbrevOf(a, b), ba = abbrevOf(b, a);
  if (ab || ba) return `${ab ? a.t.type : b.t.type} abbreviates "${(ab ?? ba)!.join(' ').toLowerCase()}"${circ}`;
  if (same(core(a), core(b))) return `the same item — "${core(a).join(' ').toLowerCase()}"${circ}`;
  const legendIn = (x: Info, y: Info) => {
    if (x.t.source !== 'legend') return null;
    const c = core(x).filter(w => !MOUNTING.has(w));
    return c.length >= 2 && containsRun(sig(y.t.description), c) ? c : null;
  };
  const lr = legendIn(a, b) ?? legendIn(b, a);
  if (lr) return `the legend symbol restates it — "${lr.join(' ').toLowerCase()}"${circ}`;
  return null;
}

/** The run of a description's words whose initials are the tag. */
function initialsRun(tagBase: string, desc: string): string[] | null {
  return tagExpansion(tagBase, desc);
}

/** Receptacle types match only with the same qualifiers ("DUPLEX" never is
 *  the handy-box or GFCI duplex); a device never matches a non-device
 *  receptacle. */
function compatible(a: Info, b: Info): boolean {
  if (!FAMILY(a.t.category) || !FAMILY(b.t.category)) return false;
  if (a.recept !== b.recept) return false;
  if (a.recept) {
    const qa = qualifiers(`${a.t.type} ${a.t.description}`), qb = qualifiers(`${b.t.type} ${b.t.description}`);
    return eqSet(qa, qb);
  }
  return true;
}

/** Numbered siblings (PP#1 / PP#2, DISCON A / B, EF-A / EF-B, M1 / M2) are
 *  always distinct — even with identical descriptions (review fix B3). */
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

/** Review fix S3 — a questionable combined tag or class ("(3) rooftop
 *  units" listed as RTU-1/RTU-2): one blocking question. */
export interface ConsolidationQuestion { key: string; type: string; reason: string }

export function consolidateTargets(targetsIn: CountTarget[], opts: { panels?: string[] } = {}): Consolidation {
  const targets = targetsIn.map(t => ({ ...t }));
  const panels = opts.panels?.length ? new Set(opts.panels.map(p => p.toUpperCase().replace(/^PANEL(BOARD)?\s*/, '').replace(/["'\s]/g, ''))) : null;
  let infos = targets.map((t, i) => infoOf(t, i, panels));
  const merges: ConsolidationMerge[] = [];
  const uncertain: UncertainSynonym[] = [];
  const questions: ConsolidationQuestion[] = [];
  const merged = new Set<string>();
  const byKey = () => new Map(infos.map(i => [i.t.key, i]));
  const mark = (i: Info, into: string[], kind: MergeKind, basis: string) => {
    if (merged.has(i.t.key) || !into.length) return;
    merged.add(i.t.key);
    merges.push({ key: i.t.key, type: i.t.type, description: i.t.description, into, kind, basis });
  };
  const isCand = (i: Info) => !isFixtureCategory(i.t.category) && i.t.role !== 'host' && FAMILY(i.t.category);

  // 1. Combined tags: "RTU-1/RTU-2", "RTU-1/2/3" = their members, never a
  //    type of their own. Review fix S3 — a member that is not on the list
  //    is created (so it is counted, or asked about when nothing shows it):
  //    a combined tag never stacks on the members that are there.
  for (const i of infos.filter(isCand)) {
    const m = i.tag.members;
    if (!m) continue;
    const keys = byKey();
    const present = m.filter(k => keys.has(k) && k !== i.t.key);
    const mult = /\(\s*(\d{1,2})\s*\)/.exec(i.t.description);
    if (mult && Number(mult[1]) !== m.length) {
      questions.push({ key: i.t.key, type: i.t.type, reason: `"${i.t.type}" names ${m.length} (${m.join(', ')}) but its description says (${mult[1]})` });
    }
    if (!present.length) continue; // none listed on their own: the combined tag is the entity (S2 counts one per member)
    for (const k of m.filter(x => !present.includes(x))) {
      const t: CountTarget = {
        ...i.t, type: k, key: k,
        description: `${k}: listed with ${i.t.type} — ${i.t.description.replace(/\(\s*\d+\s*\)\s*/g, '').replace(/\b(?:ckts?|circuits?)\b[^;)]*/gi, '').replace(/[,;\s]+$/, '').trim()}`,
        symbolHint: `equipment tag "${k}"`,
      };
      delete t.mergedInto; delete t.aliases;
      targets.push(t);
      infos.push(infoOf(t, targets.length - 1, panels));
    }
    mark(i, m, 'combined', `the combined tag ${i.t.type} names ${m.join(' + ')} — counted once, on each member${present.length < m.length ? ` (${m.filter(x => !present.includes(x)).join(', ')} not listed on its own — added, to be counted or asked about)` : ''}`);
  }
  infos = targets.map((t, i) => infoOf(t, i, panels));
  const candidates = infos.filter(isCand);
  const keyed = byKey();

  // 2. A circuit set that is exactly the union of other types' circuits,
  //    whose words name what each part is (review fix S4: "Wall sign
  //    J-boxes, A-6, A-14, A-16" = FRONT + SIDE WALL SIGN; a time clock that
  //    CONTROLS those circuits cites none of its own).
  for (const i of candidates) {
    if (merged.has(i.t.key) || i.circuits.size < 2) continue;
    const parts = candidates.filter(o => o !== i && !merged.has(o.t.key) && o.circuits.size && [...o.circuits].every(c => i.circuits.has(c)) && !eqSet(o.circuits, i.circuits));
    const union = new Set(parts.flatMap(p => [...p.circuits]));
    const disjoint = parts.reduce((s, p) => s + p.circuits.size, 0) === union.size;
    const words = new Set(sig(`${i.t.type} ${i.t.description}`));
    const named = parts.every(p => { const c = core(p); return c.length > 0 && words.has(c[c.length - 1]); });
    if (parts.length >= 2 && disjoint && named && eqSet(union, i.circuits)) {
      mark(i, parts.map(p => p.t.key), 'combined', `its circuits ${[...i.circuits].join(', ')} are exactly ${parts.map(p => `${p.t.type} (${[...p.circuits].join(', ')})`).join(' + ')}`);
    }
  }

  // 3. Direct pairwise evidence only (review fix B2). Specific items (those
  //    citing their own circuits) merge only with direct evidence between
  //    them. A name with no circuits of its own that directly matches ONE
  //    entity is another name of it; one that matches two or more distinct
  //    entities is GENERIC — never a bridge between them — and is decided
  //    by its marks (uncertain) instead.
  const live = candidates.filter(i => !merged.has(i.t.key) && !i.tag.range && !i.tag.members);
  const edge = new Map<string, Map<string, string>>();
  for (const i of live) edge.set(i.t.key, new Map());
  for (let x = 0; x < live.length; x++) {
    for (let y = x + 1; y < live.length; y++) {
      const why = directEvidence(live[x], live[y]);
      if (!why) continue;
      edge.get(live[x].t.key)!.set(live[y].t.key, why);
      edge.get(live[y].t.key)!.set(live[x].t.key, why);
    }
  }
  const adj = (a: string, b: string) => edge.get(a)?.has(b) ?? false;
  // Entities: specific items grouped by direct evidence, as cliques only.
  const entityOf = new Map<string, string>();
  const specific = live.filter(i => i.circuits.size).sort((p, q) => rank(q) - rank(p) || p.idx - q.idx);
  for (const i of specific) {
    if (entityOf.has(i.t.key)) continue;
    const group = [i];
    for (const o of specific) if (!entityOf.has(o.t.key) && o !== i && group.every(g => adj(g.t.key, o.t.key))) group.push(o);
    for (const g of group) entityOf.set(g.t.key, i.t.key);
  }
  // Names without circuits: which entities / other plain names they match.
  const plain = live.filter(i => !i.circuits.size);
  const generic = new Set<string>();
  for (const i of plain) {
    const ents = new Set([...edge.get(i.t.key)!.keys()].filter(k => entityOf.has(k)).map(k => entityOf.get(k)!));
    if (ents.size >= 2) generic.add(i.t.key);
  }
  // Plain names that bridge two plain names which do not match each other
  // are generic too ("Wall sign" between FRONT and SIDE wall sign).
  for (const i of plain) {
    if (generic.has(i.t.key)) continue;
    const nb = [...edge.get(i.t.key)!.keys()].filter(k => !generic.has(k));
    const distinct = nb.some((a, k) => nb.slice(k + 1).some(b => !adj(a, b) && (entityOf.get(a) ?? a) !== (entityOf.get(b) ?? b)));
    if (distinct) generic.add(i.t.key);
  }
  for (const i of plain) {
    if (generic.has(i.t.key)) continue;
    const ents = new Set([...edge.get(i.t.key)!.keys()].filter(k => entityOf.has(k)).map(k => entityOf.get(k)!));
    if (ents.size === 1) entityOf.set(i.t.key, [...ents][0]);
  }
  // Plain names matching only other plain names: cliques.
  const rest = plain.filter(i => !generic.has(i.t.key) && !entityOf.has(i.t.key)).sort((p, q) => rank(q) - rank(p) || p.idx - q.idx);
  for (const i of rest) {
    if (entityOf.has(i.t.key)) continue;
    const group = [i];
    for (const o of rest) if (!entityOf.has(o.t.key) && o !== i && group.every(g => adj(g.t.key, o.t.key))) group.push(o);
    for (const g of group) entityOf.set(g.t.key, i.t.key);
  }
  // Fold every member of an entity into its canonical (the best-ranked).
  const members = new Map<string, Info[]>();
  for (const i of live) { const e = entityOf.get(i.t.key); if (e) members.set(e, [...(members.get(e) ?? []), i]); }
  for (const group of members.values()) {
    if (group.length < 2) continue;
    const canon = group.slice().sort((p, q) => rank(q) - rank(p) || p.idx - q.idx)[0];
    for (const m of group) {
      if (m === canon) continue;
      const why = edge.get(m.t.key)!.get(canon.t.key) ?? [...edge.get(m.t.key)!.entries()].find(([k]) => entityOf.get(k) === entityOf.get(canon.t.key))?.[1] ?? 'the same item';
      mark(m, [canon.t.key], 'synonym', `another name for ${canon.t.type} — ${why}`);
    }
  }

  // 4. Classes: an un-numbered name that is a numbered family's base (RTU,
  //    PP) — or a combined tag's base whose members are not listed (T =
  //    "T-1/T-2") — is that family. Review fix N4 — only the SAME tag
  //    letters fold without a count; a drawn legend symbol, or a name that
  //    only abbreviates to the family ("DISCONNECT" / DS-n), is counted and
  //    decided by its marks (it may stand for items the family doesn't list).
  const families = new Map<string, Info[]>();
  for (const i of candidates) {
    if (merged.has(i.t.key)) continue;
    if (i.tag.num || i.tag.members) families.set(i.tag.base, [...(families.get(i.tag.base) ?? []), i]);
  }
  for (const i of candidates) {
    if (merged.has(i.t.key) || i.tag.num || i.tag.members || generic.has(i.t.key)) continue;
    for (const [base, fam] of families) {
      const headInit = i.head.length >= 2 ? i.head.map(w => w[0]).join('') : '';
      const exact = i.tag.base === base;
      const baseHit = exact || (i.tag.range ? sameBase(i.tag.base.replace(/\bTAG\b/g, '').trim(), base) : false)
        || (!i.tag.range && base.length >= 2 && (sameBase(normDesc(i.t.type), base) || headInit === base));
      if (!baseHit) continue;
      if (i.circuits.size) continue; // a specific load, not the class
      const fm = fam.filter(f => !merged.has(f.t.key));
      if (!fm.length) continue;
      if (i.tag.range) {
        const [lo, hi] = i.tag.range;
        const inRange = fm.filter(m => m.tag.num && Number(m.tag.num) >= lo && Number(m.tag.num) <= hi);
        if (!inRange.length) continue;
        mark(i, inRange.map(m => m.t.key), 'tag_legend', `the legend's tag marker for ${inRange.map(m => m.t.type).join(', ')} — each mark is one of them (bound by its circuit)`);
        targets[i.idx].role = 'host';
        break;
      }
      const into = fm.map(m => m.t.key);
      if (i.t.source === 'legend' || !exact) {
        uncertain.push({ key: i.t.key, type: i.t.type, candidates: into, basis: `"${i.t.type}" is the general ${i.t.source === 'legend' ? 'symbol' : 'name'} for ${fm.map(m => m.t.type).join(', ')}` });
        generic.add(i.t.key);
        break;
      }
      mark(i, into, 'class', `the general name for ${fm.map(m => m.t.type).join(', ')} — they are counted one by one`);
      break;
    }
  }

  // 5. Generic names (step 3's, and a tag word shared by two or more other
  //    tags: "SIGN" in FRONT WALL SIGN / SIDE WALL SIGN / PYLON SIGN) are
  //    UNCERTAIN: counted on their own, folded when none is drawn, a
  //    question when drawn where a candidate is (or when the candidates are
  //    owned by the schedules), never folded blind and never a bridge.
  const canonicalOf = (k: string) => {
    const m = merges.find(x => x.key === k);
    return m && m.kind === 'synonym' ? m.into[0] : k;
  };
  for (const i of candidates) {
    if (merged.has(i.t.key) || uncertain.some(u => u.key === i.t.key) || i.tag.num || i.tag.members || i.tag.range || i.circuits.size) continue;
    const token = i.tag.base.split(' ').length === 1 && i.tag.base.length >= 3 ? i.tag.base : null;
    const hits = new Set<string>();
    for (const o of candidates) {
      if (o === i || !compatible(i, o) || merges.find(x => x.key === o.t.key)?.kind === 'tag_legend') continue;
      const tokenHit = token && token !== o.tag.base && new RegExp(`(^| )${token}( |$)`).test(normalizeTypeKey(o.t.type).replace(/[^A-Z0-9 ]/g, ' '));
      // A general phrase restating numbered members too ("Motion sensor" vs
      // M1 "Motion sensor CMR-9" and M2 "Motion sensor LSXR").
      const phraseHit = i.head.length >= 2 && containsRun(sig(o.t.description), i.head);
      if (!tokenHit && !phraseHit && !edge.get(i.t.key)?.has(o.t.key)) continue;
      // Another generic name is no entity to count against; a class or
      // combined name stands for its members.
      if (generic.has(o.t.key) || uncertain.some(x => x.key === o.t.key)) continue;
      const via = merges.find(x => x.key === o.t.key);
      for (const k of via && via.kind !== 'synonym' ? via.into : [canonicalOf(o.t.key)]) hits.add(k);
    }
    hits.delete(i.t.key);
    if (hits.size < 2 && !generic.has(i.t.key)) continue;
    const into = [...hits];
    if (!into.length) continue;
    const names = into.map(k => keyed.get(k)?.t.type ?? k).join(', ');
    uncertain.push({ key: i.t.key, type: i.t.type, candidates: into, basis: `"${i.t.type}" could be any of ${names}` });
  }

  // A synonym whose canonical name turned out to be a class / combined name
  // itself points at what that name stands for.
  for (let pass = 0; pass < 3; pass++) {
    for (const m of merges) {
      if (!m.into.some(k => merges.some(x => x.key === k))) continue;
      const next = m.into.flatMap(k => merges.find(x => x.key === k)?.into ?? [k]);
      const via = merges.find(x => m.into.includes(x.key))!;
      m.into = [...new Set(next)];
      if (m.kind === 'synonym' && via.kind !== 'synonym') { m.kind = via.kind; m.basis = `${m.basis}; ${via.type}: ${via.basis}`; }
    }
  }

  // Apply.
  const idx = new Map(targets.map((t, k) => [t.key, k]));
  const aliasOf = new Map<string, string>();
  for (const m of merges) {
    const t = targets[idx.get(m.key)!];
    t.mergedInto = m.into;
    t.mergeKind = m.kind;
    t.mergeReason = m.basis;
    if (m.kind === 'synonym') aliasOf.set(m.key, m.into[0]);
  }
  for (const u of uncertain) targets[idx.get(u.key)!].uncertainOf = u.candidates;
  for (const m of merges) {
    if (m.kind !== 'synonym' && m.kind !== 'combined' && m.kind !== 'class') continue;
    const alias = targets[idx.get(m.key)!];
    for (const k of m.into) {
      const c = targets[idx.get(k)!];
      if (!c) continue;
      c.aliases = [...(c.aliases ?? []), alias.key];
      if (m.kind === 'synonym') {
        c.symbolHint = `${c.symbolHint}${c.symbolHint ? '; ' : ''}also listed as ${alias.type}${alias.description && alias.description !== alias.type ? ` ("${alias.description.slice(0, 60)}")` : ''}`;
        if (!c.assignment && alias.assignment) c.assignment = alias.assignment;
      }
    }
  }
  return { targets, merges, uncertain, aliasOf, questions };
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
export function resolveUncertainSynonyms<T extends { key: string; type: string; status: string; count: number; flags: string[]; reason: string; mergedInto?: string; synonymQuestion?: { candidates: string[]; coincident: number; count: number; why?: string } }>(
  types: T[],
  uncertain: UncertainSynonym[],
  marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number }>,
  radiusPt = 0.35 * 72,
  opts: { scheduleOwned?: Set<string> } = {},
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
    // Review fix S6 — candidates with no marks to compare (or quantified by
    // the schedules) can't prove a different device: "P" drawn 6 times while
    // PP#1-6 come from Panel A rows would stack 6 more poles. Ask.
    const owned = u.candidates.filter(k => opts.scheduleOwned?.has(k));
    if (!theirs.length || owned.length) {
      t.synonymQuestion = { candidates: u.candidates, coincident: t.count, count: t.count, why: owned.length ? `${owned.join(', ')} ${owned.length === 1 ? 'is' : 'are'} counted from the schedules` : 'none of them has marks to compare with' };
      t.flags.push(`${t.type}: ${u.basis}; ${t.synonymQuestion.why} — the same items under a general name? Needs review.`);
      continue;
    }
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
  panelsIn: string[] = [],
): Array<{ tag: string; member: string; circuit: string; sheetKey: string }> {
  const out: Array<{ tag: string; member: string; circuit: string; sheetKey: string }> = [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  const markCircuits = (c: string) => {
    const m = /^([A-Z]{1,2})(.*)$/.exec(c.toUpperCase().replace(/[^A-Z0-9,/&]/g, ''));
    return m ? m[2].split(/[,/&]/).filter(Boolean).map(n => `${m[1]}${Number(n)}`) : [];
  };
  // The drawing's panels; without a list, the panels the tag marks' own
  // circuit tags name ("A29" -> A).
  const panels = new Set(panelsIn.length ? panelsIn.map(p => p.toUpperCase().replace(/^PANEL(BOARD)?\s*/, '').replace(/["'\s]/g, ''))
    : sheets.flatMap(s => s.placed.map(p => /^([A-Z]{1,2})\d/.exec((p.circuit ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))?.[1] ?? '').filter(Boolean)));
  for (const tag of targets.filter(t => t.mergeKind === 'tag_legend' && t.mergedInto?.length)) {
    const members = tag.mergedInto!.map(k => byKey.get(k)).filter((t): t is CountTarget => !!t)
      .map(t => ({ key: t.key, circuits: new Set([...circuitsOf(t.description, panels), ...(scheduleCircuits.get(t.key) ?? [])]) }));
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
