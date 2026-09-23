// Estimating Phase B, Task 5 — parses the Scale tool's two-point
// calibration "known length" input: `12'6"`, `12.5`, `150'`, etc. Pure.
const FT_IN_RE = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?\s*$/;
const BARE_FEET_RE = /^(\d+(?:\.\d+)?)\s*'?\s*$/;
const INCHES_ONLY_RE = /^(\d+(?:\.\d+)?)\s*"$/;

function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”ʺ]/g, '"');
}

/** Parses a known-length input into feet. Accepts:
 *  - `12'6"` / `12'-6"` / `12' 6"` — feet-and-inches.
 *  - `12'` — bare feet with the mark.
 *  - `12.5` — a bare decimal number, assumed feet.
 *  - `6"` — bare inches.
 *  Returns null for empty, zero, negative, or unparseable input — the
 *  caller (the Scale tool's calibration popover) treats null as "not a
 *  valid length yet", never as a length of 0. */
export function parseFeetInches(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = normalizeQuotes(raw).trim();
  if (!s) return null;

  const ftIn = FT_IN_RE.exec(s);
  if (ftIn) {
    const feet = Number(ftIn[1]);
    const inches = ftIn[2] ? Number(ftIn[2]) : 0;
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    const total = feet + inches / 12;
    return total > 0 ? total : null;
  }

  const inchesOnly = INCHES_ONLY_RE.exec(s);
  if (inchesOnly) {
    const inches = Number(inchesOnly[1]);
    if (!Number.isFinite(inches) || inches <= 0) return null;
    return inches / 12;
  }

  const bare = BARE_FEET_RE.exec(s);
  if (bare) {
    const feet = Number(bare[1]);
    return Number.isFinite(feet) && feet > 0 ? feet : null;
  }

  return null;
}

/** Formats a feet value back into `N'-N"` for display next to a calibrated
 *  or entered length. Rounds to the nearest whole inch. */
export function formatFeetInches(totalFeet: number): string {
  if (!Number.isFinite(totalFeet) || totalFeet < 0) return '';
  const totalInches = Math.round(totalFeet * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'-${inches}"`;
}
