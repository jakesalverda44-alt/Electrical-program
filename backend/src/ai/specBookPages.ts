// Plans-panel fix round, B1 fix (review eb39943) — the classifier's own
// discipline enum never changes for the "spec book vs. plan sheet" summary
// (a "spec" discipline was tried and reverted: it took pages out of
// analysis with nothing but the prompt guarding it — see the review).
// Instead, a page's membership in a bound spec book / project manual is a
// separate, DETERMINISTIC annotation computed from the text layer alone,
// used ONLY by the sheet check's summary line (jobProfileRun.ts's
// sheetSummaryOf). It is never read by applySelection, /analyze's own page
// selection, or the classifier cache — a page's discipline and role are
// byte-identical to what main already produces.
//
// Absolute guard: a page the classifier found a real sheet number on is
// NEVER a spec-book page, regardless of its text — an "E-0.1 ELECTRICAL
// SPECIFICATIONS" sheet, or a Division 26 notes page printed WITH a sheet
// number, stays a plan sheet, in analysis exactly as before.
import { normalizeSheetId } from './sheetRefs';

/** Dense running text (not a title-block label) whose numbering reads like
 *  a specifications section, not a drawing: "SECTION 26 05 19", "PART 1 -
 *  GENERAL", "DIVISION 26". Short text (a title-block label, a sheet index
 *  line) never counts, however it's worded. */
const SECTION_NUMBER_RE = /\bSECTION\s+\d{2}\s?\d{2}\s?\d{2}\b|\bPART\s+[1-3]\s*[-–—]\s*GENERAL\b|\bDIVISION\s+\d{2}\b/i;
const DENSE_TEXT_MIN_CHARS = 400;

export function looksLikeSpecText(text: string | null | undefined): boolean {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  return compact.length >= DENSE_TEXT_MIN_CHARS && SECTION_NUMBER_RE.test(compact);
}

export interface SpecCandidatePage {
  /** The page's stable key (`${sha}#${page}`) — what the returned set holds. */
  key: string;
  /** Groups pages into files: the majority signal below is per file. */
  sha: string;
  sheetNo: string;
  text: string;
}

/** Every page key that belongs to a bound spec book, for the sheet summary
 *  ONLY. Two signals, either is enough for a page to count — but neither
 *  ever overrides the sheet-number guard:
 *   1. the page itself reads like a specifications section
 *      (looksLikeSpecText) and has no sheet number; or
 *   2. most of its FILE's pages do (a bound spec book) — in which case the
 *      file's other unnumbered pages (a title page, a blank divider, a
 *      table of contents — text too short or unnumbered-but-not-dense to
 *      match signal 1 on their own) count too.
 *  A page with a real sheet number is excluded from both signals outright. */
export function computeSpecBookPages(pages: SpecCandidatePage[], majorityShare = 0.6): Set<string> {
  const bySha = new Map<string, SpecCandidatePage[]>();
  for (const p of pages) {
    if (!bySha.has(p.sha)) bySha.set(p.sha, []);
    bySha.get(p.sha)!.push(p);
  }
  const spec = new Set<string>();
  for (const ps of bySha.values()) {
    const unnumbered = ps.filter(p => !normalizeSheetId(p.sheetNo));
    if (!unnumbered.length) continue;
    const matching = unnumbered.filter(p => looksLikeSpecText(p.text));
    const fileIsSpecBook = matching.length / ps.length >= majorityShare;
    for (const p of (fileIsSpecBook ? unnumbered : matching)) spec.add(p.key);
  }
  return spec;
}
