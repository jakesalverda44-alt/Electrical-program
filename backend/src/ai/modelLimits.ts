// Next round A5 — per-model image limits, in ONE place.
//
// The vision API downscales every image to the model's long-edge ceiling.
// Opus 5.5 accepts images up to 2576 px on the long edge; every other model
// this CRM can name downscales to 1568 px. The counter sizes its tiles to
// the ceiling (fewer, sharper tiles on Opus 5.5); everything else keeps the
// 1568 px assumption.

export interface ModelImageLimits {
  /** Long-edge ceiling in pixels. */
  maxLongEdge: number;
}

const TABLE: Array<{ match: RegExp; limits: ModelImageLimits }> = [
  { match: /opus-5-5|opus-5\.5/i, limits: { maxLongEdge: 2576 } },
];

export const DEFAULT_IMAGE_LIMITS: ModelImageLimits = { maxLongEdge: 1568 };

export function imageLimitsFor(model: string): ModelImageLimits {
  return TABLE.find(t => t.match.test(model))?.limits ?? DEFAULT_IMAGE_LIMITS;
}

/** The counter's tile size for a model: tiles at the model's long-edge
 *  ceiling, sized so each lands at >= 196 px/in (the takeoff-accuracy floor)
 *  — 8" at 1568 px (196 px/in); 10.5" at 2576 px (245 px/in, sharper AND
 *  fewer: a 36x24 sheet is 12 tiles instead of 20). */
export function counterTileSpec(model: string): { maxLongEdge: number; tileIn: number; pxPerIn: number } {
  const { maxLongEdge } = imageLimitsFor(model);
  const tileIn = maxLongEdge >= 2576 ? 10.5 : 8;
  return { maxLongEdge, tileIn, pxPerIn: Math.floor(maxLongEdge / tileIn) };
}

/** Dense-area retry: the same sheet at a higher effective resolution —
 *  60% of the tile size (never under 5"). */
export function retryTileIn(tileIn: number): number {
  return Math.max(5, Math.round(tileIn * 0.6 * 10) / 10);
}
