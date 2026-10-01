// Evidence round 2.1 / 2.2 — typicals: "per-unit" device packages read from
// legends and note blocks, and their expansion by a counted host. Pure.
//
// Kissimmee E-2 #9 POWER POLE LEGEND: "(2) CHECKOUT COUNTER POWER POLE WITH
// ONE DUPLEX OUTLET PRE-WIRED ON POLE…", "(4) TEST STATION POWER POLE WITH
// ONE SIMPLEX OUTLET AND ONE DUPLEX OUTLET…", "(6) COMMERCIAL COUNTER POWER
// POLE WITH TWO DUPLEX OUTLETS…". The plan shows each pole as a hexagon tag
// 1-6. Nothing counted those outlets: they are drawn nowhere.
//
// 2.1 A narrow structured call (text or the viewport crop) returns packages:
//     host (what carries the devices), how the host is marked on the plans
//     (a tag / symbol, or an existing count target), and the devices with an
//     explicit quantity each, plus the verbatim quote. Validated here: a
//     device maps to a COUNT TARGET (the model's key, else a conservative
//     keyword match); a quantity that is not stated ("simplex outlets in
//     junction boxes on floor") is never guessed — that device is drawn
//     individually and counted where it is drawn.
// 2.2 Multiplier binding: a host that is an existing target (the legend's
//     "junction box with flex… receptacle mounted to base plate" symbol)
//     binds to that target's count; otherwise the host becomes a HOST
//     target (role 'host') the counter counts as a marker (hexagon tag 4),
//     never a takeoff line of its own. Expansion = hosts × per-host qty,
//     minus devices of that type drawn individually at a host (within
//     HOST_RADIUS_PT of a host mark). No host count (not found, unreadable)
//     = no expansion and a BLOCKING review item: the multiplier is never
//     guessed.
import { parseAIJSON } from '../json';
import { normalizeTypeKey, type CountTarget } from '../countTargets';
import type { RectIn } from './viewports';

export interface TypicalDevice {
  /** The count target this device is; null when it could not be mapped. */
  targetKey: string | null;
  text: string;
  /** Per host; null = not stated (the device is drawn individually). */
  qty: number | null;
}

export interface TypicalPackage {
  id: string;
  sheetKey: string;
  viewportId: string | null;
  viewportLabel: string;
  host: string;
  /** Tag printed at each host on the plans ("4"), '' when none. */
  hostTag: string;
  /** How a host is drawn on the plans, for the counter ("hexagon tag 4"). */
  hostMarker: string;
  /** An existing count target that IS the host (bound, not counted again). */
  hostTargetKey: string | null;
  devices: TypicalDevice[];
  quote: string;
  source: 'text' | 'vision';
  boxIn?: RectIn;
}

export interface ParsedTypicals { packages: TypicalPackage[]; rejected: string[] }

const WORD_QTY: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SINGLE: 1, PAIR: 2 };

function clean(s: unknown, max = 200): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function qtyOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v <= 50 ? v : null;
  const s = String(v).trim().toUpperCase();
  if (WORD_QTY[s]) return WORD_QTY[s];
  const n = Number(s);
  return Number.isInteger(n) && n > 0 && n <= 50 ? n : null;
}

/** Device words that must match between a package device and a target. */
const QUALIFIERS = ['GFCI', 'GFI', 'WEATHERPROOF', 'WP', 'QUAD', 'QUADPLEX', 'SIMPLEX', 'SINGLE', 'DUPLEX', 'FLOOR', 'USB', 'ISOLATED', 'DATA', 'PHONE', 'HANDY', 'DEDICATED', 'TWIST', '30A', '50A', 'RANGE', 'DRYER'];

function words(s: string): Set<string> {
  return new Set(s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => (w === 'GFI' ? 'GFCI' : w === 'SINGLE' ? 'SIMPLEX' : w === 'WEATHERPROOF' ? 'WP' : w === 'QUADPLEX' ? 'QUAD' : w)));
}

/** Pure: a conservative device -> target match when the model gave no valid
 *  key. The target must be a device/receptacle-like target whose qualifier
 *  words (GFCI, WP, simplex, duplex, quad, floor, phone, handy…) are all in
 *  the device text, and the device's own qualifiers all in the target. A
 *  bare "receptacle"/"outlet" maps to the plain duplex target. Ties -> the
 *  one with the fewest extra words; still tied -> null. */
export function matchDeviceToTarget(text: string, targets: CountTarget[]): CountTarget | null {
  const dw = words(text);
  const recept = dw.has('RECEPTACLE') || dw.has('RECEPTACLES') || dw.has('OUTLET') || dw.has('OUTLETS') || dw.has('RECEPT');
  if (!recept) return null;
  const quals = (w: Set<string>) => new Set(QUALIFIERS.map(q => (q === 'GFI' ? 'GFCI' : q === 'SINGLE' ? 'SIMPLEX' : q === 'WEATHERPROOF' ? 'WP' : q === 'QUADPLEX' ? 'QUAD' : q)).filter(q => w.has(q)));
  const dq = quals(dw);
  // A receptacle is a duplex unless it says simplex / quad.
  if (!dq.has('SIMPLEX') && !dq.has('QUAD')) dq.add('DUPLEX');
  const cands = targets.filter(t => t.category === 'device' && (t as CountTarget & { role?: string }).role !== 'host').map(t => {
    const tw = words(`${t.type} ${t.description}`);
    const tq = quals(tw);
    return { t, tq, extra: [...tw].length };
  }).filter(c => c.tq.size > 0 && [...dq].every(q => c.tq.has(q) || (q === 'DUPLEX' && c.tq.has('DUPLEX'))) && [...c.tq].every(q => dq.has(q) || q === 'FLOOR'));
  if (!cands.length) return null;
  cands.sort((a, b) => a.tq.size - b.tq.size || a.extra - b.extra);
  if (cands.length > 1 && cands[0].tq.size === cands[1].tq.size && cands[0].extra === cands[1].extra) return null;
  return cands[0].t;
}

/** Pure: the typicals model's strict JSON -> validated packages. */
export function parseTypicalsReply(
  text: string,
  ctx: { sheetKey: string; source: 'text' | 'vision'; viewports: Array<{ id: string; label: string }>; targets: CountTarget[] },
): ParsedTypicals | null {
  const parsed = parseAIJSON(text);
  const raw = parsed && Array.isArray(parsed.packages) ? parsed.packages as unknown[] : null;
  if (!raw) return null;
  const byKey = new Map(ctx.targets.map(t => [t.key, t]));
  const rejected: string[] = [];
  const packages: TypicalPackage[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') { rejected.push(`#${i}: not an object`); return; }
    const r = item as Record<string, unknown>;
    const host = clean(r.host, 120);
    const quote = clean(r.quote, 400);
    if (!host || !quote) { rejected.push(`#${i}: no host or no quote`); return; }
    const vpRaw = clean(r.viewport, 60);
    const vp = ctx.viewports.find(v => v.id === vpRaw || v.label === vpRaw || v.id.endsWith(`@${vpRaw}`)) ?? (ctx.viewports.length === 1 ? ctx.viewports[0] : undefined);
    const hostTargetRaw = normalizeTypeKey(clean(r.host_target, 80));
    const hostTargetKey = hostTargetRaw && byKey.has(hostTargetRaw) ? hostTargetRaw : null;
    const devices: TypicalDevice[] = [];
    for (const d of Array.isArray(r.devices) ? r.devices as unknown[] : []) {
      if (!d || typeof d !== 'object') continue;
      const dr = d as Record<string, unknown>;
      const dtext = clean(dr.text ?? dr.device, 120);
      if (!dtext) continue;
      const k = normalizeTypeKey(clean(dr.target, 80));
      let target = k && byKey.has(k) ? byKey.get(k)! : null;
      if (target && target.category !== 'device') target = null;
      if (!target) target = matchDeviceToTarget(dtext, ctx.targets);
      devices.push({ targetKey: target?.key ?? null, text: dtext, qty: qtyOf(dr.qty) });
    }
    if (!devices.length) { rejected.push(`#${i} (${host}): no devices`); return; }
    const hostTag = clean(r.host_tag, 12);
    const hostMarker = clean(r.host_marker, 120);
    if (!hostTargetKey && !hostTag && !hostMarker) { rejected.push(`#${i} (${host}): no way to find the hosts on the plans`); return; }
    packages.push({
      id: `${ctx.sheetKey}@${vp ? vp.id.split('@').pop() : 'u'}#${i + 1}`,
      sheetKey: ctx.sheetKey,
      viewportId: vp?.id ?? null,
      viewportLabel: vp?.label ?? '',
      host, hostTag, hostMarker, hostTargetKey, devices, quote, source: ctx.source,
    });
  });
  return { packages, rejected };
}

