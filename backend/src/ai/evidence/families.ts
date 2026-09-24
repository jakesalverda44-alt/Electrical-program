// Evidence round 3.3 — catalog-number equivalence across sheets. Pure.
//
// Kissimmee: the photometric plan's S1/S2 ("Lithonia DSX1 LED P8 40K T4M
// MVOLT HS"), E-7's untagged "SITE LIGHT" (the same catalog number) and
// E-3's "SITE LIGHT" (DSX1, another package) are ONE fixture family drawn
// on three sheets; the takeoff stacked them to 6 poles / 7 heads (3 / 4).
// Likewise W1/W2 on PH0.1 are D/L on E-3 (DSXW1 10C 1000 / 530).
//
// A family = fixture types of one category whose catalog numbers share the
// series (DSX1, DSXW1, EVO…), defined in DIFFERENT source schedules. Types
// of one schedule are never merged with each other (S1 and S2 are two pole
// types that happen to share a catalog). Within a family:
//   * the PRIMARY is the tagged type (a real schedule tag, not an untagged
//     description) counted on the electrical plans; else tagged on the
//     photometric sheet; else the one with the larger count;
//   * a member with the SAME full catalog is the same fixture: folded into
//     its primary (never stacked); if the member counted more than its
//     primary group -> one blocking review item with both counts;
//   * a member sharing only the series is folded only when it counted 0 (a
//     schedule row for a fixture that is drawn under the other tag);
//   * a zero-count primary takes a photometric-only member's count (the A3
//     fallback, reported as photometric-only).
// Poles vs heads are preserved: heads always come from the primary types'
// heads-per-pole. Merged types keep their row as evidence (status 'merged',
// count 0) so nothing disappears silently.
import type { TypeCountResult } from '../countMerge';
import type { CountTarget } from '../countTargets';

const SERIES_RE = /\b(DSXW?\d|DSX\d|RSX\d|WSX\d|TWX\d|WPX\d|OLWX\d|EVO|LDN\d|CPX|ZL\d|LBL\d|XSP\w?\d|KAD|GLEON|VP\d|ARC\d)\b/i;

/** "Lithonia DSX1 LED P8 40K T4M MVOLT HS" -> { series: 'DSX1', full: 'DSX1 LED P8 40K T4M' }. */
export function catalogOf(description: string): { series: string; full: string } | null {
  const d = description.toUpperCase().replace(/[,;]/g, ' ');
  const m = SERIES_RE.exec(d);
  if (!m) return null;
  const tail = d.slice(m.index).split(/\s+/).filter(Boolean);
  // Series + the ordering tokens that change the fixture (LED, lumen /
  // package P8 / 60C / 10C, wattage 1000 / 530, CCT 40K, distribution T4M).
  const toks = [tail[0]];
  for (const t of tail.slice(1, 8)) {
    if (toks.includes(t)) break; // a repeated token is the next field ("… HS LED 207W")
    if (/^(LED|P\d+|\d+C|\d{3,4}|\d{2}K|T\d[A-Z]*|TFTM|FT|AS[YM]|R[0-9]?)$/.test(t)) toks.push(t);
    else if (/^(MVOLT|HVOLT|120|277|347|480|HS|DDBXD|DBLXD|DNAXD)$/.test(t)) continue;
    else break;
  }
  return { series: m[1].toUpperCase(), full: toks.join(' ') };
}

export function isTaggedType(t: Pick<CountTarget, 'type' | 'key' | 'description'>): boolean {
  const k = t.key;
  if (/^\(UNTAGGED\)/.test(k)) return false;
  if (k.length > 8) return false;
  return !/\s/.test(k) || /^[A-Z]{1,3}\d{0,2}$/.test(k);
}

export interface FamilyDecision {
  family: string;
  primary: string[];
  merged: Array<{ key: string; into: string; reason: string }>;
  /** Member counted more than its primary — the estimator decides. */
  question?: { key: string; memberCount: number; primaryCount: number; into: string; intoKeys: string[] };
  flags: string[];
}

type Ty = TypeCountResult;

function photometricOnly(t: Ty): boolean { return !!t.photometricOnly; }

function sourceOf(t: Ty, targets: Map<string, CountTarget>): string {
  return targets.get(t.key)?.sourceSheet ?? '';
}

/** Pure: fold family members. Mutates copies of the type results it
 *  returns; the input array is not modified. */
