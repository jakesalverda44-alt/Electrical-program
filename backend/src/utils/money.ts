// Parse a free-text money field (e.g. a proposal price the estimator typed by
// hand) into a finite, positive number safe to write into a NUMERIC(12,2) column.
//
// Strips a leading currency symbol, commas, and whitespace. Returns null — never
// throws — for anything that isn't a finite number greater than zero, so callers
// can turn a bad price into a clean 400 instead of a DB write crashing after a
// paid AI call.
export function parseMoney(input: string): number | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
