// Single source of truth for date formatting across the app (audit ux #8).
//
// Before this, at least 7 places each defined their own local `fmtDate`, and
// 4 defined their own local `dayOf` — some showed the year ("Sep 3, 2026"),
// some didn't ("Sep 3"), with no shared rule for which. The same due date
// could read differently on two screens two clicks apart for no reason.

export type YearMode = 'auto' | 'always' | 'never';

// A Postgres DATE column (won_jobs.date_won, leads.follow_up_date, etc.)
// serializes over the API as UTC midnight for that calendar day, e.g.
// "2026-06-11T00:00:00.000Z" — not as a bare "2026-06-11". Parsed as a real
// instant, that is June 11 00:00 UTC, which is June 10 20:00 in New York:
// a genuine calendar-day value renders one day early in any negative-UTC
// timezone (all of the US). A real TIMESTAMPTZ with a non-midnight time (or
// a non-Z offset) is a real instant and must NOT be re-anchored this way.
const DATE_COLUMN_MIDNIGHT_UTC = /^\d{4}-\d{2}-\d{2}T00:00(:00)?(\.\d+)?Z$/;

/**
 * Parses an ISO date/timestamp as a real calendar day.
 *
 * A bare `'YYYY-MM-DD'` (or anything 10 characters or shorter), or a
 * timestamp that is exactly UTC midnight for that day (the shape a DATE
 * column round-trips as), is parsed as *local* midnight — `new
 * Date('2026-09-10')` alone is UTC midnight, which renders as the previous
 * day in any negative-UTC-offset timezone (all of the US). Any other full
 * timestamp (a real time, or a non-Z offset) is left as-is and parsed
 * normally, so it still converts to the correct local calendar day instead
 * of being truncated to whatever date the raw UTC digits show.
 */
export function dayOf(iso: string): Date {
  const s = String(iso);
  const isDateOnly = s.length <= 10 || DATE_COLUMN_MIDNIGHT_UTC.test(s);
  return new Date(isDateOnly ? `${s.slice(0, 10)}T00:00:00` : s);
}

export interface FmtDateOptions {
  /**
   * 'auto' (default): show the year only when it differs from the current
   * year. 'always' / 'never' pin it either way, for screens that always
   * compare dates across years (documents list) or never do (a hub's
   * this-year timeline).
   */
  year?: YearMode;
}

/** The one date formatter. Returns `''` for a missing/empty value. */
export function fmtDate(iso: string | null | undefined, opts: FmtDateOptions = {}): string {
  if (!iso) return '';
  const d = dayOf(iso);
  const mode = opts.year ?? 'auto';
  const showYear = mode === 'always' || (mode === 'auto' && d.getFullYear() !== new Date().getFullYear());
  return d.toLocaleDateString('en-US', showYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' });
}

/** Date + time, for activity timelines and lifecycle steps. Returns `''` for
 *  a missing/empty value. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  // `dayOf` (not `new Date`) so a DATE-column value passed here by mistake
  // still renders its real calendar day instead of the previous day at a
  // meaningless local time — a no-op for genuine timestamps, which `dayOf`
  // already leaves untouched.
  return dayOf(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
