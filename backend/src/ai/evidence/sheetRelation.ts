// Evidence round 1.4 — are two plan sheets of the same level DUPLICATES (the
// same devices drawn twice) or COMPLEMENTARY layers (different devices of
// the same floor)? Pure. Replaces the title-only "same area?" question.
//
// Kissimmee: E-1 "Power Plan & General Notes" (receptacles, GFCIs, RTU
// disconnects) and E-2 "Conduit / Power and Data Plans" (power poles and
// junction boxes; office receptacles in its enlarged plan #11) are two
// layers of one floor — EXCEPT that the office outlet B-32 is drawn on both
// (E-1's west wall and E-2 #11's kneewall, same circuit, same 18'-9"
// dimension). It is one outlet.
//
// Fix round B4 — summing needs POSITIVE evidence:
//   1. ALIGN the two sheets (never from the marks' own bounding box, which
//      differs whenever the sheets carry different content):
//        a. both main plans have the viewport reader's building box -> map
//           box onto box (offset and scale);
//        b. else, marks of types drawn on BOTH sheets vote for a translation
//           (every cross pair of one type proposes an offset; the offset
//           most pairs agree with, >= 3 of them and >= half the shared marks,
//           wins) — same scale required;
//        c. else, the SHEET FRAME: same displayed page size and the same
//           main-plan scale -> identity, with a coarser tolerance;
//        d. else -> unclear.
//   2. PAIR the type's marks nearest-first within the tolerance (0.5" of
//      paper after a box / vote alignment, 1.0" on the bare frame). A pair is
//      ONE object on both sheets. Enlarged-plan marks are mapped onto their
//      area of the main plan first; one that can't be placed -> unclear.
//   3. Decide:
//        * >= 60% of the smaller set paired      -> duplicate (keep the larger);
//        * different content (cosine < 0.5)     -> complementary: sum the two
//                                                    minus the pairs (every
//                                                    pair counted once);
//        * anything else (similar or unknown     -> unclear: the estimator
//          content, no alignment)                   decides; never a sum.
import { displayedInches, pdfToDisplayedIn, type RectIn, type SheetGeom, type Viewport } from './viewports';

export type SheetRelationKind = 'complementary' | 'duplicate' | 'unclear';

export interface RelationMark { typeKey: string; x: number; y: number; viewportId?: string | null }

export interface RelationSheet {
  key: string;
  label: string;
  geometry: SheetGeom | null;
  viewports: Viewport[] | null;
  marks: RelationMark[];
}

export type AlignmentKind = 'building' | 'marks' | 'frame';

export interface SheetRelation {
  kind: SheetRelationKind;
  similarity: number | null;
  paired: number;
  compared: number;
  /** complementary: the count to use for the pair = a + b - paired. */
  combined?: number;
  alignment?: AlignmentKind;
  reason: string;
}

export const DUPLICATE_FRAC = 0.6;
export const DIFFERENT_CONTENT_BELOW = 0.5;
/** Paper inches: after a building-box or mark-vote alignment. */
export const PAIR_TOL_IN = 0.5;
/** Paper inches: on the bare sheet frame (two sheets of one set are drawn
 *  at the same place to within about an inch — Kissimmee E-1/E-2 are 0.9"
 *  apart). */
export const FRAME_TOL_IN = 1.0;
const VOTE_TOL_IN = 0.3;
export const MAX_VOTE_OFFSET_IN = 3;

function histogram(marks: RelationMark[], skip: (k: string) => boolean): Map<string, number> {
  const h = new Map<string, number>();
  for (const m of marks) if (!skip(m.typeKey)) h.set(m.typeKey, (h.get(m.typeKey) ?? 0) + 1);
  return h;
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number | null {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; dot += v * (b.get(k) ?? 0); }
  for (const v of b.values()) nb += v * v;
  if (!na || !nb) return null;
  return dot / Math.sqrt(na * nb);
}

type Pt = { x: number; y: number };

/** Displayed-inch position of a mark on its sheet's MAIN plan: enlarged
 *  marks are mapped linearly from the enlarged viewport onto its area of the
 *  main plan; null when that can't be done. */
