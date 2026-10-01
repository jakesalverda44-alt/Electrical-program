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
import { pdfToDisplayedIn, viewportAt, type SheetGeom, type Viewport } from './viewports';
import { registerPointSets, registerSameSheet, REG_MAX_POINTS, type Registration } from './siteRegistration';

const SERIES_RE = /\b(DSXW?\d|DSX\d|RSX\d|WSX\d|TWX\d|WPX\d|OLWX\d|EVO|LDN\d|CPX|ZL\d|LBL\d|XSP\w?\d|KAD|GLEON|VP\d|ARC\d)\b/i;

/** "Lithonia DSX1 LED P8 40K T4M MVOLT HS" -> { series: 'DSX1', full: 'DSX1 LED P8 40K T4M' }.
 *  Fix round S11 — normalized: hyphens and spaces are both separators
 *  ("DSX1-LED-P8-40K-T4M-MVOLT" = "DSX1 LED P8 40K T4M MVOLT"); voltage and
 *  option suffixes (120/208/240/277/347/480, MVOLT, HVOLT, HS, finishes,
 *  mounting / control options) never enter the key; a repeated token ends
 *  it. */
const VOLTAGES = new Set(['120', '208', '240', '277', '347', '480', '600']);
const OPTION = /^(MVOLT|HVOLT|XVOLT|UVOLT|HS|DDBXD|DBLXD|DNAXD|DWHXD|DDBTXD|SPA|RPA|WBA|SPUMBA|RPUMBA|PIR\w*|NLTAIR\w*|PER\d?|SF|DF|DMG|E\d+WC|E\d+|BAA|FAO|SPD\w*|L90|R90|CR\d+)$/;
export function catalogOf(description: string): { series: string; full: string } | null {
  const d = description.toUpperCase().replace(/[,;()]/g, ' ');
  const m = SERIES_RE.exec(d);
  if (!m) return null;
  const tail = d.slice(m.index).split(/[\s-]+/).filter(Boolean);
  const toks = [tail[0]];
  for (const t of tail.slice(1, 10)) {
    if (toks.includes(t)) break; // a repeated token is the next field ("… HS LED 207W")
    if (VOLTAGES.has(t) || OPTION.test(t)) continue;
    if (/^(LED|P\d+|\d+C|\d{3,5}|\d{2}K|T\d[A-Z]*|TFTM|FT|AS[YM]|R\d?)$/.test(t)) toks.push(t);
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
  /** Member counted more than its primary — the estimator decides.
   *  Accuracy round A2 — `text` (a site-pole family whose electrical-plan
   *  and photometric counts differ): the question as asked, with both
   *  counts; `sheets` = the two sheets to look at. */
  question?: { key: string; memberCount: number; primaryCount: number; into: string; intoKeys: string[]; text?: string; sheets?: string[] };
  flags: string[];
  /** Accuracy round A2/A3 — a site-pole family drawn on the electrical plans
   *  AND the photometric sheet: whether the two drawings' marks line up,
   *  and which electrical-plan mark is which photometric type. */
  registration?: {
    registered: boolean;
    reason: string;
    residualIn?: number;
    pairs?: Array<{ sheetKey: string; typeKey: string; x: number; y: number; twinOf: string }>;
  };
  /** Accuracy round A2 Rule 2 — two site types of one series from different
   *  schedules, both counted on the electrical plans, whose marks do not
   *  line up: kept separate (never stacked silently), one non-blocking
   *  "same poles?" review item each. */
  samePoles?: Array<{ key: string; type: string; count: number; into: string; intoCount: number; reason: string; merged?: boolean }>;
  /** Fix round 1 (review B-3) — Rule 1 reconciled on equal counts WITHOUT a
   *  registration (too few / too many marks, not one sheet each, collinear,
   *  or an ambiguous mirror): a non-blocking confirm so the merge is
   *  visible, never only a flag. */
  assumedSame?: { key: string; count: number; text: string; sheets: string[]; why: string };
}

/** Accuracy round A2/A3 — where each type's marks are (the registration
 *  check needs them). Optional: without it the family rules decide on the
 *  counts alone ("not registered"). */
export interface SiteFamilyContext {
  sheets: Array<{
    key: string; label: string; photometric?: boolean;
    geometry: SheetGeom | null | undefined; viewports?: Viewport[] | null;
    marks: Array<{ typeKey: string; x?: number; y?: number }>;
  }>;
}

type Ty = TypeCountResult;

function photometricOnly(t: Ty): boolean { return !!t.photometricOnly; }

/** Fix round S11 — the SCHEDULE's identity: its sheet number ("E-7 SITE
 *  PLAN", "E-7", "e7" -> "E7"), not the raw source string. */
export function scheduleIdOf(sourceSheet: string): string {
  const m = /\b([A-Z]{1,3})\s*[-.]?\s*(\d{1,3}(?:\.\d{1,2})?[A-Z]?)\b/i.exec(sourceSheet);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : sourceSheet.trim().toUpperCase();
}

function sourceOf(t: Ty, targets: Map<string, CountTarget>): string {
  return scheduleIdOf(targets.get(t.key)?.sourceSheet ?? '');
}

const isSiteCat = (c: Ty['category']) => c === 'site_lighting' || c === 'exterior_building';
const countedE = (t: Ty) => t.status === 'counted' && t.count > 0 && !photometricOnly(t);
const countedP = (t: Ty) => t.status === 'counted' && t.count > 0 && photometricOnly(t);
const shortLabel = (l: string) => l.split(' ')[0];

/** The marks of some types, when they are all on ONE sheet: displayed
 *  inches, and the scale of the viewport they are drawn in. */
function marksOf(keys: string[], ctx: SiteFamilyContext | undefined): { sheetKey: string; pts: Array<{ typeKey: string; x: number; y: number; pdf: { x: number; y: number } }>; inPerFt: number | null } | null {
  if (!ctx) return null;
  const on = ctx.sheets.map(s => ({ s, ms: s.marks.filter(m => keys.includes(m.typeKey) && Number.isFinite(m.x) && Number.isFinite(m.y)) })).filter(x => x.ms.length);
  if (on.length !== 1 || !on[0].s.geometry) return null;
  const { s, ms } = on[0];
  const pts = ms.map(m => ({ typeKey: m.typeKey, ...pdfToDisplayedIn(m.x!, m.y!, s.geometry!), pdf: { x: m.x!, y: m.y! } }));
  const vp = pts.length && s.viewports?.length ? viewportAt(s.viewports, pts[0].x, pts[0].y) : null;
  return { sheetKey: s.key, pts, inPerFt: vp?.inPerFt ?? null };
}

function register(a: string[], b: string[], ctx: SiteFamilyContext | undefined, o: { minPaired?: number; rule2?: boolean } = {}): { reg: Registration | null; a: ReturnType<typeof marksOf>; b: ReturnType<typeof marksOf>; why?: string } {
  const A = marksOf(a, ctx), B = marksOf(b, ctx);
  if (!A || !B) return { reg: null, a: A, b: B, why: 'the marks are not on one sheet each (or not known)' };
  const minPoints = o.rule2 ? 4 : 3;
  const none = (): { reg: null; a: typeof A; b: typeof B; why: string } => ({ reg: null, a: A, b: B, why: `fewer than ${minPoints} or more than ${REG_MAX_POINTS} marks on a side (${A.pts.length} / ${B.pts.length})` });
  // Review B-1(a): two sets on ONE sheet are the same poles only when they
  // coincide in place — never by a scale/rotation fit.
  if (A.sheetKey === B.sheetKey) {
    if (A.pts.length < minPoints || B.pts.length < minPoints) return none();
    const reg = registerSameSheet(A.pts, B.pts, { minPaired: o.minPaired, minPoints });
    return { reg, a: A, b: B };
  }
  const reg = registerPointSets(A.pts, B.pts, { inPerFtA: A.inPerFt, inPerFtB: B.inPerFt, minPaired: o.minPaired, minPoints, requireScales: o.rule2 });
  return reg ? { reg, a: A, b: B } : none();
}

/** Accuracy round A2 Rule 1 — a site family drawn on the electrical plans
 *  (E) AND counted only on the photometric sheet (P), under types of
 *  DIFFERENT schedules whose catalog numbers share only the series (the
 *  full-catalog case keeps its own path). The photometric sheet never adds
 *  poles: counts that reconcile keep P's types (and heads) with E's
 *  positions; counts that differ keep E's total and ask ONE question.
 *  Nothing is ever summed. Mutates the (copied) type results. */
function siteRule1(members: Ty[], targets: Map<string, CountTarget>, series: string, ctx: SiteFamilyContext | undefined, d: FamilyDecision): { primaries: Ty[]; handled: Set<Ty> } | null {
  const E = members.filter(countedE), P = members.filter(countedP);
  if (!E.length || !P.length) return null;
  const srcE = new Set(E.map(m => sourceOf(m, targets))), srcP = new Set(P.map(m => sourceOf(m, targets)));
  if ([...srcE].some(x => srcP.has(x))) return null;
  const full = (t: Ty) => catalogOf(t.description)?.full ?? '';
  if (E.every(e => P.some(p => full(p) === full(e)))) return null; // the full-catalog path (unchanged)
  const sumE = E.reduce((n, t) => n + t.count, 0), sumP = P.reduce((n, t) => n + t.count, 0);
  const sheetsOf = (ts: Ty[]) => [...new Set(ts.flatMap(t => t.sheets.filter(x => x.used).map(x => shortLabel(x.label))))].join(', ') || 'the plans';
  const eSheet = sheetsOf(E), pSheet = sheetsOf(P);
  const eNames = E.map(t => t.type).join('/'), pNames = P.map(t => t.type).join('/');
  const pList = P.map(t => `${t.type} ${t.count}`).join(' + ');
  const r = register(E.map(t => t.key), P.map(t => t.key), ctx);
  if (r.reg) {
    d.registration = {
      registered: r.reg.accepted, reason: r.reg.reason, residualIn: r.reg.residualIn,
      ...(r.reg.accepted ? { pairs: r.reg.pairs.map(([i, j]) => ({ sheetKey: r.a!.sheetKey, typeKey: r.a!.pts[i].typeKey, x: r.a!.pts[i].pdf.x, y: r.a!.pts[i].pdf.y, twinOf: r.b!.pts[j].typeKey })) } : {}),
    };
  } else {
    d.registration = { registered: false, reason: `not registered — ${r.why}` };
  }
  const handled = new Set<Ty>([...E, ...P]);
  const regBroken = !!r.reg && !r.reg.accepted && r.reg.comparable !== false;
  if (sumE === sumP && !regBroken) {
    // Reconciled: P's types are the line structure, E's marks the positions.
    const reason = `same ${sumE} site poles as ${pNames}: ${eSheet} shows ${sumE}, ${pSheet}'s ${pList} = ${sumP} — types and heads from ${pSheet}, positions from ${eSheet}`;
    for (const p of P) {
      delete p.photometricOnly;
      p.sheets = [...p.sheets, ...E.flatMap(e => e.sheets.filter(x => x.used))];
      p.components = { drawn: p.count, typical: p.components?.typical ?? 0, schedule: p.components?.schedule ?? 0 };
      p.flags = p.flags.filter(f => !/not shown on the electrical plans/.test(f));
      p.flags.push(`${p.type}: on the electrical plans as ${eNames} (${eSheet}) — ${pSheet} gives the type and heads${d.registration.registered ? ' (the marks line up)' : ' (not registered — counts only)'}.`);
    }
    for (const e of E) {
      const hpp = targets.get(e.key)?.headsPerPole;
      if (hpp != null) e.flags.push(`${e.type}: its ${hpp} head${hpp === 1 ? '' : 's'} per pole (${targets.get(e.key)?.sourceSheet || 'its schedule'}) is not used — the heads come from ${pSheet}'s types (${P.map(t => `${t.type} ${targets.get(t.key)?.headsPerPole ?? '?'}`).join(', ')}).`);
      fold(e, pNames, reason, d);
    }
    if (!d.registration.registered) {
      d.flags.push(`${series} site poles: ${eSheet} and ${pSheet} agree on ${sumE} — ${d.registration.reason}.`);
      // Review B-3 — visible, not only a flag in the details list.
      d.assumedSame = {
        key: P[0].key, count: sumE, why: d.registration.reason,
        sheets: [eSheet, pSheet],
        text: `taken as the same ${sumE} pole${sumE === 1 ? '' : 's'} — positions not compared: ${eSheet} shows ${eNames} ${sumE}; ${pSheet} shows ${pList} = ${sumP}`,
      };
    }
    return { primaries: P, handled };
  }
  // Counts differ (or the positions do not line up): E's total stands under
  // E's types; P's types go to merged (count 0). ONE blocking question.
  const why = regBroken ? ` (the counts agree but the positions do not line up: ${r.reg!.reason})` : '';
  const text = `${eSheet} shows ${sumE} site pole${sumE === 1 ? '' : 's'}; ${pSheet} shows ${pList} = ${sumP}${why}. Which is right, and which pole types?`;
  for (const p of P) fold(p, eNames, `the photometric sheet's ${p.type} (${p.count}) — ${pSheet} is a fallback, never added to ${eSheet}'s ${sumE}; ${text}`, d);
  d.question = { key: P[0].key, memberCount: sumP, primaryCount: sumE, into: eNames, intoKeys: E.map(t => t.key), text, sheets: [eSheet, pSheet] };
  d.flags.push(`${series} site poles: ${text} — ${sumE} for now, needs the estimator.`);
  return { primaries: E, handled };
}

function fold(m: Ty, into: string, reason: string, d: FamilyDecision): void {
  const mCount = m.status === 'counted' ? m.count : 0;
  d.merged.push({ key: m.key, into, reason });
  m.flags.push(`Merged into ${into}: ${reason}.`);
  (m as Ty & { mergedInto?: string }).mergedInto = into;
  (m as Ty & { mergedCount?: number }).mergedCount = mCount;
  m.status = 'merged' as Ty['status'];
  m.count = 0;
  if (m.category === 'site_lighting') m.heads = 0;
  m.reason = reason;
}

/** Pure: fold family members. Mutates copies of the type results it
 *  returns; the input array is not modified. `ctx` (the marks) lets the
 *  site-pole rules check that two drawings show the same poles. */
export function applyFamilies(types: Ty[], targetsIn: CountTarget[], ctx?: SiteFamilyContext): { types: Ty[]; decisions: FamilyDecision[] } {
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
    const d: FamilyDecision = { family: series, primary: [], merged: [], flags: [] };
    // Accuracy round A2 — the photometric sheet never adds poles, at FAMILY
    // level (Rule 1); the zero / unreadable members follow as before.
    const r1 = isSiteCat(members[0].category) ? siteRule1(members, targets, series, ctx, d) : null;
    let primaries: Ty[];
    let others: Ty[];
    if (r1) {
      primaries = r1.primaries;
      others = members.filter(m => !r1.handled.has(m));
    } else {
      // The primary SOURCE schedule: the best-ranked member's schedule; every
      // member of that schedule is a primary (S1 and S2 both stay).
      const best = members.slice().sort((a, b) => rank(b) - rank(a) || b.count - a.count)[0];
      const primSrc = sourceOf(best, targets);
      primaries = members.filter(m => sourceOf(m, targets) === primSrc);
      others = members.filter(m => sourceOf(m, targets) !== primSrc);
    }
    d.primary = primaries.map(p => p.key);
    for (const m of others) {
      // Fix round S11 — an unreadable member is not "counted 0": it keeps
      // its own review item and is never folded away.
      if (m.status === 'unreadable') {
        d.flags.push(`${m.type} could not be read — not folded into the ${series} family; its own review item stays.`);
        continue;
      }
      const mc = catalogOf(m.description)!;
      const same = primaries.filter(p => catalogOf(p.description)!.full === mc.full);
      const group = same.length ? same : primaries;
      const groupCount = group.reduce((s, p) => s + (p.status === 'counted' ? p.count : 0), 0);
      const into = group.map(p => p.type).join('/');
      const mCount = m.status === 'counted' ? m.count : 0;
      if (!same.length && mCount > 0) {
        // Accuracy round A2 Rule 2 — two site types of one series from
        // different schedules, both on the electrical plans: the same poles
        // only when the drawings line up (>= 80% of the smaller set, at least 4 marks);
        // otherwise kept separate (today's count) and asked, never stacked
        // silently.
        const onPlans = isSiteCat(m.category) && countedE(m) && group.every(p => !photometricOnly(p)) && groupCount > 0;
        const r2 = onPlans ? register([m.key], group.map(p => p.key), ctx, { minPaired: 0.8, rule2: true }) : null;
        if (r2?.reg?.accepted) {
          const reason = `the same site poles as ${into}, drawn on another sheet — ${r2.reg.pairs.length} of ${Math.min(mCount, groupCount)} marks line up (${r2.reg.reason}); not stacked`;
          d.samePoles = [...(d.samePoles ?? []), { key: m.key, type: m.type, count: mCount, into, intoCount: groupCount, reason: r2.reg.reason, merged: true }];
          fold(m, into, reason, d);
          continue;
        }
        d.flags.push(`${m.type} (${m.description}) shares the ${series} series with ${into} but not the catalog number — kept as its own type.`);
        if (onPlans) {
          d.samePoles = [...(d.samePoles ?? []), { key: m.key, type: m.type, count: mCount, into, intoCount: groupCount,
            reason: r2?.reg ? r2.reg.reason : `not registered — ${r2?.why ?? 'no marks'}` }];
        }
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
    if (!tgt || tgt.source !== 'legend' || t.status !== 'zero' || tgt.role === 'host') continue;
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
    // Fix round S11 — a numbered, individually scheduled item (FDS-1, EF-2,
    // WH-1) is its own piece of equipment, never a generic legend symbol.
    if (/^[A-Z]{1,6}[\s-]*\d{1,3}[A-Z]?$/i.test(tgt.type.trim())) continue;
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
