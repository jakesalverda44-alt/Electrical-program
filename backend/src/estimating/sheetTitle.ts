// UI round 1 — pure helpers that decide whether a text fragment pulled from a
// plan page's title-block strip is a real sheet title or junk (a bid-service
// stamp, a date, a wrapped note fragment, a broken-font garble). No imports
// from services: sheets.ts pulls this in and must stay light.

/** Bid-service / plan-room stamps printed on every page (never a sheet title). */
export const BID_STAMP_RE = /\b(dodge\s+data|dodge\s*&?\s*analytics|construct\s*connect|building\s*connected|isqft|plan\s*hub|bid\s*clerk|blue\s*book|plan\s*room|for\s+bidding\s*(&|and)\s*contract|for\s+bidding\s+(purposes|only)|not\s+for\s+construction|downloaded\s+(from|by|on)|printed\s+(by|on))/i;
const DATE_ONLY_RE = /^\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\s*$/i;
const NOTE_FRAGMENT_RE = /\b(must|shall|should|will\s+be|be\s+verified|verif(y|ied|ie)|signature|signed|sealed|copyright|reproduc|unauthori[sz]ed|this\s+(item|document|drawing)\s+has\s+been)\b/i;

/** Small word list: title-block vocabulary + common English function words.
 *  Used ONLY by the garble check. */
export const TITLE_WORDS = new Set(
  ('plan plans power lighting light electrical site floor roof ceiling reflected general notes note schedule schedules panel panels '
  + 'riser diagram diagrams one line single details detail legend symbols symbol abbreviations cover sheet index title specifications spec '
  + 'fire alarm mechanical plumbing architectural structural civil demolition demo photometric photometrics enlarged elevation elevations '
  + 'section sections level first second third ground building existing new partial overall layout systems system communications data low '
  + 'voltage security equipment kitchen canopy fuel parking grading utility and of the for with to on in at by is are be this his her has '
  + 'have been item items all see from not').split(/\s+/),
);

/** Shifts every a-z letter by `by` (negative allowed), wrapping. Non-letters are left as they are. */
export function caesarShift(word: string, by: number): string {
  const n = ((by % 26) + 26) % 26;
  return word.replace(/[a-z]/g, c => String.fromCharCode(((c.charCodeAt(0) - 97 + n) % 26) + 97));
}

const hits = (tokens: string[]) => tokens.filter(t => TITLE_WORDS.has(t)).length;

/** A broken-ToUnicode font prints "This item has been" as "5IJT JUFN IBT CFFO":
 *  no token is a known word, but a simple letter shift makes at least two of
 *  them known words. */
export function isGarbledText(raw: string): boolean {
  const tokens = raw.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  if (tokens.length < 2 || hits(tokens) !== 0) return false;
  for (let s = 1; s <= 25; s++) {
    if (hits(tokens.map(t => caesarShift(t, s))) >= 2) return true;
  }
  return false;
}

export function isJunkTitle(raw: string | null | undefined): boolean {
  const t = (raw ?? '').trim();
  if (!t) return true;
  if (BID_STAMP_RE.test(t) || DATE_ONLY_RE.test(t)) return true;
  if (!/[a-z]/i.test(t)) return true;
  // A title block is Title Case or CAPS; "coverings" is a wrapped note fragment.
  if (/^[a-z]/.test(t)) return true;
  if (NOTE_FRAGMENT_RE.test(t)) return true;
  if (t.length > 70) return true;
  if (t.endsWith('.') && t.split(/\s+/).length >= 5) return true;
  return isGarbledText(t);
}

/** The trimmed title with whitespace collapsed, or null when it is junk. */
export function cleanSheetTitle(raw: string | null | undefined): string | null {
  if (isJunkTitle(raw)) return null;
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}