/** Host target key for a package that is not bound to an existing target. */
export function hostKeyOf(p: TypicalPackage): string {
  return p.hostTargetKey ?? normalizeTypeKey(`HOST ${p.hostTag ? `TAG ${p.hostTag} ` : ''}${p.host}`).slice(0, 80);
}

/** Pure (2.2): the HOST targets the counter must count — one per distinct
 *  unbound host. role 'host': counted and used as a multiplier, never a
 *  takeoff line, never a zero-count review item of its own. */
export function hostTargets(packages: TypicalPackage[], existing: CountTarget[]): Array<CountTarget & { role: 'host' }> {
  const have = new Set(existing.map(t => t.key));
  const out: Array<CountTarget & { role: 'host' }> = [];
  for (const p of packages) {
    if (p.hostTargetKey) continue;
    const key = hostKeyOf(p);
    if (have.has(key) || out.some(o => o.key === key)) continue;
    if (!p.devices.some(d => d.qty != null && d.targetKey)) continue;
    out.push({
      type: key, key, description: p.host,
      symbolHint: p.hostMarker || (p.hostTag ? `tag "${p.hostTag}" at each ${p.host.toLowerCase()}` : p.host),
      wattage: null, category: 'device', source: 'legend', sourceSheet: '',
      headsPerPole: null, emergency: false, role: 'host',
    });
  }
  return out;
}

export function isHostTarget(t: Pick<CountTarget, 'key'> & { role?: string }): boolean {
  return t.role === 'host';
}

/** Fix round S3 — a device drawn "at" a host: within 0.75" of the host's
 *  tag on the host's main plan (a pole tag sits on a leader 0.5-1" from the
 *  pole), with enlarged-plan marks mapped onto the main plan and marks on
 *  the other sheets of the level aligned onto it (the caller does both). */
export const HOST_RADIUS_IN = 0.75;
/** S2 — an unstated per-host quantity is "drawn" when devices of that type
 *  are within 2" (16 ft at 1/8") of a host. */
export const HOST_AREA_IN = 2;
/** Kept for older callers (points). */
export const HOST_RADIUS_PT = HOST_RADIUS_IN * 72;

/** Positions in DISPLAYED INCHES on the host sheet's main-plan frame. */
export interface HostMark {
  sheetKey: string; x: number; y: number; circuit?: string;
  /** Typical fix — the tag the counter read at this host ("4" in hexagon
   *  4), when it reported one: identifies the host's TYPE in its legend. */
  tag?: string;
  /** Accuracy round B2/B3 — the mark on its own sheet (PDF points), for the
   *  per-pole question's jump link; the sheet's short label. */
  pdf?: { sheetKey: string; x: number; y: number };
  sheetLabel?: string;
  /** Fix round 1 (review S1) — which counted type the mark is, and the sheet
   *  it was drawn on: two marks of ONE type on ONE sheet are two poles (the
   *  counter already de-duplicated them), never one. */
  typeKey?: string;
  srcSheet?: string;
}

/** Accuracy round B2 — the host total a drawing STATES ("PP-1..6", "(6)
 *  power poles #1-#6"): a reconciliation target, never the count. */
export interface StatedHosts { total: number; tags: string[]; label: string }

export interface TypicalExpansion {
  packageId: string;
  host: string;
  hostKey: string;
  deviceKey: string;
  deviceText: string;
  perHost: number;
  /** null = the host count is not known (blocking review). */
  hostCount: number | null;
  hostSheets: string[];
  /** Devices of this type drawn individually at a host on the host's own
   *  sheet (subtracted). */
  drawnAtHosts: number;
  /** Fix round S3 — devices of this type at a host's position on ANOTHER
   *  sheet of the level (aligned): may be the host's own outlet drawn on the
   *  other layer, or a different device above / beside it (Kissimmee: E-1's
   *  "duplex outlet at deck", circuit A-31, sits over the checkout pole,
   *  circuit A-29). Never subtracted silently — the estimator decides. */
  possibleAtHosts?: number;
  expanded: number;
  /** 'assembly' (fix round S1): the device is part of the host's own
   *  assembly line (the host IS a counted type whose own legend / schedule
   *  row names the device) — priced with the host, never a second line.
   *  'qty_unstated' (S2): the legend names the device but not how many per
   *  host — never guessed; a review item. */
  status: 'expanded' | 'no_multiplier' | 'assembly' | 'qty_unstated' | 'host_unassigned';
  /** Typical fix — the host's TYPE within its legend (hostTypeId). */
  hostType?: string;
  /** Typical fix — how the per-type host count was identified when several
   *  legend types share one host target: never the shared total. */
  binding?: HostTypeSource;
  /** Review fix N5 — a notes line naming the assembly's own device again:
   *  part of the assembly, shown as information. */
  restated?: boolean;
  reason: string;
  quote: string;
  sheetKey: string;
  viewportId: string | null;
  viewportLabel: string;
}

/** Typical fix — how a host's TYPE is identified when several legend
 *  types share one counted host (six "PP-1..6" poles, five pole types in
 *  the #9 legend), in order: the tag at each host, a schedule / note that
 *  maps hosts to types, a one-to-one legend (one entry per host tag). */
export type HostTypeSource = 'tag' | 'schedule' | 'one_to_one' | 'every_host';

export interface HostTypeAssignment { count: number; source: HostTypeSource; evidence: string }

/** Typical fix — one legend's host types sharing ONE host count with no
 *  identification: nothing is expanded; ONE blocking review item asks
 *  which host is which type. `suggested` is a suggestion only — never
 *  counted until the estimator confirms it. */
