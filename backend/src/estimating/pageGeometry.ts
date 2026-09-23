// Fix round 1 / S1 — a pure, rotation- and origin-aware "where does this
// PDF-space point land on the DISPLAYED (rotated) page" helper, used ONLY
// to test whether a title-block text item falls in the right-side strip of
// the page AS A HUMAN WOULD SEE IT (ai/pageClassifier.ts's own "right 25%
// strip, full height" heuristic, reused here on text instead of pixels —
// see sheets.ts's extractPageInfo). This project has no shared frontend/
// backend module, so this deliberately mirrors
// frontend/src/features/estimating/plans/overlay.ts's pdfToRenderMatrix
// EXACTLY (that file's own header comment documents it was verified
// against real pdfjs-dist output for all four rotations) — same
// convention, independent reimplementation, both sides tested against the
// same known-correct numbers. Kept at scale 1 (only relative position
// within the displayed page matters here, never absolute pixels), which
// cancels out of every formula below cleanly.
export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(rotation: number): Rotation {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as Rotation;
}

/** The displayed (post-rotation) page size — width/height swap at 90/270,
 *  same as overlay.ts's renderedSize. */
export function displayedSize(widthPt: number, heightPt: number, rotation: number): { width: number; height: number } {
  const r = normalizeRotation(rotation);
  return (r === 90 || r === 270) ? { width: heightPt, height: widthPt } : { width: widthPt, height: heightPt };
}

/** A PDF-space point (x, y), in this page's own absolute MediaBox
 *  coordinates, mapped to its position on the DISPLAYED (origin-corrected,
 *  rotation-corrected) page, at scale 1. Matches overlay.ts's
 *  pdfToRenderMatrix's four rotation cases exactly, after subtracting the
 *  page's own (originX, originY) first — the same origin-then-rotate order
 *  overlay.ts uses. */
export function screenPosition(
  x: number, y: number,
  originX: number, originY: number,
  widthPt: number, heightPt: number,
  rotation: number
): { x: number; y: number } {
  const relX = x - originX;
  const relY = y - originY;
  switch (normalizeRotation(rotation)) {
    case 0: return { x: relX, y: heightPt - relY };
    case 90: return { x: relY, y: relX };
    case 180: return { x: widthPt - relX, y: relY };
    case 270: return { x: heightPt - relY, y: widthPt - relX };
  }
}