export function applyFamilies(types: Ty[], targetsIn: CountTarget[]): { types: Ty[]; decisions: FamilyDecision[] } {
  const targets = new Map(targetsIn.map(t => [t.key, t]));
  const out = types.map(t => ({ ...t, flags: [...t.flags] }));
  const fixtures = out.filter(t => (t.category === 'site_lighting' || t.category === 'exterior_building' || t.category === 'interior_lighting'));
  const bySeries = new Map<string, Ty[]>();
  for (const t of fixtures) {
    const c = catalogOf(t.description);
    if (!c) continue;
    const k = `${t.category}|${c.series}`;
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k)!.push(t);
  }
  const decisions: FamilyDecision[] = [];
  for (const [fk, members] of bySeries) {
    const sources = new Set(members.map(m => sourceOf(m, targets)));
    if (members.length < 2 || sources.size < 2) continue;
    const series = fk.split('|')[1];
    const rank = (t: Ty) => (isTaggedType(targets.get(t.key) ?? t as unknown as CountTarget) ? 4 : 0)
      + (t.status === 'counted' && t.count > 0 && !photometricOnly(t) ? 2 : 0)
      + (t.status === 'counted' && t.count > 0 ? 1 : 0);
    // The primary SOURCE schedule: the best-ranked member's schedule; every
    // member of that schedule is a primary (S1 and S2 both stay).
    const best = members.slice().sort((a, b) => rank(b) - rank(a) || b.count - a.count)[0];
    const primSrc = sourceOf(best, targets);
    const primaries = members.filter(m => sourceOf(m, targets) === primSrc);
    const others = members.filter(m => sourceOf(m, targets) !== primSrc);
    const d: FamilyDecision = { family: series, primary: primaries.map(p => p.key), merged: [], flags: [] };
    for (const m of others) {
      const mc = catalogOf(m.description)!;
      const same = primaries.filter(p => catalogOf(p.description)!.full === mc.full);
      const group = same.length ? same : primaries;
      const groupCount = group.reduce((s, p) => s + (p.status === 'counted' ? p.count : 0), 0);
      const into = group.map(p => p.type).join('/');
      const mCount = m.status === 'counted' ? m.count : 0;
      if (!same.length && mCount > 0) {
        d.flags.push(`${m.type} (${m.description}) shares the ${series} series with ${into} but not the catalog number — kept as its own type.`);
        continue;
      }
      // A zero primary takes a photometric-only member's count (fallback).
      if (same.length === 1 && groupCount === 0 && mCount > 0 && photometricOnly(m)) {
        const p = same[0];
        p.count = m.count;
        p.status = 'counted';
        p.reason = '';
        p.photometricOnly = true;
        p.sheets = [...p.sheets, ...m.sheets];
        if (p.category === 'site_lighting') p.heads = (targets.get(p.key)?.headsPerPole ?? null) != null ? p.count * targets.get(p.key)!.headsPerPole! : null;
        d.flags.push(`${p.type}: not on the electrical plans — ${m.count} from ${m.type} on the photometric sheet (same catalog ${mc.full}).`);
      } else if (mCount > groupCount && same.length) {
        d.question = { key: m.key, memberCount: mCount, primaryCount: groupCount, into, intoKeys: group.map(p => p.key) };
        d.flags.push(`${m.type} (${sourceOf(m, targets) || 'another schedule'}) is the same fixture as ${into} (${mc.full}) and counted ${mCount} against ${groupCount} — needs the estimator.`);
      }
      const reason = same.length
        ? `same fixture as ${into} (catalog ${mc.full}) — ${mCount} counted on ${m.sheets.filter(s => s.used).map(s => s.label.split(' ')[0]).join(', ') || 'no sheet'}, not stacked`
        : `same ${series} family as ${into}, counted 0 — a schedule row for the fixture drawn as ${into}`;
      d.merged.push({ key: m.key, into, reason });
      m.flags.push(`Merged into ${into}: ${reason}.`);
      (m as Ty & { mergedInto?: string; mergedCount?: number }).mergedInto = into;
      (m as Ty & { mergedCount?: number }).mergedCount = mCount;
      m.status = 'merged' as Ty['status'];
      m.count = 0;
      if (m.category === 'site_lighting') m.heads = 0;
      m.reason = reason;
    }
    if (d.merged.length || d.flags.length) decisions.push(d);
  }
  return { types: out, decisions };
}

/** Legend symbol definitions of another target: a legend type whose
 *  description names another target's tag ("PYLON SIGN RECTANGLE WITH
 *  CIRCUIT TAG A-18" -> PYLON SIGN; "POLE-MOUNTED SITE LIGHT WITH AIMING
 *  ARROW…" -> SITE LIGHT). Folded only when the legend entry itself counted
 *  0 — it is the symbol's definition, not a second item. */