function mainPlanPosition(m: RelationMark, s: RelationSheet): Pt | null {
  if (!s.geometry) return null;
  const p = pdfToDisplayedIn(m.x, m.y, s.geometry);
  const vp = m.viewportId ? s.viewports?.find(v => v.id === m.viewportId) : undefined;
  if (!vp || vp.kind !== 'enlarged_plan') return p;
  if (!vp.areaOnMain) return null;
  const u = (p.x - vp.rectIn.left) / vp.rectIn.width;
  const w = (p.y - vp.rectIn.top) / vp.rectIn.height;
  return { x: vp.areaOnMain.left + u * vp.areaOnMain.width, y: vp.areaOnMain.top + w * vp.areaOnMain.height };
}

function mainOf(s: RelationSheet): Viewport | undefined {
  return s.viewports?.find(v => v.kind === 'main_plan');
}

/** Nearest-first one-to-one pairing within `tol` (same units as the points). */
export function pairPoints(a: Pt[], b: Pt[], tol: number): number {
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  a.forEach((p, i) => b.forEach((q, j) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= tol) pairs.push({ i, j, d });
  }));
  pairs.sort((x, y) => x.d - y.d);
  const ua = new Set<number>(), ub = new Set<number>();
  let n = 0;
  for (const p of pairs) {
    if (ua.has(p.i) || ub.has(p.j)) continue;
    ua.add(p.i); ub.add(p.j); n++;
  }
  return n;
}
/** Kept for callers of the first version. */
export const pairCount = (a: Pt[], b: Pt[], tol = 0.06) => pairPoints(a, b, tol);

export interface Alignment { kind: AlignmentKind; map: (p: Pt) => Pt; tol: number; note: string }

/** Pure: how sheet B's main-plan positions map onto sheet A's (null = they
 *  can't be aligned). `skip` leaves host markers out of the vote. */
export function alignSheets(a: RelationSheet, b: RelationSheet, skip: (k: string) => boolean = () => false): Alignment | null {
  const ba = mainOf(a)?.buildingIn, bb = mainOf(b)?.buildingIn;
  if (ba && bb && ba.width > 0 && bb.width > 0 && ba.height > 0 && bb.height > 0) {
    const sx = ba.width / bb.width, sy = ba.height / bb.height;
    return { kind: 'building', tol: PAIR_TOL_IN, note: 'building outlines aligned',
      map: p => ({ x: ba.left + (p.x - bb.left) * sx, y: ba.top + (p.y - bb.top) * sy }) };
  }
  const sameScale = (() => {
    const ma = mainOf(a)?.inPerFt ?? null, mb = mainOf(b)?.inPerFt ?? null;
    return ma === mb || (ma != null && mb != null && Math.abs(ma - mb) < 1e-9);
  })();
  if (!a.geometry || !b.geometry || !sameScale) return null;
  // b. Vote: every cross pair of one type proposes b -> a offset.
  const pos = (s: RelationSheet) => {
    const m = new Map<string, Pt[]>();
    for (const mk of s.marks) {
      if (skip(mk.typeKey)) continue;
      const p = mainPlanPosition(mk, s);
      if (!p) continue;
      if (!m.has(mk.typeKey)) m.set(mk.typeKey, []);
      m.get(mk.typeKey)!.push(p);
    }
    return m;
  };
  const pa = pos(a), pb = pos(b);
  const shared = [...pa.keys()].filter(k => pb.has(k));
  const sharedMin = shared.reduce((s, k) => s + Math.min(pa.get(k)!.length, pb.get(k)!.length), 0);
  if (sharedMin >= 3) {
    const cands: Pt[] = [];
    // Sheets of one set draw a plan at nearly the same place: an offset
    // over MAX_VOTE_OFFSET_IN is a coincidence of a regular pattern (a
    // partition drawn at the same page position), never a registration.
    for (const k of shared) for (const p of pa.get(k)!) for (const q of pb.get(k)!) {
      const off = { x: p.x - q.x, y: p.y - q.y };
      if (Math.hypot(off.x, off.y) <= MAX_VOTE_OFFSET_IN) cands.push(off);
    }
    let best: { off: Pt; votes: number } | null = null;
    for (const off of cands) {
      let votes = 0;
      for (const k of shared) votes += pairPoints(pa.get(k)!, pb.get(k)!.map(q => ({ x: q.x + off.x, y: q.y + off.y })), VOTE_TOL_IN);
      if (!best || votes > best.votes) best = { off, votes };
    }
    if (best && best.votes >= 3 && best.votes >= sharedMin / 2) {
      const off = best.off;
      return { kind: 'marks', tol: PAIR_TOL_IN, note: `${best.votes} shared marks agree on an offset of ${off.x.toFixed(2)}", ${off.y.toFixed(2)}"`,
        map: p => ({ x: p.x + off.x, y: p.y + off.y }) };
    }
  }
  // c. The sheet frame.
  const da = displayedInches(a.geometry), db = displayedInches(b.geometry);
  if (Math.abs(da.width - db.width) < 0.1 && Math.abs(da.height - db.height) < 0.1) {
    return { kind: 'frame', tol: FRAME_TOL_IN, note: 'same sheet size and scale — compared on the sheet frame', map: p => p };
  }
  return null;
}

