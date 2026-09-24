// Evidence round 1.4 — are two plan sheets of the same level DUPLICATES (the
// same devices drawn twice) or COMPLEMENTARY layers (different devices of
// the same floor)? Pure. Replaces the title-only "same area?" question.
//
// Kissimmee: E-1 "Power Plan & General Notes" (receptacles, GFCIs, RTU
// disconnects) and E-2 "Conduit / Power and Data Plans" (power poles and
// junction boxes; office receptacles in its enlarged plan #11) are two
// layers of one floor. Title-only, they raised "same area?" and kept E-1's
// counts; the receptacles on E-2 were lost.
//
// Per type, from the two sheets' marks:
//   * content: each sheet's type histogram on its plans (host markers and
//     the type in question excluded) — cosine similarity < 0.5 means the
//     sheets carry different content;
//   * placement: the type's marks on each sheet, normalized to the sheet's
//     building footprint (the viewport reader's `building` box, else the
//     bounding box of all of that sheet's plan marks), paired nearest-first
//     within 6% of the footprint; enlarged-plan marks are mapped onto their
//     area of the main plan (or left out of the pairing when that area is
//     not known).
// Decision:
//   * >= 60% of the smaller set paired  -> duplicate (keep the larger);
//   * <= 20% paired AND content differs -> complementary (sum);
//   * anything else                     -> unclear (the estimator decides).
import { pdfToDisplayedIn, type RectIn, type SheetGeom, type Viewport } from './viewports';

export type SheetRelationKind = 'complementary' | 'duplicate' | 'unclear';

export interface RelationMark { typeKey: string; x: number; y: number; viewportId?: string | null }

export interface RelationSheet {
  key: string;
  label: string;
  geometry: SheetGeom | null;
  viewports: Viewport[] | null;
  marks: RelationMark[];
}

export interface SheetRelation {
  kind: SheetRelationKind;
  similarity: number | null;
  paired: number;
  compared: number;
  reason: string;
}

export const PAIR_TOL = 0.06;
export const DUPLICATE_FRAC = 0.6;
export const COMPLEMENTARY_FRAC = 0.2;
export const DIFFERENT_CONTENT_BELOW = 0.5;

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

/** Displayed-inch position of a mark on its sheet's MAIN plan: enlarged
 *  marks are mapped linearly from the enlarged viewport onto its area of the
 *  main plan; null when that can't be done. */
function mainPlanPosition(m: RelationMark, s: RelationSheet): { x: number; y: number } | null {
  if (!s.geometry) return null;
  const p = pdfToDisplayedIn(m.x, m.y, s.geometry);
  const vp = m.viewportId ? s.viewports?.find(v => v.id === m.viewportId) : undefined;
  if (!vp || vp.kind !== 'enlarged_plan') return p;
  if (!vp.areaOnMain) return null;
  const u = (p.x - vp.rectIn.left) / vp.rectIn.width;
  const w = (p.y - vp.rectIn.top) / vp.rectIn.height;
  return { x: vp.areaOnMain.left + u * vp.areaOnMain.width, y: vp.areaOnMain.top + w * vp.areaOnMain.height };
}

function footprint(s: RelationSheet): RectIn | null {
  const main = s.viewports?.find(v => v.kind === 'main_plan' && v.buildingIn);
  if (main?.buildingIn) return main.buildingIn;
  const pts = s.marks.map(m => mainPlanPosition(m, s)).filter((p): p is { x: number; y: number } => !!p);
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  return width > 0.5 && height > 0.5 ? { left, top, width, height } : null;
}

function normalized(s: RelationSheet, typeKey: string, fp: RectIn): Array<{ x: number; y: number }> {
  return s.marks.filter(m => m.typeKey === typeKey)
    .map(m => mainPlanPosition(m, s))
    .filter((p): p is { x: number; y: number } => !!p)
    .map(p => ({ x: (p.x - fp.left) / fp.width, y: (p.y - fp.top) / fp.height }));
}

/** Nearest-first one-to-one pairing within `tol` (unit square). */
export function pairCount(a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>, tol = PAIR_TOL): number {
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

export function relateSheets(typeKey: string, a: RelationSheet, b: RelationSheet, isHost: (k: string) => boolean = () => false): SheetRelation {
  const skip = (k: string) => k === typeKey || isHost(k);
  const similarity = cosine(histogram(a.marks, skip), histogram(b.marks, skip));
  const differs = similarity !== null && similarity < DIFFERENT_CONTENT_BELOW;
  const fa = footprint(a), fb = footprint(b);
  if (!fa || !fb) {
    return { kind: 'unclear', similarity, paired: 0, compared: 0, reason: `the marks' positions on ${!fa ? a.label : b.label} could not be aligned` };
  }
  const pa = normalized(a, typeKey, fa), pb = normalized(b, typeKey, fb);
  const compared = Math.min(pa.length, pb.length);
  if (!compared) {
    return { kind: 'unclear', similarity, paired: 0, compared: 0, reason: 'the positions of this type could not be placed on both main plans' };
  }
  const paired = pairCount(pa, pb);
  const frac = paired / compared;
  const sim = similarity === null ? 'n/a' : similarity.toFixed(2);
  if (frac >= DUPLICATE_FRAC) {
    return { kind: 'duplicate', similarity, paired, compared, reason: `${paired} of ${compared} marks sit in the same places on both sheets — the same devices drawn twice` };
  }
  if (frac <= COMPLEMENTARY_FRAC && differs) {
    return { kind: 'complementary', similarity, paired, compared, reason: `the sheets carry different content (similarity ${sim}) and only ${paired} of ${compared} marks line up — different layers of the floor, summed` };
  }
  return {
    kind: 'unclear', similarity, paired, compared,
    reason: frac <= COMPLEMENTARY_FRAC
      ? `the marks don't line up (${paired} of ${compared}) but the sheets carry similar content (similarity ${sim}) — they may be two parts of the level`
      : `${paired} of ${compared} marks line up — partly the same devices`,
  };
}
