// Estimating Phase B, Task 9 (deferral closed) — exhaustive tests for
// regionRender.ts, including rotated pages (90/180/270) per the
// coordinator's standing instruction for every pure module in this feature.
import { describe, it, expect } from 'vitest';
import { needsTiledRender, planTileRender, tilePlansRoughlyEqual, TileRenderPlan } from './regionRender';
import { clampRenderScale, PageGeometry } from './overlay';

// A 36x48in D-size sheet, in points (72pt/in): 2592 x 3456pt — the
// coordinator's own example of a sheet that blows the canvas-area cap well
// before an estimator's real working zoom.
const D_SIZE: PageGeometry = { widthPt: 2592, heightPt: 3456, rotation: 0 };

describe('needsTiledRender', () => {
  it('is false when the clamped scale equals the target (well under the cap)', () => {
    expect(needsTiledRender(1, 1)).toBe(false);
  });

  it('is true when clampRenderScale actually reduced the scale', () => {
    const target = 3; // 300% zoom
    const clamped = clampRenderScale(D_SIZE, target);
    expect(clamped).toBeLessThan(target); // sanity: this scale really does exceed the cap
    expect(needsTiledRender(target, clamped)).toBe(true);
  });

  it('is false at a target scale the D-size sheet does not exceed the cap at', () => {
    const target = 0.3; // sheet fits comfortably
    const clamped = clampRenderScale(D_SIZE, target);
    expect(clamped).toBe(target);
    expect(needsTiledRender(target, clamped)).toBe(false);
  });

  it('tolerates an equal-but-not-identical floating point pair without false-triggering', () => {
    expect(needsTiledRender(1.0000000001, 1)).toBe(false);
  });
});

