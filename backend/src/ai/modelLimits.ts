// Per-model image limits, in ONE place (next round A5; fix round S1).
//
// The API's real limits (platform.claude.com/docs/en/build-with-claude/vision,
// read 2026-09-24): an image costs ceil(w/28) x ceil(h/28) visual tokens,
// and each model has BOTH a long-edge limit and a visual-token limit — an
// image over either is downscaled by the server:
//
//   high-resolution tier (Claude 4.7 and later, e.g. Opus 5.5, Sonnet 5):
//       2576 px long edge, 4784 visual tokens (~3.75 MP)
//   standard tier (every other model, e.g. Sonnet 4.6, Haiku 4.5):
//       1568 px long edge, 1568 visual tokens (~1.2 MP, e.g. 1092x1092)
//
// Tiles are sized so NOTHING is downscaled by the server: we send each tile
// at the largest size that fits both limits (fitImageToLimits), and choose
// the tile size in inches so a square tile lands at >= 196 px/in (the
// takeoff-accuracy floor) within the token budget.

export interface ModelImageLimits {
  tier: 'high' | 'standard';
  /** Long-edge limit in pixels. */
  maxLongEdge: number;
  /** Visual-token limit (28x28 patches). */
  maxTokens: number;
}

export const HIGH_RES_LIMITS: ModelImageLimits = { tier: 'high', maxLongEdge: 2576, maxTokens: 4784 };
export const STANDARD_LIMITS: ModelImageLimits = { tier: 'standard', maxLongEdge: 1568, maxTokens: 1568 };
/** Kept for older callers: the standard tier. */
export const DEFAULT_IMAGE_LIMITS = STANDARD_LIMITS;

/** Claude 4.7 and later are high-resolution. Handles plain ids
 *  ("claude-opus-5-5"), dated / [1m] suffixes and Bedrock / Vertex forms
 *  ("anthropic.claude-sonnet-5-..."). Unknown -> standard (the smaller
 *  limits never cause a server downscale). */
export function imageLimitsFor(model: string): ModelImageLimits {
  const m = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d+))?/i.exec(model) ?? /claude-(\d+)(?:[-.](\d+))?-(?:opus|sonnet|haiku)/i.exec(model);
  if (!m) return STANDARD_LIMITS;
  const major = Number(m[1]);
  // "claude-sonnet-4-5-20250929": the minor is the next small number, never a date.
  const minor = m[2] && m[2].length <= 2 ? Number(m[2]) : 0;
  return major > 4 || (major === 4 && minor >= 7) ? HIGH_RES_LIMITS : STANDARD_LIMITS;
}

/** Visual tokens an image of w x h costs. */
export function imageTokens(w: number, h: number): number {
  return Math.ceil(w / 28) * Math.ceil(h / 28);
}

/** The largest w' x h' (same aspect, never larger than w x h) that the
 *  server keeps as is: long edge and visual tokens both within limits. */
export function fitImageToLimits(w: number, h: number, limits: ModelImageLimits): { width: number; height: number } {
  let s = Math.min(1, limits.maxLongEdge / Math.max(w, h));
  let W = Math.max(1, Math.floor(w * s));
  let H = Math.max(1, Math.floor(h * s));
  for (let i = 0; i < 60 && imageTokens(W, H) > limits.maxTokens; i++) {
    s *= Math.min(0.995, Math.sqrt(limits.maxTokens / imageTokens(W, H)));
    W = Math.max(1, Math.floor(w * s));
    H = Math.max(1, Math.floor(h * s));
  }
  return { width: W, height: H };
}

/** The largest square side the server keeps as is. */
export function maxSquareSide(limits: ModelImageLimits): number {
  return Math.min(limits.maxLongEdge, Math.floor(Math.sqrt(limits.maxTokens)) * 28);
}

/** The takeoff-accuracy floor: symbols are counted at >= 196 px/in. */
export const COUNTER_TARGET_PX_PER_IN = 196;

/** The counter's tile size for a model: the largest tile (in inches) that a
 *  square tile still gets >= 196 px/in within the model's limits.
 *    high-res  (1932 px square): 9.8" tiles  -> 12 tiles on a 36x24 sheet
 *    standard  (1092 px square): 5.5" tiles  -> 42 tiles on a 36x24 sheet
 *  (Before this fix the standard tier used 8" tiles at 1568 px, which the
 *  server downscaled to ~1.2 MP: ~148 px/in, not the 196 the report said.) */
export function counterTileSpec(model: string): { maxLongEdge: number; maxTokens: number; tileIn: number; pxPerIn: number; limits: ModelImageLimits } {
  const limits = imageLimitsFor(model);
  const side = maxSquareSide(limits);
  const tileIn = Math.floor((side / COUNTER_TARGET_PX_PER_IN) * 10) / 10;
  return { maxLongEdge: limits.maxLongEdge, maxTokens: limits.maxTokens, tileIn, pxPerIn: Math.floor(side / tileIn), limits };
}

/** Dense-area retry: the same sheet at a higher effective resolution —
 *  60% of the tile size, but never smaller than the tile that already
 *  reaches the 300 DPI counting raster (smaller tiles add calls, not
 *  detail), and never under 3". */
export function retryTileIn(tileIn: number, limits?: ModelImageLimits, rasterDpi = 300): number {
  const floorAtRaster = limits ? Math.floor((maxSquareSide(limits) / rasterDpi) * 10) / 10 : 0;
  return Math.max(3, floorAtRaster, Math.round(tileIn * 0.6 * 10) / 10);
}
