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
export interface HostMark { sheetKey: string; x: number; y: number; circuit?: string }

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
  status: 'expanded' | 'no_multiplier' | 'assembly' | 'qty_unstated';
  reason: string;
  quote: string;
  sheetKey: string;
  viewportId: string | null;
  viewportLabel: string;
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

/** Pure (2.2): expand every package's stated devices by its host count. */
export function expandTypicals(
  packages: TypicalPackage[],
  hostCounts: Map<string, { count: number | null; sheets: string[]; marks: HostMark[]; reason?: string; possible?: HostMark[] }>,
  deviceMarks: Array<{ sheetKey: string; typeKey: string; x: number; y: number; fromSheet?: string; circuit?: string }>,
  targets: CountTarget[] = [],
): { expansions: TypicalExpansion[]; unmapped: UnmappedTypicalDevice[] } {
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
  for (const p of packages) {
    const hostKey = hostKeyOf(p);
    const hc = hostCounts.get(hostKey);
    const assembly = isAssemblyPackage(p, targets);
    for (const d of p.devices) {
      if (!d.targetKey && d.qty != null && !assembly) { unmapped.push({ packageId: p.id, host: p.host, text: d.text, qty: d.qty, quote: p.quote }); continue; }
      if (!d.targetKey && (d.qty == null || assembly)) continue;
      const base = {
        packageId: p.id, host: p.host, hostKey, deviceKey: d.targetKey!, deviceText: d.text, perHost: d.qty ?? 0,
        quote: p.quote, sheetKey: p.sheetKey, viewportId: p.viewportId, viewportLabel: p.viewportLabel,
        hostSheets: hc?.sheets ?? [],
      };
      if (assembly) {
        expansions.push({ ...base, hostCount: hc?.count ?? null, drawnAtHosts: 0, expanded: 0, status: 'assembly',
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
      if (!hc || hc.count == null || hc.count <= 0) {
        expansions.push({ ...base, hostCount: null, drawnAtHosts: 0, expanded: 0, status: 'no_multiplier',
          reason: hc?.reason ?? `no ${p.host.toLowerCase()} was found on the plans${p.hostTag ? ` (tag ${p.hostTag})` : ''}` });
        continue;
      }
      const drawn = near(hc, d.targetKey!, HOST_RADIUS_IN, d.qty, true);
      const expanded = Math.max(0, hc.count * d.qty - drawn);
      const possible = Math.min(expanded, near(hc, d.targetKey!, HOST_RADIUS_IN, d.qty, false));
      expansions.push({ ...base, hostCount: hc.count, drawnAtHosts: drawn, expanded, status: 'expanded',
        ...(possible ? { possibleAtHosts: possible } : {}),
        reason: `${hc.count} × ${d.qty}${drawn ? ` − ${drawn} drawn at the hosts` : ''}${possible ? ` (${possible} more drawn at a host on another sheet — the estimator decides)` : ''}` });
    }
  }
  return { expansions, unmapped };
}