describe('planTileRender — basic geometry, unrotated', () => {
  const geom: PageGeometry = { widthPt: 1000, heightPt: 800, rotation: 0 };
  const scale = 2; // full page render-space: 2000x1600

  it('a visible rect entirely inside the page, no margin, is used as-is', () => {
    const plan = planTileRender(geom, scale, { left: 100, top: 100, width: 300, height: 200 });
    expect(plan).toEqual({ width: 300, height: 200, left: 100, top: 100, transform: [1, 0, 0, 1, -100, -100] });
  });

  it('margin expands the tile symmetrically when it stays within page bounds', () => {
    const plan = planTileRender(geom, scale, { left: 500, top: 500, width: 200, height: 200 }, 50);
    expect(plan.left).toBe(450);
    expect(plan.top).toBe(450);
    expect(plan.width).toBe(300); // 200 + 50 + 50
    expect(plan.height).toBe(300);
    expect(plan.transform).toEqual([1, 0, 0, 1, -450, -450]);
  });

  it('clamps the left/top edge at 0 rather than going negative', () => {
    const plan = planTileRender(geom, scale, { left: 10, top: 10, width: 100, height: 100 }, 50);
    expect(plan.left).toBe(0);
    expect(plan.top).toBe(0);
    // right edge is 10+100+50=160, so clamped width is 160-0=160.
    expect(plan.width).toBe(160);
    expect(plan.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('clamps the right/bottom edge at the full page render-space size, not past it', () => {
    // Full page at scale 2 is 2000x1600. A rect near the bottom-right corner
    // with a big margin must not extend past those bounds.
    const plan = planTileRender(geom, scale, { left: 1900, top: 1500, width: 50, height: 50 }, 200);
    expect(plan.left + plan.width).toBe(2000);
    expect(plan.top + plan.height).toBe(1600);
  });

  it('a visible rect that is the WHOLE page (small page, big viewport) clamps to exactly the full page', () => {
    const plan = planTileRender(geom, scale, { left: -500, top: -500, width: 3000, height: 3000 });
    expect(plan).toEqual({ width: 2000, height: 1600, left: 0, top: 0, transform: [1, 0, 0, 1, 0, 0] });
  });

  it('never produces a non-positive width/height even for a degenerate (zero-size) visible rect', () => {
    const plan = planTileRender(geom, scale, { left: 100, top: 100, width: 0, height: 0 });
    expect(plan.width).toBeGreaterThanOrEqual(1);
    expect(plan.height).toBeGreaterThanOrEqual(1);
  });

  it('never produces a non-positive width/height for a visible rect entirely outside the page', () => {
    const plan = planTileRender(geom, scale, { left: 5000, top: 5000, width: 100, height: 100 });
    expect(plan.width).toBeGreaterThanOrEqual(1);
    expect(plan.height).toBeGreaterThanOrEqual(1);
  });

  it('the transform is always a pure translation by -left,-top (never touches scale/rotation)', () => {
    const plan = planTileRender(geom, scale, { left: 321, top: 654, width: 111, height: 222 });
    expect(plan.transform).toEqual([1, 0, 0, 1, -plan.left, -plan.top]);
  });
});

describe('planTileRender — rotated pages', () => {
  // 1000x800pt page. At rotation 90/270 the DISPLAYED (render-space) size
  // swaps to 800x1000 at scale 1 (renderedSize's own contract, already
  // exhaustively verified in overlay.test.ts) — planTileRender must clamp
  // against THAT swapped size, not the raw unrotated widthPt/heightPt.
  const base = { widthPt: 1000, heightPt: 800 };
  const scale = 1;

  it('rotation 90: clamps against the SWAPPED full render-space size (800 wide x 1000 tall)', () => {
    const geom: PageGeometry = { ...base, rotation: 90 };
    const plan = planTileRender(geom, scale, { left: -100, top: -100, width: 2000, height: 2000 });
    expect(plan).toEqual({ width: 800, height: 1000, left: 0, top: 0, transform: [1, 0, 0, 1, 0, 0] });
  });

  it('rotation 270: same swapped-size clamping as 90', () => {
    const geom: PageGeometry = { ...base, rotation: 270 };
    const plan = planTileRender(geom, scale, { left: -100, top: -100, width: 2000, height: 2000 });
    expect(plan).toEqual({ width: 800, height: 1000, left: 0, top: 0, transform: [1, 0, 0, 1, 0, 0] });
  });

  it('rotation 180: full render-space size is UNSWAPPED (same as 0), still clamps correctly', () => {
    const geom: PageGeometry = { ...base, rotation: 180 };
    const plan = planTileRender(geom, scale, { left: -100, top: -100, width: 2000, height: 2000 });
    expect(plan).toEqual({ width: 1000, height: 800, left: 0, top: 0, transform: [1, 0, 0, 1, 0, 0] });
  });

  it('a mid-page tile at rotation 90 is positioned/sized identically to the same numeric rect at rotation 0 (region math itself does not re-derive rotation — it trusts renderedSize)', () => {
    const geom0: PageGeometry = { ...base, rotation: 0 };
    const geom90: PageGeometry = { ...base, rotation: 90 };
    const rect = { left: 100, top: 100, width: 200, height: 200 };
    // At rotation 0, full size is 1000x800 — the rect fits with no clamping.
    const plan0 = planTileRender(geom0, scale, rect);
    // At rotation 90, full size is 800x1000 — the SAME numeric rect ALSO
    // fits with no clamping (200+100=300 is within both 800 and 1000).
    const plan90 = planTileRender(geom90, scale, rect);
    expect(plan0).toEqual(plan90);
  });

  it('a tile that only fits inside the SWAPPED dimension is clamped differently between 0 and 90', () => {
    // At rotation 0 (1000 wide x 800 tall), x=900 with width=300 -> clamps
    // at x=1000 (right edge), width=100. At rotation 90 (800 wide x 1000
    // tall), the SAME rect's x=900 already exceeds the 800-wide bound
    // entirely, clamping to a 1px-minimum sliver at the right edge.
    const rect = { left: 900, top: 10, width: 300, height: 10 };
    const geom0: PageGeometry = { ...base, rotation: 0 };
    const geom90: PageGeometry = { ...base, rotation: 90 };
    const plan0 = planTileRender(geom0, scale, rect);
    const plan90 = planTileRender(geom90, scale, rect);
    expect(plan0.left + plan0.width).toBe(1000);
    expect(plan90.left).toBe(800); // clamped at the swapped-width edge
    expect(plan90.width).toBe(1); // degenerate — the rect starts past the rotated page's right edge
  });

  it('needsTiledRender/planTileRender compose correctly for the D-size sheet example at every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const geom: PageGeometry = { widthPt: 2592, heightPt: 3456, rotation };
      const target = 3;
      const clamped = clampRenderScale(geom, target);
      expect(needsTiledRender(target, clamped)).toBe(true);
      const plan = planTileRender(geom, target, { left: 0, top: 0, width: 900, height: 700 });
      expect(plan.width).toBeGreaterThan(0);
      expect(plan.height).toBeGreaterThan(0);
    }
  });
});

describe('tilePlansRoughlyEqual', () => {
  const base: TileRenderPlan = { width: 400, height: 400, left: 100, top: 100, transform: [1, 0, 0, 1, -100, -100] };

  it('is true for identical plans', () => {
    expect(tilePlansRoughlyEqual(base, { ...base })).toBe(true);
  });

  it('is true for a small pan within tolerance (default: a quarter of the tile size)', () => {
    const moved = { ...base, left: base.left + 50, top: base.top + 50 }; // 50 < 400/4=100
    expect(tilePlansRoughlyEqual(base, moved)).toBe(true);
  });

  it('is false once the pan exceeds the tolerance', () => {
    const moved = { ...base, left: base.left + 150, top: base.top }; // 150 > 100
    expect(tilePlansRoughlyEqual(base, moved)).toBe(false);
  });

  it('an explicit tolerance overrides the default', () => {
    const moved = { ...base, left: base.left + 5 };
    expect(tilePlansRoughlyEqual(base, moved, 1)).toBe(false);
    expect(tilePlansRoughlyEqual(base, moved, 10)).toBe(true);
  });

  it('a size change (zoom) outside tolerance is also detected, not just position', () => {
    const resized = { ...base, width: base.width + 200 };
    expect(tilePlansRoughlyEqual(base, resized)).toBe(false);
  });
});