export function relateSheets(typeKey: string, a: RelationSheet, b: RelationSheet, isHost: (k: string) => boolean = () => false): SheetRelation {
  const skip = (k: string) => k === typeKey || isHost(k);
  const similarity = cosine(histogram(a.marks, skip), histogram(b.marks, skip));
  const differs = similarity !== null && similarity < DIFFERENT_CONTENT_BELOW;
  const sim = similarity === null ? 'n/a' : similarity.toFixed(2);
  const ofType = (s: RelationSheet) => s.marks.filter(m => m.typeKey === typeKey);
  const na = ofType(a).length, nb = ofType(b).length;
  const al = alignSheets(a, b, isHost);
  if (!al) {
    return { kind: 'unclear', similarity, paired: 0, compared: Math.min(na, nb), reason: `${a.label} and ${b.label} could not be aligned (no building outline on both, too few shared marks, different sheet size or scale)` };
  }
  const place = (s: RelationSheet) => ofType(s).map(m => mainPlanPosition(m, s));
  const ra = place(a), rb = place(b);
  if (ra.some(p => !p) || rb.some(p => !p)) {
    return { kind: 'unclear', similarity, paired: 0, compared: Math.min(na, nb), alignment: al.kind, reason: 'some of this type are on an enlarged plan whose place on the main plan is not known' };
  }
  const pa = ra as Pt[], pb = (rb as Pt[]).map(al.map);
  const compared = Math.min(na, nb);
  const paired = compared ? pairPoints(pa, pb, al.tol) : 0;
  const frac = compared ? paired / compared : 0;
  if (compared && frac >= DUPLICATE_FRAC) {
    return { kind: 'duplicate', similarity, paired, compared, alignment: al.kind, reason: `${paired} of ${compared} marks sit in the same places on both sheets (${al.note}) — the same devices drawn twice` };
  }
  if (differs) {
    const combined = na + nb - paired;
    return {
      kind: 'complementary', similarity, paired, compared, combined, alignment: al.kind,
      reason: `the sheets carry different content (similarity ${sim}) and ${paired ? `only ${paired} of ${compared} marks sit in the same place (${al.note}) — ${paired === 1 ? 'that one is' : 'those are'} counted once` : `none of the marks sit in the same place (${al.note})`}: different layers of the floor, ${combined} in all`,
    };
  }
  return {
    kind: 'unclear', similarity, paired, compared, alignment: al.kind,
    reason: similarity === null
      ? `the sheets' other content can't be compared, and ${paired} of ${compared} marks line up`
      : `${paired} of ${compared} marks line up and the sheets carry similar content (similarity ${sim}) — they may be two parts of the level`,
  };
}

export type { RectIn };
