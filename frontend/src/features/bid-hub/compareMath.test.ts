import { describe, it, expect } from 'vitest';
import { per1kSf, median, deltaVsMedian, isOutlier } from './compareMath';

describe('compareMath', () => {
  it('normalizes per 1000 sf', () => {
    expect(per1kSf(90, 3000)).toBeCloseTo(30);
    expect(per1kSf(90, 0)).toBeNull();
    expect(per1kSf(90, null)).toBeNull();
  });
  it('median handles even/odd/empty', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('delta vs median', () => {
    expect(deltaVsMedian(14, [10, 10, 10])).toBeCloseTo(0.4);
    expect(deltaVsMedian(null, [10])).toBeNull();
    expect(deltaVsMedian(14, [null, null])).toBeNull();
    expect(deltaVsMedian(14, [0])).toBeNull(); // zero median → no ratio
  });
  it('outlier at 35% default', () => {
    expect(isOutlier(0.4)).toBe(true);
    expect(isOutlier(-0.4)).toBe(true);
    expect(isOutlier(0.2)).toBe(false);
    expect(isOutlier(null)).toBe(false);
  });
});
