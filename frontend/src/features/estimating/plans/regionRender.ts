// Estimating Phase B, Task 9 (deferral closed) — visible-region ("tile")
// rendering past the canvas-area cap. Pure: no pdf.js, no DOM. A large
// sheet (a 36x48in D-size sheet is 2592x3456pt) uniformly downscaled to
// stay under overlay.ts's 16.7M px cap goes visibly soft well before an
// estimator's actual working zoom (300-600%, to count small symbols) — the
// plan's fix is to render only the CURRENTLY VISIBLE region at the real
// requested resolution, onto a viewport-sized canvas, while a low-res full
// page renders underneath as a placeholder.
//
// pdf.js's page.render({canvasContext, viewport, transform}) applies
// `transform` to the canvas context BEFORE `viewport.transform` — verified
// directly against this app's own pdfjs-dist build
// (CanvasGraphics.beginDrawing: `ctx.transform(...transform)` runs first,
// `ctx.transform(...viewport.transform)` second), so `transform` operates
// in the SAME render-space pixels `viewport` itself produces, not raw PDF
// points. A plain translation `[1,0,0,1,-left,-top]` therefore shifts
// whatever render-space rectangle [left,top,left+width,top+height] would
// have painted, so it instead paints at the tile canvas's own (0,0) —
// exactly "render this rectangle of the full page onto a canvas the size
// of just that rectangle". This is rotation-agnostic by construction: the
// visible rectangle is already expressed in render-space (i.e.
// POST-rotation) pixels, the same space overlay.ts's pdfToScreen/
// renderedSize already produce — there is no separate rotation step here.
import { PageGeometry, renderedSize } from './overlay';

export interface VisibleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TileRenderPlan {
  /** The tile canvas's own pixel dimensions. */
  width: number;
  height: number;
  /** Where the tile sits within the FULL page's render-space, at the same
   *  scale the tile itself is rendered at — used to position the tile
   *  <canvas> absolutely over the (CSS-stretched) low-res base canvas. */
  left: number;
  top: number;
  /** Pass straight through to page.render({transform: ...}) alongside a
   *  viewport built at the tile's own targetScale. */
  transform: [number, number, number, number, number, number];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** True when a uniform whole-page render at `targetScale` would exceed
 *  overlay.ts's canvas-area cap — i.e. `clampedScale` (whatever
 *  clampRenderScale(geom, targetScale) returned) had to reduce it. This is
 *  the one signal PlanViewer needs to decide "base-only" vs "base+tile". */
export function needsTiledRender(targetScale: number, clampedScale: number): boolean {
  // A tiny floating-point epsilon — clampRenderScale returns the input
  // unchanged (not a nearby-but-not-equal value) when it's already under
  // the cap, so an exact comparison is safe; the epsilon only guards
  // against a caller passing values that went through unrelated rounding.
  return clampedScale < targetScale - 1e-9;
}

/** Plans the tile to render at `targetScale` for the given visible
 *  rectangle (render-space pixels, at `targetScale` — e.g. the container's
 *  scroll position + client size), expanded by `margin` px on every side
 *  (smooths panning — a tile slightly larger than the viewport means a
 *  small pan doesn't immediately reveal an un-tiled edge) and clamped to
 *  the full page's own bounds at `targetScale` so the tile never asks
 *  pdf.js to render past the page edge. Never produces a non-positive
 *  width/height (clamps to at least 1px) even for a degenerate input. */
export function planTileRender(geom: PageGeometry, targetScale: number, visible: VisibleRect, margin = 0): TileRenderPlan {
  const full = renderedSize(geom, targetScale);
  const rawLeft = visible.left - margin;
  const rawTop = visible.top - margin;
  const rawRight = visible.left + visible.width + margin;
  const rawBottom = visible.top + visible.height + margin;

  const left = clamp(rawLeft, 0, full.width);
  const top = clamp(rawTop, 0, full.height);
  const right = clamp(rawRight, 0, full.width);
  const bottom = clamp(rawBottom, 0, full.height);

  const width = Math.max(1, Math.round(right - left));
  const height = Math.max(1, Math.round(bottom - top));

  // `-left || 0` / `-top || 0` normalize `-0` to `0` — a left/top of
  // exactly 0 would otherwise negate to `-0`, which is numerically equal
  // to 0 for every real computation downstream (canvas transforms don't
  // care) but trips up strict deep-equality in tests and is needlessly
  // surprising to read in a debugger.
  return { width, height, left, top, transform: [1, 0, 0, 1, -left || 0, -top || 0] };
}

/** Whether two tile plans are close enough that re-rendering would be
 *  wasted work — used to debounce "re-render on settle" without
 *  re-rendering on every single scroll-event pixel of movement.
 *  `tolerancePx` defaults to a quarter of the smaller plan's own size, so
 *  a tile is re-rendered once panning has moved roughly a quarter-tile,
 *  not on every sub-pixel scroll delta. */
export function tilePlansRoughlyEqual(a: TileRenderPlan, b: TileRenderPlan, tolerancePx?: number): boolean {
  const tol = tolerancePx ?? Math.min(a.width, a.height, b.width, b.height) / 4;
  return Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol
    && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}