export interface HostAssignmentGroup {
  hostKey: string;
  /** The generic host name ("power pole"). */
  hostNoun: string;
  hostCount: number;
  viewportLabel: string;
  sheetKey: string;
  types: Array<{
    typeId: string;
    packageId: string;
    host: string;
    hostTag: string;
    quote: string;
    /** Stated per-host devices (what a confirmed host of this type adds). */
    devices: Array<{ key: string; text: string; perHost: number }>;
    /** Devices the legend names without a quantity (never multiplied). */
    unstated: Array<{ key: string; text: string }>;
    suggested: number | null;
  }>;
  suggestion: { source: 'table_note' | 'ai_note' | 'one_each'; note: string; label: string; unassigned: number } | null;
  /** Devices of a stated type drawn within HOST_RADIUS_IN of ANY host of
   *  the group (which host is not known): shown, never subtracted. */
  drawnNearHosts: Array<{ key: string; count: number }>;
  /** Accuracy round B3 — the distinct physical hosts NOT bound to a type by
   *  their tag (one question member each), and the stated hosts not found
   *  on the plans. Absent on groups from earlier runs (answered per type). */
  hosts?: Array<{ id: string; sheetKey: string; sheetLabel?: string; x: number; y: number; pdf?: { sheetKey: string; x: number; y: number }; tag?: string; circuit?: string; suggestedType?: string }>;
  unlocated?: Array<{ id: string; tag?: string }>;
  /** Fix round 4 — enlarged-plan marks held for "repeats or adds?" (one
   *  member each; typed = added to the line, "not a host" = a repeat). */
  held?: Array<{ id: string; sheetKey: string; sheetLabel?: string; viewportLabel: string; pdf?: { sheetKey: string; x: number; y: number } }>;
  /** Hosts found on the plans (distinct), and what the drawing states. */
  found?: number;
  stated?: StatedHosts;
  /** Hosts bound to a type by the tag read at them (already expanded). */
  bound?: Array<{ typeId: string; count: number; tags: string[] }>;
}

/** Accuracy round B3 — the answer "this mark is not one of these hosts". */
export const NOT_A_HOST = 'not_a_host';

/** Pure (accuracy round B2): the distinct physical hosts among marks placed
 *  in one frame (displayed inches on the host's main plan): two marks within
 *  `radiusIn` of each other (a pole's tag and its legend symbol, the same
 *  pole on two aligned sheets) are one host — but never two marks of the SAME
 *  type on the SAME sheet. The first mark of a cluster is kept; a tag /
 *  circuit read on any of its marks is carried. */
export const HOST_DEDUPE_IN = 0.5;
export function distinctHosts(marks: HostMark[], radiusIn = HOST_DEDUPE_IN): HostMark[] {
  const out: HostMark[] = [];
  // Each cluster remembers which (type, source sheet) marks it already holds:
  // a second mark of the same type on the same sheet is a second pole, so it
  // never joins that cluster (review S1). A mark with no type info (older
  // callers) is "unknown" and may join any cluster.
  const held: Array<Set<string>> = [];
  const idOf = (m: HostMark) => (m.typeKey ? `${m.typeKey}|${m.pdf?.sheetKey ?? m.srcSheet ?? m.sheetKey}` : null);
  for (const m of marks) {
    const id = idOf(m);
    const i = out.findIndex((o, k) => o.sheetKey === m.sheetKey && Math.hypot(o.x - m.x, o.y - m.y) <= radiusIn && !(id && held[k].has(id)));
    if (i < 0) { out.push({ ...m }); held.push(new Set(id ? [id] : [])); continue; }
    const same = out[i];
    if (id) held[i].add(id);
    if (!same.tag && m.tag) same.tag = m.tag;
    if (!same.circuit && m.circuit) same.circuit = m.circuit;
  }
  return out;
}

/** Pure (accuracy round B2): what a host target states about its total —
 *  its tag range ("PP-1..6" -> 1..6) or an explicit "(6) power poles". */
export function statedHosts(t: Pick<CountTarget, 'key' | 'description' | 'type'> | undefined, label: string): StatedHosts | null {
  if (!t) return null;
  const range = hostTagRange(t);
  if (range) return { total: range.length, tags: range, label };
  const m = /\((\d{1,2})\)\s+(?:[A-Z]+\s+){0,2}(?:POLES?|HOSTS?|UNITS?)\b/i.exec(`${t.type} ${t.description}`);
  return m && Number(m[1]) > 1 ? { total: Number(m[1]), tags: [], label } : null;
}

/** Pure (accuracy round B3): partial tag binding — a host whose read tag is
 *  a legend entry's number AND unique among the hosts is that type; every
 *  other host (untagged, an unknown tag, a tag read on two hosts) is left
 *  for the estimator. */
export function partialTagBinding(marks: HostMark[], types: Array<{ typeId: string; hostTag: string }>, bindable: (m: HostMark) => boolean = () => true): { bound: Map<string, HostMark[]>; unbound: HostMark[]; ambiguous: Map<HostMark, string> } {
  const bound = new Map<string, HostMark[]>();
  const unbound: HostMark[] = [];
  const ambiguous = new Map<HostMark, string>();
  const norm = (t: string) => t.trim().toUpperCase().replace(/^#/, '');
  const seen = new Map<string, number>();
  for (const m of marks) if (m.tag) seen.set(norm(m.tag), (seen.get(norm(m.tag)) ?? 0) + 1);
  for (const m of marks) {
    const tag = m.tag ? norm(m.tag) : '';
    const hit = tag ? types.filter(t => t.hostTag && norm(t.hostTag) === tag) : [];
    // Fix round 3 — a mark on a sheet that could not be lined up with its
    // level's main sheet is never bound (it may be a repeat of a main-sheet
    // pole): asked, its read tag only a suggestion. Uniqueness is still
    // counted over EVERY sheet, so a tag read on both copies stays undecided.
    if (hit.length === 1 && seen.get(tag) === 1 && bindable(m)) { bound.set(hit[0].typeId, [...(bound.get(hit[0].typeId) ?? []), m]); continue; }
    if (hit.length === 1) ambiguous.set(m, hit[0].typeId);
    unbound.push(m);
  }
  return { bound, unbound, ambiguous };
}

/** Pure (accuracy round B4): a ZERO-count equipment-schedule row whose
 *  significant words (the host noun dropped) match exactly ONE legend type
 *  of a shared host ("PP-OFFICE/CCTV — power poles for manager's office" ->
 *  #1 Office area power pole) is that type's schedule row: folded into it
 *  with the reason, never a zero-count item of its own. */
export function hostTypeAliases(
  rows: Array<{ key: string; type: string; description: string; status: string; source?: string }>,
  groups: Array<{ hostKey: string; hostNoun: string; types: Array<{ typeId: string; host: string; hostTag: string }> }>,
): Array<{ key: string; hostKey: string; typeId: string; into: string; reason: string }> {
  const out: Array<{ key: string; hostKey: string; typeId: string; into: string; reason: string }> = [];
  for (const r of rows) {
    if (r.status !== 'zero' || r.source !== 'equipment_schedule') continue;
    for (const g of groups) {
      if (r.key === g.hostKey || g.types.length < 2) continue;
      // It must be a row for this kind of host ("power pole(s)").
      const noun = g.hostNoun.toUpperCase().split(/\s+/).filter(Boolean);
      const text = `${r.type} ${r.description}`.toUpperCase();
      if (!noun.length || !noun.every(w => new RegExp(`\\b${w}S?\\b`).test(text))) continue;
      const tw = g.types.map(t => ({ t, w: typeWords(t.host) }));
      const common = tw[0].w.filter(w => tw.every(x => x.w.some(v => sameWord(w, v))));
      const mine = typeWords(text.replace(/[-/]/g, ' ')).filter(w => !common.some(c => sameWord(w, c)));
      const hits = tw.filter(x => x.w.some(v => !common.some(c => sameWord(v, c)) && mine.some(w => sameWord(w, v))));
      if (hits.length !== 1) continue;
      const into = `${hits[0].t.hostTag ? `#${hits[0].t.hostTag} ` : ''}${hits[0].t.host}`;
      out.push({ key: r.key, hostKey: g.hostKey, typeId: hits[0].t.typeId, into,
        reason: `the schedule's row for ${into} (a ${g.hostKey} legend type, "${[...new Set(mine.filter(w => hits[0].w.some(v => sameWord(w, v))))].join(' ').toLowerCase()}") — counted with ${g.hostKey}, not a separate item` });
      break;
    }
  }
  return out;
}

export interface UnmappedTypicalDevice { packageId: string; host: string; text: string; qty: number; quote: string }

const ASM_STOP = new Set(['THE', 'AND', 'WITH', 'FOR', 'EACH', 'BOX', 'AT', 'OF', 'TO', 'ON', 'IN', 'BY']);
function asmWords(s: string): Set<string> {
  return new Set(s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !ASM_STOP.has(w)));
}

