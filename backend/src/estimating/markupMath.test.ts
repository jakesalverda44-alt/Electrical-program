// Estimating Phase B, Task 3 — exhaustive pure tests for markupMath.ts's
// geometry and per-line rollup formulas, per the plan's explicit list:
// every formula, rotation-agnostic, zero-length, missing scale -> error.
import { describe, it, expect } from 'vitest';
import { polylineLengthPt, computeRunLengthFt, MissingScaleError, rollupLines, RollupMarkupInput, RollupLineInput } from './markupMath';

describe('polylineLengthPt', () => {
  it('is 0 for an empty or single-point polyline', () => {
    expect(polylineLengthPt([])).toBe(0);
    expect(polylineLengthPt([{ x: 10, y: 10 }])).toBe(0);
  });

  it('sums a straight two-point segment (3-4-5 triangle)', () => {
    expect(polylineLengthPt([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBeCloseTo(5, 10);
  });

  it('sums a multi-segment polyline', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(polylineLengthPt(pts)).toBeCloseTo(30, 10);
  });

  it('is rotation-agnostic: the same real-world run rotated 90deg in point-space has the same length', () => {
    const original = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
    // A 90deg rotation about the origin: (x,y) -> (-y, x).
    const rotated = original.map(p => ({ x: -p.y, y: p.x }));
    expect(polylineLengthPt(rotated)).toBeCloseTo(polylineLengthPt(original), 10);
  });

  it('handles negative coordinates the same as positive ones', () => {
    expect(polylineLengthPt([{ x: -3, y: -4 }, { x: 0, y: 0 }])).toBeCloseTo(5, 10);
  });
});

describe('computeRunLengthFt', () => {
  const base = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], drops: 0, dropFt: 0, slackPct: 0 };

  it('feet = polyline length (points) x ftPerPt, with no drops/slack', () => {
    const ft = computeRunLengthFt({ ...base, ftPerPt: 0.1 }); // 100pt * 0.1 ft/pt = 10ft
    expect(ft).toBeCloseTo(10, 10);
  });

  it('adds drops x drop_ft before slack', () => {
    // 10ft run + 2 drops * 8ft = 26ft, then no slack.
    const ft = computeRunLengthFt({ ...base, ftPerPt: 0.1, drops: 2, dropFt: 8 });
    expect(ft).toBeCloseTo(26, 10);
  });

  it('applies slack pct AFTER drops, not before', () => {
    // 10ft run + 2 drops * 8ft = 26ft, then +10% slack = 28.6ft.
    const withSlack = computeRunLengthFt({ ...base, ftPerPt: 0.1, drops: 2, dropFt: 8, slackPct: 10 });
    expect(withSlack).toBeCloseTo(28.6, 10);
    // Proves order: applying 10% slack to the run BEFORE adding drops would
    // give (10*1.1) + 16 = 27, a different (wrong) number.
    expect(withSlack).not.toBeCloseTo(27, 6);
  });

  it('the plan\'s own defaults (10ft drop, 10% slack) compute correctly', () => {
    // 50ft measured run, 1 drop, defaults.
    const ft = computeRunLengthFt({ points: [{ x: 0, y: 0 }, { x: 500, y: 0 }], ftPerPt: 0.1, drops: 1, dropFt: 10, slackPct: 10 });
    // (50 + 10) * 1.1 = 66
    expect(ft).toBeCloseTo(66, 10);
  });

  it('is 0 for a zero-length polyline (a single point, or two identical points) with no drops', () => {
    expect(computeRunLengthFt({ points: [{ x: 5, y: 5 }], ftPerPt: 0.1, drops: 0, dropFt: 0, slackPct: 0 })).toBe(0);
    expect(computeRunLengthFt({ points: [{ x: 5, y: 5 }, { x: 5, y: 5 }], ftPerPt: 0.1, drops: 0, dropFt: 0, slackPct: 0 })).toBe(0);
  });

  it('a zero-length polyline still adds drops (a straight vertical riser with no plan-view run)', () => {
    const ft = computeRunLengthFt({ points: [{ x: 5, y: 5 }], ftPerPt: 0.1, drops: 1, dropFt: 10, slackPct: 0 });
    expect(ft).toBeCloseTo(10, 10);
  });

  it('throws MissingScaleError when ftPerPt is null, undefined, zero, or negative', () => {
    expect(() => computeRunLengthFt({ ...base, ftPerPt: null })).toThrow(MissingScaleError);
    expect(() => computeRunLengthFt({ ...base, ftPerPt: undefined })).toThrow(MissingScaleError);
    expect(() => computeRunLengthFt({ ...base, ftPerPt: 0 })).toThrow(MissingScaleError);
    expect(() => computeRunLengthFt({ ...base, ftPerPt: -0.1 })).toThrow(MissingScaleError);
  });

  it('throws MissingScaleError rather than returning NaN for a non-finite ftPerPt', () => {
    expect(() => computeRunLengthFt({ ...base, ftPerPt: NaN })).toThrow(MissingScaleError);
    expect(() => computeRunLengthFt({ ...base, ftPerPt: Infinity })).toThrow(MissingScaleError);
  });

  it('tolerates a negative/non-finite drops or slack input by treating it as 0, never NaN', () => {
    const ft = computeRunLengthFt({ ...base, ftPerPt: 0.1, drops: -5, dropFt: NaN, slackPct: NaN });
    expect(ft).toBeCloseTo(10, 10); // same as the no-drops/no-slack case
  });
});

