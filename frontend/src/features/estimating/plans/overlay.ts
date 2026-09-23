// Estimating Phase B, Task 4 — pure PDF-point <-> render-space transforms,
// rotation-aware, matching pdf.js's own viewport convention EXACTLY (so a
// marker drawn from these formulas lines up pixel-for-pixel with whatever
// pdf.js itself painted onto the canvas via page.render()).
//
// The four matrices below were not derived from memory — they were checked
// against real pdfjs-dist output (page.getViewport({scale}).transform and
// .convertToViewportPoint()) for known corner points at each of the four
// rotations, on the backend's pdfjs-dist during this same session. See
// backend/src/estimating/pdfjsLoader.ts's page.rotate/page.view for the
// server-side half of this contract — est_sheets.rotation is always one of
// 0/90/180/270 and est_sheets.width_pt/height_pt are always the page's
// UNROTATED extents, exactly what `PageGeometry` below expects.
//
// Design: pan/zoom is a CSS transform (scale + translate) applied to a
// wrapper `<div>` containing both the rendered `<canvas>` and the SVG
// overlay — never a per-marker recomputation (Decision/Task 4: "transform
// the group, not each child"). The SVG's own coordinate space is therefore
// always "render-space at a fixed renderScale" (the canvas's native pixel
// dimensions at the time it was rasterized), NOT raw browser client
// coordinates — a live pointer event's SVG-local point is obtained via
// `svg.getScreenCTM().inverse()` (the same proven pattern
// gen-pipeline/SurveyMarkupEditor.tsx already uses), which transparently
// accounts for whatever CSS pan/zoom transform is currently applied. This
// module's two functions are the other half: PDF point <-> that same
// render-space, so a marker's stored (PDF-point) coordinates never change
// across a pan, a zoom, or a re-render at a different resolution
// (Decision 5).
export type Rotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  /** The page's UNROTATED width, in PDF points (est_sheets.width_pt). */
  widthPt: number;
  /** The page's UNROTATED height, in PDF points (est_sheets.height_pt). */
  heightPt: number;
  rotation: Rotation;
  /** Fix round 1 / S1 — the page's own MediaBox/CropBox origin
   *  (est_sheets.origin_x_pt/origin_y_pt), almost always (0, 0) — pdf.js
   *  normalizes the overwhelming majority of real-world PDFs to start
   *  there — but a CAD-exported PDF can use any origin. Every PDF-space
   *  point pdfjs itself hands back (page.view, a text item's transform)
   *  is in this SAME absolute coordinate space, so this needs to be
   *  subtracted before applying pdfToRenderMatrix below (never baked into
   *  the matrix itself — origin-then-rotate, in that order, matches
   *  pdf.js's own PageViewport construction, verified against the
   *  review's own hand-checked per-rotation numbers in overlay.test.ts).
   *  Optional and defaults to 0 so every existing caller (every est_sheets
   *  row that predates the origin_x_pt/origin_y_pt columns) is exactly
   *  equivalent to what this module already assumed. */
  originXPt?: number;
  originYPt?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The 6-element affine matrix [a, b, c, d, e, f] such that
 *  screenX = a*pdfX + c*pdfY + e, screenY = b*pdfX + d*pdfY + f — the exact
 *  layout pdf.js's own Viewport.transform uses. */
export type AffineMatrix = [number, number, number, number, number, number];

function normalizeRotation(rotation: number): Rotation {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as Rotation;
}

/** The render-space pixel size of a page at `renderScale`, accounting for a
 *  90/270 rotation swapping displayed width/height. */
export function renderedSize(geom: PageGeometry, renderScale: number): { width: number; height: number } {
  const rotation = normalizeRotation(geom.rotation);
  const swapped = rotation === 90 || rotation === 270;
  const w = (swapped ? geom.heightPt : geom.widthPt) * renderScale;
  const h = (swapped ? geom.widthPt : geom.heightPt) * renderScale;
  return { width: w, height: h };
}