/** S1 — the package describes the host's OWN assembly: the host is a
 *  counted DEVICE symbol (the display baseflex: J-box, flex and the
 *  receptacle in the kick plate, priced as one line) and the quote is its
 *  own legend / schedule row (2+ of its description's words, or its host
 *  text shares 2+ words with it).
 *  Real-run fix 3 — an EQUIPMENT host (a power pole, a counter, a kiosk:
 *  its line is the equipment's own connection) never swallows the devices
 *  mounted on it: the live Kissimmee run bound every pole package to its
 *  PP#n equipment type and expanded nothing ("assembly", expanded 0). */
export function isAssemblyPackage(p: TypicalPackage, targets: CountTarget[]): boolean {
  if (!p.hostTargetKey) return false;
  const t = targets.find(x => x.key === p.hostTargetKey);
  if (!t) return false;
  if (t.category === 'equipment') return false;
  const tw = asmWords(t.description);
  const qw = asmWords(`${p.quote} ${p.host}`);
  return [...tw].filter(w => qw.has(w)).length >= 2;
}

/** "A40,42" / "A42" -> share A42. Normalized tags (no hyphens). */
export function circuitsOverlap(a: string, b: string): boolean {
  const set = (t: string) => {
    const m = /^([A-Z]*)(.*)$/.exec(t)!;
    return new Set(m[2].split(/[,/&]/).filter(Boolean).map(n => `${m[1]}${n}`));
  };
  const sa = set(a);
  return [...set(b)].some(x => sa.has(x));
}

// ── Typical fix (2026-09-28): the multiplier is bound per host TYPE ────────
// The live Kissimmee run of 2026-09-28 read all six power poles as ONE
// equipment row ("PP-1..6", 6 counted tags) and bound every #9 POWER POLE
// LEGEND package to it: office 2 duplex, checkout 1, parts pod 1, tester
// 1 + 1 simplex, counter 2 — EACH multiplied by all six poles (+42 duplex,
// +5 simplex). A legend typical for host type X may only use the count of
// hosts identified as type X; when that is not known nothing is expanded
// and ONE blocking item asks which host is which type.

const TYPE_STOP = new Set(['THE', 'AND', 'WITH', 'FOR', 'EACH', 'AT', 'OF', 'TO', 'ON', 'IN', 'BY', 'AREA', 'POWER', 'POLE', 'POLES', 'TYPE', 'TYPICAL',
  // Fix round B1 — filler: a "(typ.)" note or an "interior" qualifier names no other type.
  'TYP', 'TYPICALLY', 'INTERIOR', 'EXTERIOR', 'ALL', 'SIMILAR', 'SIM', 'EQUAL', 'EXISTING', 'NEW', 'LOCATION', 'LOCATIONS', 'SEE', 'PER', 'NOTE', 'NOTES']);
/** Fix round 2 / N2 — abbreviations read as their word before comparing. */
const TYPE_ABBR: Record<string, string> = { VAC: 'VACUUM', RCPT: 'RECEPTACLE', RECEPT: 'RECEPTACLE', STOR: 'STORAGE', EQUIP: 'EQUIPMENT', ELEC: 'ELECTRICAL' };
function typeWords(s: string): string[] {
  return s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .map(w => TYPE_ABBR[w] ?? w)
    .filter(w => w.length >= 3 && !TYPE_STOP.has(w) && !/^\d+$/.test(w))
    .map(w => (w.length > 3 && w.endsWith('S') && !w.endsWith('SS') ? w.slice(0, -1) : w));
}
/** "TESTER" ~ "TEST", "POD" = "POD": equal, or one a prefix (4+ letters) of the other. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

/** A host's TYPE within its legend: its tag when it has one, else its words. */
export function hostTypeId(p: Pick<TypicalPackage, 'hostTag' | 'host'>): string {
  return p.hostTag ? `tag:${p.hostTag.toUpperCase()}` : `host:${typeWords(p.host).join(' ')}`;
}

/** Fix round B1 / fix round 2 (N1, N4) — the TYPE of each package on one
 *  host. Words every package shares (the host noun), filler (typ.,
 *  interior…) and abbreviations are normalized first; then:
 *    * a package with NO words left ("Power pole (typ.)") names no type:
 *      it applies to EVERY host (`all:<host>`), never an extra type;
 *    * 2+ distinct tags: each tag is a type; an untagged package joins the
 *      ONE tagged type its words are a subset / superset of (else its own);
 *    * no tags (or one): packages merge ONLY when one's words are a subset
 *      of the other's (a qualifier, a note's wording); a partial overlap
 *      ("checkout counter" / "commercial counter") is two types. A package
 *      that is a subset of 2+ different types is its own (asked).
 *  One type = every package adds up, exactly as before. */
export const EVERY_HOST = 'all:';
export function hostTypesOf(pkgs: TypicalPackage[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!pkgs.length) return out;
  const words = new Map(pkgs.map(p => [p.id, new Set(typeWords(p.host))]));
  const common = [...words.get(pkgs[0].id)!].filter(w => pkgs.every(p => words.get(p.id)!.has(w)));
  for (const w of words.values()) for (const c of common) w.delete(c);
  const tagOf = (p: TypicalPackage) => p.hostTag.trim().toUpperCase();
  const sub = (a: Set<string>, b: Set<string>) => [...a].every(w => [...b].some(v => sameWord(w, v)));
  const related = (a: Set<string>, b: Set<string>) => sub(a, b) || sub(b, a);
  const hostKey = hostKeyOf(pkgs[0]);
  const rest = pkgs.filter(p => {
    if (words.get(p.id)!.size) return true;
    // Untagged with nothing left = every host. With fewer than 2 tags a
    // tagged one with nothing left is the host's own single type too.
    if (!tagOf(p) || new Set(pkgs.map(tagOf).filter(Boolean)).size < 2) { out.set(p.id, `${EVERY_HOST}${hostKey}`); return false; }
    return true;
  });
  const tags = [...new Set(rest.map(tagOf).filter(Boolean))];
  if (tags.length >= 2) {
    for (const p of rest) {
      if (tagOf(p)) { out.set(p.id, `tag:${tagOf(p)}`); continue; }
      const w = words.get(p.id)!;
      const hits = tags.filter(t => rest.some(q => tagOf(q) === t && related(w, words.get(q.id)!)));
      out.set(p.id, hits.length === 1 ? `tag:${hits[0]}` : `host:${[...w].join(' ')}`);
    }
    return out;
  }
  // Maximal packages (not a strict subset of another) are the types; equal
  // word sets are one type; a strict subset joins its one superset type.
  const strictSub = (a: Set<string>, b: Set<string>) => sub(a, b) && !sub(b, a);
  const maximal = rest.filter(p => !rest.some(q => q !== p && strictSub(words.get(p.id)!, words.get(q.id)!)));
  const groups: TypicalPackage[][] = [];
  for (const p of maximal) {
    const g = groups.find(x => sub(words.get(x[0].id)!, words.get(p.id)!) && sub(words.get(p.id)!, words.get(x[0].id)!));
    if (g) g.push(p); else groups.push([p]);
  }
  const idOf = (g: TypicalPackage[]) => {
    const tagged = g.find(tagOf);
    return tagged ? `tag:${tagOf(tagged)}` : `host:${[...words.get(g[0].id)!].join(' ')}`;
  };
  for (const g of groups) for (const p of g) out.set(p.id, idOf(g));
  for (const p of rest.filter(x => !maximal.includes(x))) {
    const hits = groups.filter(g => strictSub(words.get(p.id)!, words.get(g[0].id)!));
    out.set(p.id, hits.length === 1 ? idOf(hits[0]) : `host:${[...words.get(p.id)!].join(' ')}`);
  }
  return out;
}

