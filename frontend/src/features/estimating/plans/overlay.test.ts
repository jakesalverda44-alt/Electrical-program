// Estimating Phase B, Task 4 — overlay.ts is pure; exhaustively tested,
// including all four rotations, per the coordinator's explicit instruction.
// The rotation matrices are cross-checked against REAL pdfjs-dist output
// (page.getViewport({scale}).convertToViewportPoint()) gathered against the
// backend's pdfjs-dist during this session — see the worked numbers in each
// rotation's test below.
import { describe, it, expect } from 'vitest';
import {
  pdfToScreen, screenToPdf, pdfToScreenMany, renderedSize, fitScale, clampRenderScale,
  MAX_CANVAS_AREA_PX, PageGeometry,
} from './overlay';

const W = 800;
const H = 600;

describe('pdfToScreen — rotation 0 (verified against real pdfjs-dist)', () => {
  const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 0 };
  // Ground truth (scale=1): pdf(0,0)->screen(0,600); pdf(800,0)->screen(800,600);
  // pdf(0,600)->screen(0,0); pdf(800,600)->screen(800,0); pdf(400,300)->screen(400,300).
  it('matches pdfjs-dist\'s own convertToViewportPoint for the four corners + center, at scale 1', () => {
    expect(pdfToScreen(geom, 1, { x: 0, y: 0 })).toEqual({ x: 0, y: 600 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 0 })).toEqual({ x: 800, y: 600 });
    expect(pdfToScreen(geom, 1, { x: 0, y: 600 })).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 600 })).toEqual({ x: 800, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('scales linearly with renderScale', () => {
    expect(pdfToScreen(geom, 2, { x: 400, y: 300 })).toEqual({ x: 800, y: 600 });
    expect(pdfToScreen(geom, 0.5, { x: 400, y: 300 })).toEqual({ x: 200, y: 150 });
  });

  it('renderedSize is width x height, unswapped', () => {
    expect(renderedSize(geom, 1)).toEqual({ width: 800, height: 600 });
    expect(renderedSize(geom, 2)).toEqual({ width: 1600, height: 1200 });
  });
});

describe('pdfToScreen — rotation 90 (verified against real pdfjs-dist)', () => {
  const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 90 };
  // Ground truth (scale=1): pdf(0,0)->screen(0,0); pdf(800,0)->screen(0,800);
  // pdf(0,600)->screen(600,0); pdf(800,600)->screen(600,800); pdf(400,300)->screen(300,400).
  it('matches pdfjs-dist\'s own convertToViewportPoint for the four corners + center, at scale 1', () => {
    expect(pdfToScreen(geom, 1, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 0 })).toEqual({ x: 0, y: 800 });
    expect(pdfToScreen(geom, 1, { x: 0, y: 600 })).toEqual({ x: 600, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 600 })).toEqual({ x: 600, y: 800 });
    expect(pdfToScreen(geom, 1, { x: 400, y: 300 })).toEqual({ x: 300, y: 400 });
  });

  it('renderedSize swaps width/height', () => {
    expect(renderedSize(geom, 1)).toEqual({ width: 600, height: 800 });
  });
});

describe('pdfToScreen — rotation 180 (verified against real pdfjs-dist)', () => {
  const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 180 };
  // Ground truth (scale=1): pdf(0,0)->screen(800,0); pdf(800,0)->screen(0,0);
  // pdf(0,600)->screen(800,600); pdf(800,600)->screen(0,600); pdf(400,300)->screen(400,300).
  it('matches pdfjs-dist\'s own convertToViewportPoint for the four corners + center, at scale 1', () => {
    expect(pdfToScreen(geom, 1, { x: 0, y: 0 })).toEqual({ x: 800, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 0, y: 600 })).toEqual({ x: 800, y: 600 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 600 })).toEqual({ x: 0, y: 600 });
    expect(pdfToScreen(geom, 1, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('renderedSize is width x height, unswapped', () => {
    expect(renderedSize(geom, 1)).toEqual({ width: 800, height: 600 });
  });
});

describe('pdfToScreen — rotation 270 (verified against real pdfjs-dist)', () => {
  const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 270 };
  // Ground truth (scale=1): pdf(0,0)->screen(600,800); pdf(800,0)->screen(600,0);
  // pdf(0,600)->screen(0,800); pdf(800,600)->screen(0,0); pdf(400,300)->screen(300,400).
  it('matches pdfjs-dist\'s own convertToViewportPoint for the four corners + center, at scale 1', () => {
    expect(pdfToScreen(geom, 1, { x: 0, y: 0 })).toEqual({ x: 600, y: 800 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 0 })).toEqual({ x: 600, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 0, y: 600 })).toEqual({ x: 0, y: 800 });
    expect(pdfToScreen(geom, 1, { x: 800, y: 600 })).toEqual({ x: 0, y: 0 });
    expect(pdfToScreen(geom, 1, { x: 400, y: 300 })).toEqual({ x: 300, y: 400 });
  });

  it('renderedSize swaps width/height', () => {
    expect(renderedSize(geom, 1)).toEqual({ width: 600, height: 800 });
  });
});