/** The affine matrix mapping PDF user-space points to render-space pixels
 *  at `renderScale`, for one of the four axis-aligned rotations pdf.js (and
 *  this app's PDFs) ever use. Verified against real pdfjs-dist output —
 *  see this file's header comment. This is the ZERO-ORIGIN form — it
 *  assumes the page's own MediaBox starts at (0,0). Every real call site
 *  (pdfToScreen/screenToPdf/pdfToScreenMany below, PlanViewer's own <g>
 *  transform and zoomBy anchor) must go through
 *  `pdfToRenderMatrixWithOrigin` instead, which folds a non-zero origin
 *  into this same matrix — see R2-B1's own fix note there. Kept exported
 *  (not merged away) because it's still the right building block for that
 *  fold, and overlay.test.ts's own zero-origin corner-case assertions
 *  check it directly against pdfjs-dist's real output with no origin
 *  involved at all. */
export function pdfToRenderMatrix(geom: PageGeometry, renderScale: number): AffineMatrix {
  const { widthPt: W, heightPt: H, rotation } = geom;
  const s = renderScale;
  switch (normalizeRotation(rotation)) {
    case 0:
      return [s, 0, 0, -s, 0, H * s];
    case 90:
      return [0, s, s, 0, 0, 0];
    case 180:
      return [-s, 0, 0, s, W * s, 0];
    case 270:
      return [0, -s, -s, 0, H * s, W * s];
  }
}

// Fix round 2 / R2-B1 — S1 (round 1) made STORING a click origin-aware
// (screenToPdf subtracts/re-adds geom.originXPt/originYPt around the raw,
// zero-origin pdfToRenderMatrix above) but left every DRAWING path on the
// raw matrix: PlanViewer's own <g transform> (its SVG group matrix, drawing
// every marker in one shot per Decision 8) and zoomBy's anchor-preserving
// math both called pdfToRenderMatrix directly. The result: a marker stored
// through screenToPdf landed at the CORRECT pdf-space point, but got drawn
// back at the WRONG screen position, since nothing subtracted the origin a
// second time on the way out through the group matrix. Folding the origin
// directly into the matrix's own translation terms — e' = e - a*ox - c*oy,
// f' = f - b*ox - d*oy — makes ONE matrix correct for every use: apply it
// to a RAW (un-adjusted) pdf-space point and get the right screen position,
// with no separate "subtract origin first" step the caller could forget.
// pdfToScreen/screenToPdf/pdfToScreenMany below, PlanViewer.tsx's <g>
// transform, and zoomBy's anchor math all now go through this ONE function
// — never the raw pdfToRenderMatrix — so there is exactly one place this
// math can ever drift out of sync again.
export function pdfToRenderMatrixWithOrigin(geom: PageGeometry, renderScale: number): AffineMatrix {
  const [a, b, c, d, e, f] = pdfToRenderMatrix(geom, renderScale);
  const ox = geom.originXPt ?? 0;
  const oy = geom.originYPt ?? 0;
  return [a, b, c, d, e - a * ox - c * oy, f - b * ox - d * oy];
}

function invertMatrix([a, b, c, d, e, f]: AffineMatrix): AffineMatrix {
  const det = a * d - b * c;
  // Every matrix this module produces is a pure rotation+scale (|det| =
  // renderScale^2 > 0 for any renderScale > 0), so this never actually
  // divides by zero in practice — guarded anyway so a caller passing a
  // degenerate renderScale of 0 gets a well-defined (if useless) identity-
  // ish result instead of NaN/Infinity propagating silently.
  if (det === 0) return [1, 0, 0, 1, 0, 0];
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const iff = -(ib * e + id * f);
  return [ia, ib, ic, id, ie, iff];
}