/** Type ids of every multiplying package, grouped per host (hostTypesOf). */
function typeIdsFor(packages: TypicalPackage[], targets: CountTarget[]): Map<string, string> {
  const byHost = new Map<string, TypicalPackage[]>();
  for (const p of packages) {
    if (isAssemblyPackage(p, targets) || !statesAMultiplier(p)) continue;
    byHost.set(hostKeyOf(p), [...(byHost.get(hostKeyOf(p)) ?? []), p]);
  }
  const out = new Map<string, string>();
  for (const ps of byHost.values()) for (const [k, v] of hostTypesOf(ps)) out.set(k, v);
  return out;
}

/** One representative package per type (a tagged one first). */
function typeReps(pkgs: TypicalPackage[], ids: Map<string, string>): TypicalPackage[] {
  const reps = new Map<string, TypicalPackage>();
  for (const p of pkgs) {
    const id = ids.get(p.id)!;
    const cur = reps.get(id);
    if (!cur || (!cur.hostTag && p.hostTag)) reps.set(id, p);
  }
  return [...reps.values()];
}

function statesAMultiplier(p: TypicalPackage): boolean {
  return p.devices.some(d => d.qty != null && d.targetKey);
}

/** Pure: host targets that carry 2+ distinct legend TYPES (one host count,
 *  several packages). Assemblies and packages stating no per-host quantity
 *  never multiply anything and are left out. */
export function sharedHostTypes(packages: TypicalPackage[], targets: CountTarget[] = []): Map<string, TypicalPackage[]> {
  const byHost = new Map<string, TypicalPackage[]>();
  for (const p of packages) {
    if (isAssemblyPackage(p, targets) || !statesAMultiplier(p)) continue;
    const k = hostKeyOf(p);
    byHost.set(k, [...(byHost.get(k) ?? []), p]);
  }
  const out = new Map<string, TypicalPackage[]>();
  for (const [k, ps] of byHost) {
    // N4 — a package for every host is not a type; the rest may share.
    const ids = hostTypesOf(ps);
    const typed = ps.filter(p => !ids.get(p.id)!.startsWith(EVERY_HOST));
    if (new Set(typed.map(p => ids.get(p.id))).size > 1) out.set(k, typed);
  }
  return out;
}

/** Pure: a note / schedule line that maps hosts to types — "(office,
 *  checkout, 2 parts pods, tester, commercial counter)" -> office 1,
 *  checkout 1, parts pod 2, test station 1, commercial counter 1. Every
 *  listed item must match exactly one type (most shared words); null when
 *  any does not, or fewer than two items are listed. */
export function allocateFromText(text: string, types: Array<{ typeId: string; host: string }>): Map<string, number> | null {
  const groups = [...text.matchAll(/\(([^()]*)\)/g)].map(m => m[1]).filter(g => /[,;]/.test(g));
  const body = groups[0] ?? text;
  const segs = body.split(/\s*[,;]\s*|\s+and\s+/i).map(x => x.trim()).filter(Boolean);
  if (segs.length < 2) return null;
  const tw = types.map(t => ({ t, w: typeWords(t.host) }));
  const out = new Map<string, number>(types.map(t => [t.typeId, 0]));
  for (const seg of segs) {
    const m = /^\(?(\d{1,2})\)?\s+(.+)$/.exec(seg);
    const qty = m ? Number(m[1]) : 1;
    const sw = typeWords(m ? m[2] : seg);
    if (!sw.length || qty < 1) return null;
    const scored = tw.map(x => ({ id: x.t.typeId, n: sw.filter(w => x.w.some(v => sameWord(w, v))).length })).sort((a, b) => b.n - a.n);
    if (!scored[0] || scored[0].n === 0 || (scored[1] && scored[1].n === scored[0].n)) return null;
    out.set(scored[0].id, out.get(scored[0].id)! + qty);
  }
  return out;
}

/** Fix round S3 — one schedule row's type cell -> the one type it names. */
export function matchHostType(text: string, types: Array<{ typeId: string; host: string }>): string | null {
  const sw = typeWords(text);
  if (!sw.length) return null;
  const scored = types.map(t => ({ id: t.typeId, n: sw.filter(w => typeWords(t.host).some(v => sameWord(w, v))).length })).sort((a, b) => b.n - a.n);
  if (!scored[0] || scored[0].n === 0 || (scored[1] && scored[1].n === scored[0].n)) return null;
  return scored[0].id;
}

/** Fix round S3 — a REAL host schedule (a table titled SCHEDULE with a tag /
 *  mark column and a type column), one row per host (or a qty column). */
export interface HostSchedule { label: string; rows: Array<{ tag: string; type: string; qty: number }> }

/** Pure: the tag range a host target names ("PP-1..6", "#1-#6"). */
export function hostTagRange(t: Pick<CountTarget, 'key' | 'description'> | undefined): string[] | null {
  if (!t) return null;
  for (const s of [t.key, t.description]) {
    const m = /#?(\d{1,2})\s*(?:\.\.\.?|-|–|\bTO\b|\bTHRU\b|\bTHROUGH\b)\s*#?(\d{1,2})\b/i.exec(s);
    if (m && Number(m[2]) > Number(m[1]) && Number(m[2]) - Number(m[1]) < 50) {
      return Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => String(Number(m[1]) + i));
    }
  }
  return null;
}

type HostCountIn = { count: number | null; sheets: string[]; marks: HostMark[]; reason?: string; possible?: HostMark[]; stated?: StatedHosts;
  /** Fix round 3 — sheet keys (the marks' frame keys) of same-level sheets
   *  that could not be lined up with the level's main sheet: their marks
   *  are always asked pole by pole, never tag-bound, never fully bound. */
  unalignedSheets?: string[];
  /** Fix round 4 — marks of the host on an enlarged plan held for "repeats
   *  or adds?" (its place on the main plan is unknown): asked pole by pole
   *  ("may repeat a main-plan pole"), never counted until typed. */
  held?: Array<{ sheetKey: string; sheetLabel?: string; viewportLabel: string; pdf?: { sheetKey: string; x: number; y: number } }> };

/** Pure: per-type host counts for a shared host, from (a) the tag at each
 *  host, (b) a REAL host schedule (fix round S3: a table titled SCHEDULE
 *  with a tag and a type column — never a notes / keyed-notes / legend
 *  row, which is only a suggestion) whose rows add up to the host count,
 *  (c) a one-to-one legend (one entry per host tag, as many entries as
 *  hosts). null = not identified (never guessed). */