// Fix round 1 / S1 — the review's own hand-verified example: MediaBox
// [100 200 712 992] (width 612, height 792, origin (100, 200)), text at
// PDF-space (150, 250), at renderScale 2, for all four rotations. These
// numbers are quoted DIRECTLY from the review (docs/superpowers/plans/
// 2026-09-23-phase-b-review.md's S1 table) — not re-derived, so a
// regression here is a regression against the reviewer's own math, not
// just this session's.
describe('pdfToScreen — non-zero origin (S1, the review\'s own worked numbers)', () => {
  const geom0: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 0, originXPt: 100, originYPt: 200 };
  const geom90: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 90, originXPt: 100, originYPt: 200 };
  const geom180: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 180, originXPt: 100, originYPt: 200 };
  const geom270: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 270, originXPt: 100, originYPt: 200 };
  const p = { x: 150, y: 250 };

  it('rotation 0 -> (100, 1484)', () => {
    expect(pdfToScreen(geom0, 2, p)).toEqual({ x: 100, y: 1484 });
  });
  it('rotation 90 -> (100, 100)', () => {
    expect(pdfToScreen(geom90, 2, p)).toEqual({ x: 100, y: 100 });
  });
  it('rotation 180 -> (1124, 100)', () => {
    expect(pdfToScreen(geom180, 2, p)).toEqual({ x: 1124, y: 100 });
  });
  it('rotation 270 -> (1484, 1124)', () => {
    expect(pdfToScreen(geom270, 2, p)).toEqual({ x: 1484, y: 1124 });
  });

  it('omitting originXPt/originYPt is exactly equivalent to (0, 0) — every pre-migration est_sheets row', () => {
    const withZero: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 90, originXPt: 0, originYPt: 0 };
    const omitted: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 90 };
    expect(pdfToScreen(omitted, 2, p)).toEqual(pdfToScreen(withZero, 2, p));
  });

  it('screenToPdf round-trips through a non-zero origin at every rotation', () => {
    for (const geom of [geom0, geom90, geom180, geom270]) {
      const screen = pdfToScreen(geom, 1.7, p);
      const back = screenToPdf(geom, 1.7, screen);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('pdfToScreenMany applies the same origin correction to every point', () => {
    const many = pdfToScreenMany(geom0, 2, [p, { x: 200, y: 300 }]);
    expect(many[0]).toEqual({ x: 100, y: 1484 });
    expect(many[1]).toEqual(pdfToScreen(geom0, 2, { x: 200, y: 300 }));
  });
});

describe('screenToPdf — exact inverse of pdfToScreen at every rotation', () => {
  const cases: Array<[string, PageGeometry]> = [
    ['0', { widthPt: W, heightPt: H, rotation: 0 }],
    ['90', { widthPt: W, heightPt: H, rotation: 90 }],
    ['180', { widthPt: W, heightPt: H, rotation: 180 }],
    ['270', { widthPt: W, heightPt: H, rotation: 270 }],
  ];
  const probePoints = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 0, y: 600 }, { x: 800, y: 600 }, { x: 123.45, y: 67.89 }];

  for (const [label, geom] of cases) {
    it(`round-trips pdf -> screen -> pdf for rotation ${label}`, () => {
      for (const p of probePoints) {
        const screen = pdfToScreen(geom, 1.7, p); // an arbitrary non-integer renderScale
        const back = screenToPdf(geom, 1.7, screen);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    });

    it(`round-trips screen -> pdf -> screen for rotation ${label}`, () => {
      const screenPoints = [{ x: 0, y: 0 }, { x: 500, y: 300 }, { x: 999.9, y: 1.1 }];
      for (const s of screenPoints) {
        const pdf = screenToPdf(geom, 2.3, s);
        const back = pdfToScreen(geom, 2.3, pdf);
        expect(back.x).toBeCloseTo(s.x, 9);
        expect(back.y).toBeCloseTo(s.y, 9);
      }
    });
  }
});

describe('pdfToScreenMany', () => {
  it('applies the same transform as repeated pdfToScreen calls (used for a linear run\'s polyline)', () => {
    const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 90 };
    const points = [{ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 800, y: 600 }];
    const many = pdfToScreenMany(geom, 1.5, points);
    const individually = points.map(p => pdfToScreen(geom, 1.5, p));
    expect(many).toEqual(individually);
  });

  it('is [] for an empty input', () => {
    const geom: PageGeometry = { widthPt: W, heightPt: H, rotation: 0 };
    expect(pdfToScreenMany(geom, 1, [])).toEqual([]);
  });
});