describe('rollupLines — count markups (EA-family lines)', () => {
  function markup(over: Partial<RollupMarkupInput>): RollupMarkupInput {
    return {
      id: 'm1', documentId: 'doc-1', pageIndex: 0, lineKey: 'line-1', kind: 'count',
      status: 'confirmed', points: [{ x: 10, y: 10 }], drops: 0, dropFt: 0, slackPct: 0,
      ...over,
    };
  }
  const line: RollupLineInput = { lineKey: 'line-1', unit: 'EA' };
  const noScale = () => null;

  it('each confirmed count marker on the line contributes 1 EA', () => {
    const result = rollupLines([line], [
      markup({ id: 'm1' }), markup({ id: 'm2' }), markup({ id: 'm3' }),
    ], noScale);
    expect(result[0].markedQty).toBe(3);
    expect(result[0].markerCount).toBe(3);
  });

  it('a suggested marker never counts toward markedQty', () => {
    const result = rollupLines([line], [
      markup({ id: 'm1', status: 'confirmed' }),
      markup({ id: 'm2', status: 'suggested' }),
      markup({ id: 'm3', status: 'suggested' }),
    ], noScale);
    expect(result[0].markedQty).toBe(1);
    expect(result[0].markerCount).toBe(1);
  });

  it('an unassigned marker (lineKey null) never rolls into any line', () => {
    const result = rollupLines([line], [markup({ id: 'm1', lineKey: null })], noScale);
    expect(result[0].markedQty).toBeNull();
    expect(result[0].markerCount).toBe(0);
  });

  it('markedQty is null (not 0) for a line with no confirmed, compatible markups at all', () => {
    const result = rollupLines([line], [], noScale);
    expect(result[0].markedQty).toBeNull();
  });

  it('a linear markup assigned to an EA line is excluded and counted as incompatible, never coerced into a count', () => {
    const result = rollupLines([line], [
      markup({ id: 'm1', kind: 'count' }),
      markup({ id: 'm2', kind: 'linear', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }),
    ], noScale);
    expect(result[0].markedQty).toBe(1);
    expect(result[0].incompatibleCount).toBe(1);
  });

  it('groups sheet contributions by (documentId, pageIndex)', () => {
    const result = rollupLines([line], [
      markup({ id: 'm1', documentId: 'doc-1', pageIndex: 0 }),
      markup({ id: 'm2', documentId: 'doc-1', pageIndex: 0 }),
      markup({ id: 'm3', documentId: 'doc-1', pageIndex: 1 }),
      markup({ id: 'm4', documentId: 'doc-2', pageIndex: 0 }),
    ], noScale);
    const sheets = result[0].sheets.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.pageIndex - b.pageIndex);
    expect(sheets).toEqual([
      { documentId: 'doc-1', pageIndex: 0, markerCount: 2 },
      { documentId: 'doc-1', pageIndex: 1, markerCount: 1 },
      { documentId: 'doc-2', pageIndex: 0, markerCount: 1 },
    ]);
  });
});

