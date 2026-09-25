// Shared due-date helpers. Previously duplicated in routes/bids.ts and routes/dashboard.ts.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a "Mon D" / "Mon DD" due string into the number of days from today. */
export function parseDueDays(str: string): number {
  const m = /([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/.exec(str || '');
  if (!m) return 14;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mo === undefined) return 14;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(today.getFullYear(), mo, parseInt(m[2]));
  if (d < today) d = new Date(today.getFullYear() + 1, mo, parseInt(m[2]));
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Attach a computed `due_days` field to a bid row. */
export function withDueDays(row: Record<string, unknown>) {
  return { ...row, ...(row.plan_date !== undefined ? { plan_date: isoDate(row.plan_date) } : {}), due_days: parseDueDays(String(row.due || '')) };
}

/** A DATE column as "YYYY-MM-DD" (job profile fix round B3): node-postgres
 *  parses DATE to a local-midnight JS Date, which JSON-serializes as a UTC
 *  timestamp ("2025-09-22T04:00:00.000Z") and can shift a day west of UTC.
 *  The local calendar parts are the stored date. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** Accept ISO "YYYY-MM-DD" from a date picker OR legacy "Mon D" text → store as "Mon D". */
export function formatDue(raw: string | undefined): string {
  if (!raw?.trim()) return 'TBD';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
  if (iso) {
    const [, m, d] = raw.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m) - 1]} ${parseInt(d)}`;
  }
  return raw.trim();
}