describe('fitScale', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };

  it('"width" mode fits the container width exactly, ignoring height', () => {
    expect(fitScale(geom, 400, 100000, 'width')).toBeCloseTo(0.5, 10);
  });

  it('"page" mode fits whichever of width/height is the binding constraint', () => {
    // Width-bound: 400/800=0.5 vs height 300/600=0.5 — tied, either fine here.
    expect(fitScale(geom, 400, 300, 'page')).toBeCloseTo(0.5, 10);
    // Height-bound: width allows 2.0 (1600/800), height allows 0.5 (300/600) -> 0.5 wins.
    expect(fitScale(geom, 1600, 300, 'page')).toBeCloseTo(0.5, 10);
    // Width-bound: width allows 0.25 (200/800), height allows 1.0 (600/600) -> 0.25 wins.
    expect(fitScale(geom, 200, 600, 'page')).toBeCloseTo(0.25, 10);
  });

  it('accounts for rotation swapping the displayed dimensions', () => {
    const rotated: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 90 };
    // Displayed size is now 600 wide x 800 tall — fitting a 300-wide container: 300/600=0.5.
    expect(fitScale(rotated, 300, 100000, 'width')).toBeCloseTo(0.5, 10);
  });

  it('a higher dpr renders at a proportionally higher scale (sharper on HiDPI)', () => {
    expect(fitScale(geom, 400, 100000, 'width', 2)).toBeCloseTo(1.0, 10);
  });

  it('degenerate container dimensions (0 or negative) fall back to 1, never divide by zero into Infinity/NaN', () => {
    expect(fitScale(geom, 0, 300, 'width')).toBe(1);
    expect(fitScale(geom, 300, 0, 'page')).toBe(1);
    expect(fitScale(geom, -10, 300, 'width')).toBe(1);
  });

  it('a degenerate page geometry (0 extent) falls back to 1 rather than Infinity', () => {
    expect(fitScale({ widthPt: 0, heightPt: 600, rotation: 0 }, 400, 300, 'width')).toBe(1);
  });
});

describe('clampRenderScale', () => {
  const geom: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 0 };

  it('leaves a scale that stays under the area cap untouched', () => {
    // 800*2 x 600*2 = 1600x1200 = 1,920,000px, well under the cap.
    expect(clampRenderScale(geom, 2)).toBe(2);
  });

  it('clamps a scale that would exceed the area cap down to exactly the cap', () => {
    const huge = 100; // 80000 x 60000 = 4.8B px, way over
    const clamped = clampRenderScale(geom, huge);
    expect(clamped).toBeLessThan(huge);
    const { width, height } = renderedSize(geom, clamped);
    expect(width * height).toBeCloseTo(MAX_CANVAS_AREA_PX, -2); // within ~100px^2 of the cap
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_AREA_PX + 1);
  });

  it('never increases the requested scale', () => {
    for (const s of [0.1, 1, 5, 50, 500]) {
      expect(clampRenderScale(geom, s)).toBeLessThanOrEqual(s);
    }
  });

  it('is a no-op for a non-positive requested scale (never divides into NaN)', () => {
    expect(clampRenderScale(geom, 0)).toBe(0);
    expect(clampRenderScale(geom, -1)).toBe(-1);
  });

  it('applies the same clamp factor to a rotated (swapped-dimension) page', () => {
    const rotated: PageGeometry = { widthPt: 800, heightPt: 600, rotation: 90 };
    const clamped = clampRenderScale(rotated, 100);
    const { width, height } = renderedSize(rotated, clamped);
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_AREA_PX + 1);
  });
});

describe('rotation normalization', () => {
  it('treats a negative or >360 rotation the same as its 0-270 equivalent', () => {
    const base: PageGeometry = { widthPt: W, heightPt: H, rotation: 90 };
    const negative: PageGeometry = { widthPt: W, heightPt: H, rotation: -270 as never };
    const over: PageGeometry = { widthPt: W, heightPt: H, rotation: 450 as never };
    expect(pdfToScreen(negative, 1, { x: 400, y: 300 })).toEqual(pdfToScreen(base, 1, { x: 400, y: 300 }));
    expect(pdfToScreen(over, 1, { x: 400, y: 300 })).toEqual(pdfToScreen(base, 1, { x: 400, y: 300 }));
  });

  it('treats a non-axis-aligned rotation (e.g. 45) as 0 rather than crashing', () => {
    const skewed: PageGeometry = { widthPt: W, heightPt: H, rotation: 45 as never };
    const zero: PageGeometry = { widthPt: W, heightPt: H, rotation: 0 };
    expect(pdfToScreen(skewed, 1, { x: 400, y: 300 })).toEqual(pdfToScreen(zero, 1, { x: 400, y: 300 }));
  });
});