describe('rollupLines — linear markups (LF/C/M-family lines)', () => {
  function linearMarkup(over: Partial<RollupMarkupInput>): RollupMarkupInput {
    return {
      id: 'm1', documentId: 'doc-1', pageIndex: 0, lineKey: 'line-1', kind: 'linear',
      status: 'confirmed', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], drops: 0, dropFt: 0, slackPct: 0,
      ...over,
    };
  }
  const scaleOf = (ftPerPt: number) => () => ftPerPt;

  it('sums multiple confirmed linear runs into feet for an LF line', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LF' };
    const result = rollupLines([line], [
      linearMarkup({ id: 'm1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }), // 100pt
      linearMarkup({ id: 'm2', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }),  // 50pt
    ], scaleOf(0.1)); // 0.1 ft/pt
    expect(result[0].markedQty).toBeCloseTo(15, 10); // (100+50)pt * 0.1 = 15ft
    expect(result[0].markerCount).toBe(2);
  });

  it('converts feet into the line\'s own display unit — C (per-100) and M (per-1000)', () => {
    const runFt = 1200; // pick a round number: 1200pt at 1 ft/pt = 1200ft
    const points = [{ x: 0, y: 0 }, { x: runFt, y: 0 }];
    const cLine: RollupLineInput = { lineKey: 'line-c', unit: 'C' };
    const mLine: RollupLineInput = { lineKey: 'line-m', unit: 'M' };
    const lfLine: RollupLineInput = { lineKey: 'line-lf', unit: 'LF' };
    const markups = [linearMarkup({ lineKey: 'line-c', points }), linearMarkup({ id: 'm2', lineKey: 'line-m', points }), linearMarkup({ id: 'm3', lineKey: 'line-lf', points })];
    const result = rollupLines([cLine, mLine, lfLine], markups, scaleOf(1));
    const byKey = new Map(result.map(r => [r.lineKey, r]));
    expect(byKey.get('line-lf')!.markedQty).toBeCloseTo(1200, 6); // raw feet
    expect(byKey.get('line-c')!.markedQty).toBeCloseTo(12, 6);   // 1200 / 100
    expect(byKey.get('line-m')!.markedQty).toBeCloseTo(1.2, 6);  // 1200 / 1000
  });

  it('a count markup assigned to a linear line is excluded and counted as incompatible', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LF' };
    const result = rollupLines([line], [
      linearMarkup({ id: 'm1' }),
      { id: 'm2', documentId: 'doc-1', pageIndex: 0, lineKey: 'line-1', kind: 'count', status: 'confirmed', points: [{ x: 1, y: 1 }], drops: 0, dropFt: 0, slackPct: 0 },
    ], scaleOf(0.1));
    expect(result[0].incompatibleCount).toBe(1);
    expect(result[0].markedQty).toBeCloseTo(10, 10); // only the linear one counted
  });

  it('a confirmed linear markup on a sheet with no scale is excluded from markedQty and reported as missingScaleCount, without blowing up the whole rollup', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LF' };
    const result = rollupLines([line], [
      linearMarkup({ id: 'm1', documentId: 'doc-scaled', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }),
      linearMarkup({ id: 'm2', documentId: 'doc-unscaled', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }),
    ], (documentId) => (documentId === 'doc-scaled' ? 0.1 : null));
    expect(result[0].markedQty).toBeCloseTo(10, 10); // only doc-scaled's run
    expect(result[0].missingScaleCount).toBe(1);
    expect(result[0].markerCount).toBe(1);
  });

  it('a zero-length linear run (two identical points, no drops) contributes 0 feet, not null', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LF' };
    const result = rollupLines([line], [
      linearMarkup({ points: [{ x: 10, y: 10 }, { x: 10, y: 10 }] }),
    ], scaleOf(0.1));
    expect(result[0].markedQty).toBe(0);
    expect(result[0].markerCount).toBe(1);
  });

  it('a line with an unrecognized/OTHER unit never accepts any markup', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LS' as never };
    const result = rollupLines([line], [linearMarkup({})], scaleOf(0.1));
    expect(result[0].markedQty).toBeNull();
    expect(result[0].incompatibleCount).toBe(1);
  });

  it('suggested linear markups never count', () => {
    const line: RollupLineInput = { lineKey: 'line-1', unit: 'LF' };
    const result = rollupLines([line], [linearMarkup({ status: 'suggested' })], scaleOf(0.1));
    expect(result[0].markedQty).toBeNull();
  });
});