export function identifyHostTypes(
  hostKey: string,
  pkgs: TypicalPackage[],
  hc: HostCountIn,
  targets: CountTarget[],
  schedules: HostSchedule[] = [],
  typeIds?: Map<string, string>,
): Map<string, HostTypeAssignment & { marks?: HostMark[] }> | null {
  const total = hc.count ?? 0;
  if (total <= 0) return null;
  const ids = typeIds ?? hostTypesOf(pkgs);
  const types = typeReps(pkgs, ids);
  const idOf = (p: TypicalPackage) => ids.get(p.id)!;
  // (a) every host mark carries a tag, and every type has one.
  if (hc.marks.length === total && hc.marks.every(m => m.tag) && types.every(p => p.hostTag)) {
    return new Map(types.map(p => {
      const marks = hc.marks.filter(m => m.tag!.toUpperCase() === p.hostTag.toUpperCase());
      return [idOf(p), { count: marks.length, source: 'tag' as const, evidence: `tags read at the ${total} hosts: ${hc.marks.map(m => m.tag).join(', ')}`, marks }];
    }));
  }
  // (b) a real host schedule.
  const tl = types.map(p => ({ typeId: idOf(p), host: p.host }));
  for (const sc of schedules) {
    const counts = new Map(tl.map(t => [t.typeId, 0]));
    for (const r of sc.rows) {
      const id = matchHostType(r.type, tl);
      if (id) counts.set(id, counts.get(id)! + r.qty);
    }
    if ([...counts.values()].reduce((n, x) => n + x, 0) !== total) continue;
    return new Map([...counts].map(([id, n]) => [id, { count: n, source: 'schedule' as const, evidence: `${sc.label}: ${sc.rows.filter(r => matchHostType(r.type, tl)).map(r => `${r.tag} ${r.type}${r.qty > 1 ? ` ×${r.qty}` : ''}`).join('; ').slice(0, 200)}` }]));
  }
  // (c) one legend entry per host tag, as many entries as hosts.
  const host = targets.find(t => t.key === hostKey);
  const range = hostTagRange(host);
  const tags = types.map(p => p.hostTag.toUpperCase());
  if (range && range.length === total && types.length === total && tags.every(Boolean) && new Set(tags).size === total && range.every(r => tags.includes(r))) {
    return new Map(types.map(p => [idOf(p), { count: 1, source: 'one_to_one' as const, evidence: `${host!.type}: tags ${range[0]}–${range[range.length - 1]}, one legend entry per tag` }]));
  }
  return null;
}

function hostNounOf(pkgs: TypicalPackage[]): string {
  const ws = pkgs.map(p => p.host.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean));
  const tail: string[] = [];
  for (let i = 1; ; i++) {
    const w = ws[0][ws[0].length - i];
    if (!w || !ws.every(x => x[x.length - i] === w)) break;
    tail.unshift(w);
  }
  return tail.join(' ') || 'host';
}

/** Pure: the suggestion shown on the assignment item (NEVER counted): a
 *  notes / legend table row or the host target's own note that maps hosts
 *  to types (both read by the model), else one host of each type with the
 *  rest to ask; none when there are fewer hosts than types. */
export function suggestAllocation(
  types: Array<{ typeId: string; host: string }>,
  hostCount: number,
  notes: Array<{ text: string; label: string; source: 'table_note' | 'ai_note' }>,
): { perType: Map<string, number>; source: 'table_note' | 'ai_note' | 'one_each'; note: string; label: string; unassigned: number } | null {
  for (const n of notes) {
    const a = allocateFromText(n.text, types);
    if (a && [...a.values()].reduce((x, y) => x + y, 0) === hostCount) return { perType: a, source: n.source, note: n.text, label: n.label, unassigned: 0 };
  }
  if (hostCount < types.length) return null;
  return { perType: new Map(types.map(t => [t.typeId, 1])), source: 'one_each', note: '', label: '', unassigned: hostCount - types.length };
}

/** Pure guard: one host count never feeds several typical types. Expanded
 *  entries of 2+ distinct host types on the same host, any of them not
 *  bound to a per-type count, are all turned into 'host_unassigned'. */
export function guardSharedHostCounts(expansions: TypicalExpansion[]): TypicalExpansion[] {
  const byHost = new Map<string, TypicalExpansion[]>();
  for (const e of expansions) if (e.status === 'expanded') byHost.set(e.hostKey, [...(byHost.get(e.hostKey) ?? []), e]);
  const bad = new Set<string>();
  for (const [k, es] of byHost) {
    const types = new Set(es.filter(e => e.binding !== 'every_host').map(e => e.hostType ?? `host:${typeWords(e.host).join(' ')}`));
    if (types.size > 1 && es.some(e => !e.binding)) bad.add(k);
  }
  if (!bad.size) return expansions;
  return expansions.map(e => (e.status === 'expanded' && bad.has(e.hostKey)
    ? { ...e, status: 'host_unassigned' as const, expanded: 0, drawnAtHosts: 0, possibleAtHosts: undefined, reason: `one ${e.host.toLowerCase().split(' ').slice(-2).join(' ')} count (${e.hostCount}) would feed several host types — which host is which type is not known` }
    : e));
}

