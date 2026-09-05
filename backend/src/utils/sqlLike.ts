// Post-review hardening (5b, audit batch 3) — shared by every route that
// builds an ILIKE pattern from user input (documents, leads) or accepts an
// opt-in ?limit=N.

/**
 * Escapes literal `%` and `_` (ILIKE's own wildcard characters) in free-text
 * search input before it's wrapped in `%...%` and bound as a query
 * parameter. Not an injection concern (the value is always parameterized,
 * never concatenated into SQL) — this is about correctness: a search for a
 * GC literally named "50% Electric" or "Житомир_1" should match that literal
 * text, not have `%`/`_` behave as wildcards the searcher never typed.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, ch => `\\${ch}`);
}

/**
 * Parses an opt-in `?limit=` query param, clamping to [1, max]. Returns
 * undefined when absent or not a positive integer, so the caller's existing
 * "omit LIMIT entirely" behavior for every list endpoint is unchanged —
 * this only caps an explicit limit a caller actually asked for.
 */
export function clampLimit(raw: string | undefined, max = 200): number | undefined {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}
