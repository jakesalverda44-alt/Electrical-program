// Pure math helpers for the Compare tab's normalization + outlier flagging.
// Kept dependency-free and side-effect-free so they're trivially unit-tested.

/** Normalize a raw total to a per-1,000-square-foot figure. Null when sqFt is missing or zero. */
export function per1kSf(value: number, sqFt: number | null): number | null {
  if (!sqFt) return null;
  return (value / sqFt) * 1000;
}

/** Median of a numeric array. Null for an empty array. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Delta of the subject value vs the median of the comps, as a fraction
 * (+0.4 = subject is 40% over the comp median). Null when the subject is
 * missing, there are no usable comps, or the comp median is zero (no ratio
 * is meaningful against a zero baseline).
 */
export function deltaVsMedian(subject: number | null, comps: Array<number | null>): number | null {
  if (subject === null) return null;
  const m = median(comps.filter((c): c is number => c !== null));
  if (m === null || m === 0) return null;
  return (subject - m) / m;
}

/** True when a delta's magnitude exceeds the outlier threshold (default 35%). */
export function isOutlier(delta: number | null, threshold = 0.35): boolean {
  if (delta === null) return false;
  return Math.abs(delta) > threshold;
}