/** Pure (2.2): expand every package's stated devices by its host count. */
export function expandTypicals(
  packages: TypicalPackage[],
  hostCounts: Map<string, HostCountIn>,
  deviceMarks: Array<{ sheetKey: string; typeKey: string; x: number; y: number; fromSheet?: string; circuit?: string }>,
  targets: CountTarget[] = [],
  opts: {
    /** Fix round S3 — real host schedules (may bind); notes / legend table rows (suggestions only). */
    schedules?: HostSchedule[];
    noteTexts?: Array<{ text: string; label: string }>;
  } = {},
): { expansions: TypicalExpansion[]; unmapped: UnmappedTypicalDevice[]; hostGroups: HostAssignmentGroup[] } {
  const expansions: TypicalExpansion[] = [];
  const unmapped: UnmappedTypicalDevice[] = [];
  // Fix round 3 / S19 — a device on another sheet at a host's place is the
  // host's own outlet only if their circuits agree (or neither shows one):
  // E-1's "duplex outlet at deck" is A-31 (CCTV MONITOR), checkout pole #2
  // is A-29 — different outlets, no question.
  // Fix round 4 / S21 — skipped ONLY when both show a circuit tag and the
  // tags share no circuit ("A40,42" and "A42" share one); one side or
  // neither tagged -> still asked (a drawn outlet usually carries its
  // homerun tag while the pole's hexagon doesn't).
  const circuitOk = (m: { circuit?: string }, h: HostMark) => !(m.circuit && h.circuit && !circuitsOverlap(m.circuit, h.circuit));
  const near = (hc: { marks: HostMark[] }, key: string, r: number, perHost: number, own: boolean | null = true) => {
    let n = 0;
    for (const h of hc.marks) {
      const k = deviceMarks.filter(m => m.typeKey === key && m.sheetKey === h.sheetKey
        && (own === null || ((m.fromSheet ?? m.sheetKey) === h.sheetKey) === own)
        && (own !== false || circuitOk(m, h))
        && Math.hypot(m.x - h.x, m.y - h.y) <= r).length;
      n += Math.min(k, perHost);
    }
    return n;
  };
  // Real-run fix 6 — a device that is already part of a host's own
  // assembly (the legend's baseflex: "receptacle mounted to base plate") is
  // the same device when a notes block describes it again at that host
  // ("outlet on flex … installed in fixture base"): part of the assembly,
  // never a second question about how many.
  const inAssembly = new Set(packages.filter(p => isAssemblyPackage(p, targets)).flatMap(p => p.devices.map(d => `${hostKeyOf(p)}|${d.targetKey}`)));
  // Typical fix — several legend types on ONE counted host: each type uses
  // only the hosts identified as that type; unidentified = one grouped
  // question, nothing expanded.
  const shared = sharedHostTypes(packages, targets);
  const typeIds = typeIdsFor(packages, targets);
  const tid = (p: TypicalPackage) => typeIds.get(p.id) ?? hostTypeId(p);
  const bindings = new Map<string, Map<string, HostTypeAssignment & { marks?: HostMark[] }>>();
  const hostGroups: HostAssignmentGroup[] = [];
  for (const [hk, pkgs] of shared) {
    const hc = hostCounts.get(hk);
    // Accuracy round B2 — a stated total with none found is still asked
    // (the stated poles are the question's members), never "no multiplier".
    // Fix round 3 — sheets that could not be lined up: always pole by pole
    // (the carried count is not a physical count a schedule / one-to-one /
    // all-tagged binding may be checked against).
    const unalignedKeys = new Set(hc?.unalignedSheets ?? []);
    const perPole = !!hc?.stated || unalignedKeys.size > 0;
    if (!hc || ((hc.count == null || hc.count <= 0) && !(perPole && ((hc.stated?.total ?? 0) > 0 || hc.marks.length > 0 || (hc.held?.length ?? 0) > 0)))) continue; // no host count: asked per package (no_multiplier)
    const b = hc.count && hc.count > 0 && !unalignedKeys.size ? identifyHostTypes(hk, pkgs, hc, targets, opts.schedules, typeIds) : null;
    if (b) { bindings.set(hk, b); continue; }
    const types = typeReps(pkgs, typeIds);
    // Accuracy round B3 — the hosts whose read tag names their type are
    // bound (expanded); only the others are asked, one member per host.
    let hosts: HostAssignmentGroup['hosts'];
    let unlocated: HostAssignmentGroup['unlocated'];
    let held: HostAssignmentGroup['held'];
    let boundOut: HostAssignmentGroup['bound'];
    if (perPole) {
      const pb = partialTagBinding(hc.marks, types.map(p => ({ typeId: tid(p), hostTag: p.hostTag })), m => !unalignedKeys.has(m.sheetKey));
      if (pb.bound.size) {
        bindings.set(hk, new Map([...pb.bound].map(([id, ms]) => [id, { count: ms.length, source: 'tag' as const, evidence: `the tag read at ${ms.length === 1 ? 'the host' : `each of ${ms.length} hosts`}: ${ms.map(m => m.tag).join(', ')}`, marks: ms }])));
        boundOut = [...pb.bound].map(([typeId, ms]) => ({ typeId, count: ms.length, tags: ms.map(m => m.tag!) }));
      }
      const perSheet = new Map<string, number>();
      hosts = pb.unbound.map(m => {
        const lab = m.sheetLabel || m.sheetKey;
        const i = (perSheet.get(lab) ?? 0) + 1;
        perSheet.set(lab, i);
        return { id: `pole:${lab}:${i}`, sheetKey: m.sheetKey, ...(m.sheetLabel ? { sheetLabel: m.sheetLabel } : {}), x: m.x, y: m.y,
          ...(m.pdf ? { pdf: m.pdf } : {}), ...(m.tag ? { tag: m.tag } : {}), ...(m.circuit ? { circuit: m.circuit } : {}),
          ...(pb.ambiguous.has(m) ? { suggestedType: pb.ambiguous.get(m)! } : {}) };
      });
      // Fix round 3 — the stated poles not found are counted against the
      // main sheets' poles (the "same poles" reading of an unaligned sheet),
      // so a repeat on an unaligned sheet never hides a missing pole.
      const found = hc.marks.filter(m => !unalignedKeys.has(m.sheetKey)).length;
      // Fix round 4 — enlarged-plan marks held for "repeats or adds?": one
      // member each (they may be the missing stated poles, so they are not
      // asked twice as "not found").
      const heldCount = new Map<string, number>();
      held = (hc.held ?? []).map(h => {
        const lab = h.sheetLabel || h.sheetKey;
        const i = (heldCount.get(lab) ?? 0) + 1;
        heldCount.set(lab, i);
        return { id: `pole:held:${lab}:${i}`, sheetKey: h.sheetKey, ...(h.sheetLabel ? { sheetLabel: h.sheetLabel } : {}), viewportLabel: h.viewportLabel, ...(h.pdf ? { pdf: h.pdf } : {}) };
      });
      const missing = Math.max(0, (hc.stated?.total ?? 0) - found - held.length);
      if (missing && hc.stated) {
        const read = new Set(hc.marks.filter(m => !unalignedKeys.has(m.sheetKey)).map(m => (m.tag ?? '').toUpperCase()).filter(Boolean));
        const cand = hc.stated.tags.filter(t => !read.has(t.toUpperCase()));
        unlocated = cand.length === missing
          ? cand.map(t => ({ id: `pole:unlocated:${t}`, tag: t }))
          : Array.from({ length: missing }, (_, i) => ({ id: `pole:unlocated:n${i + 1}` }));
      }
      if (!hosts.length && !unlocated?.length && !held.length) continue; // every host bound by its tag
    }
    const hostTotal = perPole ? (hc.count ?? 0) : hc.count!;
    const hostT = targets.find(t => t.key === hk);
    const sug = suggestAllocation(types.map(p => ({ typeId: tid(p), host: p.host })), perPole ? (hosts?.length ?? 0) + (unlocated?.length ?? 0) + (held?.length ?? 0) : hostTotal, [
      ...(opts.noteTexts ?? []).map(n => ({ ...n, source: 'table_note' as const })),
      ...(hostT ? [{ text: hostT.description, label: hostT.type, source: 'ai_note' as const }] : []),
    ]);
    const statedKeys = [...new Set(types.flatMap(p => p.devices.filter(d => d.qty != null && d.targetKey).map(d => d.targetKey!)))];
    hostGroups.push({
      hostKey: hk, hostNoun: hostNounOf(types), hostCount: hostTotal,
      viewportLabel: types[0].viewportLabel, sheetKey: types[0].sheetKey,
      types: types.map(p => ({
        typeId: tid(p), packageId: p.id, host: p.host, hostTag: p.hostTag, quote: p.quote,
        devices: pkgs.filter(q => tid(q) === tid(p)).flatMap(q => q.devices).filter(d => d.qty != null && d.targetKey).map(d => ({ key: d.targetKey!, text: d.text, perHost: d.qty! })),
        unstated: pkgs.filter(q => tid(q) === tid(p)).flatMap(q => q.devices).filter(d => d.qty == null && d.targetKey).map(d => ({ key: d.targetKey!, text: d.text })),
        suggested: sug ? (sug.perType.get(tid(p)) ?? 0) : null,
      })),
      suggestion: sug ? { source: sug.source, note: sug.note, label: sug.label, unassigned: sug.unassigned } : null,
      drawnNearHosts: statedKeys.map(k => ({ key: k, count: near(hc, k, HOST_RADIUS_IN, Math.max(...types.flatMap(p => p.devices.filter(d => d.targetKey === k).map(d => d.qty ?? 0)))) })).filter(x => x.count > 0),
      ...(perPole ? { hosts: hosts ?? [], ...(unlocated?.length ? { unlocated } : {}), ...(held?.length ? { held } : {}), found: hc.marks.length, ...(hc.stated ? { stated: hc.stated } : {}), ...(boundOut ? { bound: boundOut } : {}) } : {}),
    });
  }
  const unassigned = new Map(hostGroups.map(g => [g.hostKey, g]));
  for (const p of packages) {
    const hostKey = hostKeyOf(p);
    const hc = hostCounts.get(hostKey);
    // Review fix N5 — "additional / extra / another outlet" is a new device,
    // never the assembly's own again; a restatement is still shown (restated).
    const additional = /\b(additional|extra|another|second|more|added)\b/i.test(`${p.quote} ${p.devices.map(d => d.text).join(' ')}`);
    const restated = !isAssemblyPackage(p, targets) && !additional && p.devices.length > 0 && p.devices.every(d => d.targetKey && d.qty == null && inAssembly.has(`${hostKey}|${d.targetKey}`));
    const assembly = isAssemblyPackage(p, targets) || restated;
    for (const d of p.devices) {
      if (!d.targetKey && d.qty != null && !assembly) { unmapped.push({ packageId: p.id, host: p.host, text: d.text, qty: d.qty, quote: p.quote }); continue; }
      if (!d.targetKey && (d.qty == null || assembly)) continue;
      const base = {
        packageId: p.id, host: p.host, hostKey, deviceKey: d.targetKey!, deviceText: d.text, perHost: d.qty ?? 0,
        quote: p.quote, sheetKey: p.sheetKey, viewportId: p.viewportId, viewportLabel: p.viewportLabel,
        hostSheets: hc?.sheets ?? [], hostType: tid(p),
      };
      if (assembly) {
        expansions.push({ ...base, hostCount: hc?.count ?? null, drawnAtHosts: 0, expanded: 0, status: 'assembly', ...(restated ? { restated: true } : {}),
          reason: `part of the ${p.host.toLowerCase()} assembly (${d.qty ?? 'n'} per ${p.host.toLowerCase()}) — priced with it, not as a separate ${d.text.toLowerCase()}` });
        continue;
      }
      if (d.qty == null) {
        // Real-run fix 3 — a host whose own tag is not bound (no circuit on
        // it) is looked for at its family's unbound tags: devices drawn
        // there are counted where drawn (information), never subtracted.
        const unbound = !!(hc && !hc.marks.length && hc.possible?.length);
        const drawn = !hc || !hc.count ? 0
          : unbound ? new Set(hc.possible!.flatMap(h => deviceMarks.filter(m => m.typeKey === d.targetKey && m.sheetKey === h.sheetKey
            && Math.hypot(m.x - h.x, m.y - h.y) <= HOST_AREA_IN))).size
          : near(hc, d.targetKey!, HOST_AREA_IN, Number.MAX_SAFE_INTEGER, null);
        expansions.push({ ...base, hostCount: hc?.count ?? null, drawnAtHosts: drawn, expanded: 0, status: 'qty_unstated',
          reason: drawn ? `${drawn} drawn near the ${p.host.toLowerCase()}${(hc?.count ?? 0) === 1 ? '' : 's'} — counted where drawn` : `how many per ${p.host.toLowerCase()} is not stated and none is drawn near one` });
        continue;
      }
      // Accuracy round B2/B3 — stated hosts none of which was found: the
      // group's per-pole question asks them (never "no multiplier" too).
      const asked = tid(p).startsWith(EVERY_HOST) ? undefined : unassigned.get(hostKey);
      if (asked && !bindings.has(hostKey) && (!hc || hc.count == null || hc.count <= 0)) {
        expansions.push({ ...base, hostCount: 0, drawnAtHosts: 0, expanded: 0, status: 'host_unassigned',
          reason: `${asked.stated ? `${asked.stated.label} states ${asked.stated.total} ${asked.hostNoun}s; none found on the plans` : `no ${asked.hostNoun} found`} — each is asked (its type, or not on the job); nothing added until answered` });
        continue;
      }
      if (!hc || hc.count == null || hc.count <= 0) {
        expansions.push({ ...base, hostCount: null, drawnAtHosts: 0, expanded: 0, status: 'no_multiplier',
          reason: hc?.reason ?? `no ${p.host.toLowerCase()} was found on the plans${p.hostTag ? ` (tag ${p.hostTag})` : ''}` });
        continue;
      }
      // Fix round 2 / N4 — a package naming no type ("Power pole (typ.)")
      // applies to EVERY host of a shared host: × all of them, as evidence.
      const everyHost = tid(p).startsWith(EVERY_HOST);
      const group = everyHost ? undefined : unassigned.get(hostKey);
      // Accuracy round B3 — a group with tag-bound hosts expands those
      // (below); only its unbound hosts wait for the estimator.
      if (group && !bindings.has(hostKey)) {
        expansions.push({ ...base, hostCount: hc.count, drawnAtHosts: 0, expanded: 0, status: 'host_unassigned',
          reason: `${group.hostCount} ${group.hostNoun}s, ${group.types.length} ${group.hostNoun} types in ${group.viewportLabel || 'the legend'} — which ${group.hostNoun} is which type is not shown; nothing added until they are assigned` });
        continue;
      }
      const bound = bindings.get(hostKey)?.get(tid(p));
      if (bindings.has(hostKey) && !everyHost) {
        // Only the hosts identified as THIS type. Tag-bound hosts have their
        // own marks (drawn devices subtracted as usual); a schedule / one-to-
        // one binding does not say which host is which, so a device drawn at
        // a host is asked about (possibleAtHosts), never subtracted.
        const n = bound?.count ?? 0;
        const own = bound?.marks ? { marks: bound.marks } : null;
        const drawn = own ? near(own, d.targetKey!, HOST_RADIUS_IN, d.qty, true) : 0;
        const expanded = Math.max(0, n * d.qty - drawn);
        const possible = Math.min(expanded, own ? near(own, d.targetKey!, HOST_RADIUS_IN, d.qty, false) : near(hc, d.targetKey!, HOST_RADIUS_IN, d.qty, null));
        const src = bound?.source ?? bindings.get(hostKey)!.values().next().value!.source;
        expansions.push({ ...base, hostCount: n, drawnAtHosts: drawn, expanded, status: 'expanded', binding: src,
          ...(possible ? { possibleAtHosts: possible } : {}),
          reason: `${n} × ${d.qty}${drawn ? ` − ${drawn} drawn at the hosts` : ''} — ${n} of the ${hc.count} identified as this type (${src === 'tag' ? 'by the tag at each host' : src === 'schedule' ? 'per a schedule / note' : 'one legend entry per host tag'}: ${(bound ?? bindings.get(hostKey)!.values().next().value!).evidence})${possible ? ` (${possible} drawn at a host — the estimator decides)` : ''}` });
        continue;
      }
      const drawn = near(hc, d.targetKey!, HOST_RADIUS_IN, d.qty, true);
      const expanded = Math.max(0, hc.count * d.qty - drawn);
      const possible = Math.min(expanded, near(hc, d.targetKey!, HOST_RADIUS_IN, d.qty, false));
      expansions.push({ ...base, hostCount: hc.count, drawnAtHosts: drawn, expanded, status: 'expanded',
        ...(possible ? { possibleAtHosts: possible } : {}),
        ...(everyHost ? { binding: 'every_host' as const } : {}),
        reason: `${hc.count} × ${d.qty}${drawn ? ` − ${drawn} drawn at the hosts` : ''}${possible ? ` (${possible} more drawn at a host on another sheet — the estimator decides)` : ''}${everyHost && shared.has(hostKey) ? ` — "${p.host}" names no type, so it applies to every one of the ${hc.count}` : ''}` });
    }
  }
  return { expansions: guardSharedHostCounts(expansions), unmapped, hostGroups };
}