function applyMatrix([a, b, c, d, e, f]: AffineMatrix, p: Point): Point {
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

/** PDF user-space point -> render-space pixel, at `renderScale`,
 *  rotation- and origin-aware. Fix round 2 / R2-B1 — goes through
 *  pdfToRenderMatrixWithOrigin (the origin folded into the matrix
 *  itself) rather than subtracting the origin from the point first: the
 *  SAME function PlanViewer.tsx's <g> transform and zoomBy's anchor math
 *  now use directly, so there is exactly one origin-handling code path
 *  for every consumer of this module, not one for "compute a point" and
 *  a separately-maintained one for "compute a matrix to draw with". */
export function pdfToScreen(geom: PageGeometry, renderScale: number, p: Point): Point {
  return applyMatrix(pdfToRenderMatrixWithOrigin(geom, renderScale), p);
}

/** Render-space pixel -> PDF user-space point — the inverse of pdfToScreen.
 *  Used when the estimator clicks/drags on the overlay and the resulting
 *  point needs to be stored (Decision 5: markups are always stored in PDF
 *  points, never screen pixels) — a real, absolute PDF-space coordinate,
 *  exactly what a re-load of the SAME page (or a future export) expects,
 *  never one silently relative to this page's own MediaBox. */
export function screenToPdf(geom: PageGeometry, renderScale: number, p: Point): Point {
  return applyMatrix(invertMatrix(pdfToRenderMatrixWithOrigin(geom, renderScale)), p);
}

export function pdfToScreenMany(geom: PageGeometry, renderScale: number, points: Point[]): Point[] {
  const m = pdfToRenderMatrixWithOrigin(geom, renderScale);
  return points.map(p => applyMatrix(m, p));
}

// ── Fit-to-container scale ──────────────────────────────────────────────

export type FitMode = 'width' | 'page';

/** The renderScale that fits a page (rotation-aware displayed size) inside
 *  a container of `containerWidth` x `containerHeight` CSS pixels, at a
 *  given base pixel density `dpr` (so a HiDPI screen gets a sharper
 *  render, not a blurrier one). 'width' fits the displayed width only
 *  (may overflow vertically, scrollable); 'page' fits both dimensions. */
export function fitScale(
  geom: PageGeometry,
  containerWidth: number,
  containerHeight: number,
  mode: FitMode,
  dpr = 1
): number {
  if (containerWidth <= 0 || containerHeight <= 0) return 1;
  const rotation = normalizeRotation(geom.rotation);
  const swapped = rotation === 90 || rotation === 270;
  const displayedWidthPt = swapped ? geom.heightPt : geom.widthPt;
  const displayedHeightPt = swapped ? geom.widthPt : geom.heightPt;
  if (displayedWidthPt <= 0 || displayedHeightPt <= 0) return 1;
  const widthScale = (containerWidth * dpr) / displayedWidthPt;
  if (mode === 'width') return widthScale;
  const heightScale = (containerHeight * dpr) / displayedHeightPt;
  return Math.min(widthScale, heightScale);
}

// ── Canvas area cap ──────────────────────────────────────────────────────

/** The plan caps rendered canvas area at 16.7M px (≈ the largest area every
 *  browser reliably rasterizes a 2D canvas at). Clamps a requested
 *  renderScale down (never up) so widthPt*renderScale * heightPt*renderScale
 *  never exceeds it — a page requesting a scale beyond this returns the
 *  largest scale that still fits, which the caller can re-render the
 *  visible region at full resolution on top of (per the plan's "cap canvas
 *  area — past that, render only the visible region at full resolution"). */
export const MAX_CANVAS_AREA_PX = 16_700_000;

export function clampRenderScale(geom: PageGeometry, requestedScale: number): number {
  if (requestedScale <= 0) return requestedScale;
  const { width, height } = renderedSize(geom, requestedScale);
  const area = width * height;
  if (area <= MAX_CANVAS_AREA_PX || area <= 0) return requestedScale;
  const factor = Math.sqrt(MAX_CANVAS_AREA_PX / area);
  return requestedScale * factor;
}