export function applySymbolDefinitions(types: Ty[], targetsIn: CountTarget[]): { types: Ty[]; merged: Array<{ key: string; into: string }> } {
  const targets = new Map(targetsIn.map(t => [t.key, t]));
  const out = types.map(t => ({ ...t, flags: [...t.flags] }));
  const merged: Array<{ key: string; into: string }> = [];
  for (const t of out) {
    const tgt = targets.get(t.key);
    if (!tgt || tgt.source !== 'legend' || t.status === 'counted' || t.status === 'merged' || tgt.role === 'host') continue;
    // Only an equipment symbol, never a device that happens to name a tag
    // ("Duplex receptacle at pylon sign base" is a receptacle to count).
    if (tgt.category !== 'equipment' || /RECEPT|OUTLET|SWITCH|SENSOR|\bGFC?I\b|J-?BOX|JUNCTION/i.test(t.description)) continue;
    const desc = ` ${t.description.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
    // Only a scheduled TAG ("PYLON SIGN", "SITE LIGHT", "DISCON A") — never
    // another legend entry, whose key is itself a description ("MOTION
    // SENSOR" is not what "Motion sensor LSXR-50-HL" defines).
    const into = out.find(o => o !== t && o.key.length >= 5 && /[A-Z]{3}/.test(o.key)
      && !o.key.startsWith('(') && desc.includes(` ${o.key.replace(/[^A-Z0-9]+/g, ' ').trim()} `)
      && ['fixture_schedule', 'equipment_schedule'].includes(targets.get(o.key)?.source ?? '')
      && targets.get(o.key)?.role !== 'host');
    if (!into) continue;
    const final = into.status === 'merged' ? ((into as Ty & { mergedInto?: string }).mergedInto ?? into.type) : into.type;
    const reason = `legend symbol for ${into.type}${final !== into.type ? ` (counted as ${final})` : ''} — the symbol's definition, not a second item`;
    t.flags.push(`Merged into ${final}: ${reason}.`);
    (t as Ty & { mergedInto?: string }).mergedInto = final;
    t.status = 'merged' as Ty['status'];
    t.count = 0;
    t.reason = reason;
    merged.push({ key: t.key, into: into.key });
  }
  return { types: out, merged };
}

const SIG_STOP = new Set(['THE', 'AND', 'WITH', 'FOR', 'VIA', 'PER', 'FROM', 'EACH', 'ALL', 'NEW', 'TYPE', 'UNIT', 'BY']);
function sigWordsOf(s: string): Set<string> {
  return new Set(s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ')
    .map(w => w.replace(/([A-Z]{3,})S$/, '$1')).filter(w => w.length >= 3 && !SIG_STOP.has(w)));
}

/** An equipment-schedule row for a symbol the legend defines and the
 *  counter counted: EF "Restroom recessed exhaust fans, wired via CMR-9…"
 *  (0 — the plans draw the legend's symbol, not the tag) is the legend's
 *  "Exhaust fan recessed" (2). Folded only when the schedule type counted 0
 *  and its description contains EVERY significant word (2+) of the counted
 *  legend type's description; equipment only (never a receptacle — a
 *  "phone board duplex" is not a plain duplex). */
export function applyScheduleLegendEquivalence(types: Ty[], targetsIn: CountTarget[]): { types: Ty[]; merged: Array<{ key: string; into: string }> } {
  const targets = new Map(targetsIn.map(t => [t.key, t]));
  const out = types.map(t => ({ ...t, flags: [...t.flags] }));
  const merged: Array<{ key: string; into: string }> = [];
  for (const t of out) {
    const tgt = targets.get(t.key);
    if (!tgt || tgt.source !== 'equipment_schedule' || tgt.category !== 'equipment' || t.status !== 'zero') continue;
    const mine = sigWordsOf(`${tgt.type} ${tgt.description}`);
    const into = out.filter(o => {
      const ot = targets.get(o.key);
      if (!ot || ot.source !== 'legend' || ot.category !== 'equipment' || o.status !== 'counted' || o.count <= 0 || ot.role === 'host') return false;
      const theirs = sigWordsOf(ot.description);
      return theirs.size >= 2 && [...theirs].every(w => mine.has(w));
    });
    if (into.length !== 1) continue;
    const reason = `the schedule's row for the legend symbol "${into[0].description}", counted ${into[0].count} on the plans — not a second item`;
    t.flags.push(`Merged into ${into[0].type}: ${reason}.`);
    (t as Ty & { mergedInto?: string }).mergedInto = into[0].type;
    t.status = 'merged' as Ty['status'];
    t.count = 0;
    t.reason = reason;
    merged.push({ key: t.key, into: into[0].key });
  }
  return { types: out, merged };
}
