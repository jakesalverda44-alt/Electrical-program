// Estimating Phase B, Task 2/5 — parses a sheet's printed scale label (title
// block text like `1/8" = 1'-0"`, or a two-point calibration's own generated
// label) into feet-per-PDF-point. Pure, no DB/I/O.
//
// Decision 6 of the plan: scale is per sheet, set by two-point calibration
// with the title-block text parsed as a one-click SUGGESTION. This module is
// the parser both sides use — the backend (Task 2's sheets service, to offer
// a title-block-derived suggestion when it builds/refreshes est_sheets) and
// the frontend (Task 5's scaleParse.ts, same shape, kept in sync by hand —
// this repo has no shared build target between frontend/ and backend/, the
// same convention frontend/src/features/estimating/types.ts already follows
// for the wire types).
//
// 1 inch = 72 PDF points, always, regardless of the sheet's own scale — this
// is a fixed property of the PDF coordinate system, not something a plan set
// can override.
const PT_PER_INCH = 72;

export interface ParsedScale {
  /** feet of real-world distance per one PDF user-space point. */
  ftPerPt: number;
  /** Canonical re-rendering of the label, for display next to the parsed value. */
  normalized: string;
}

// PDF text extraction of a base-14 font with no explicit /Encoding falls
// back to StandardEncoding, whose glyphs for 0x27 (apostrophe) and 0x22
// (quote) are "quoteright"/"quotedblright" — Unicode U+2019/U+201D, not the
// plain ASCII U+0027/U+0022 a keyboard would produce. Real CAD exports
// (AutoCAD/Revit/Bluebeam) normally embed WinAnsiEncoding and don't hit this,
// but tolerating both costs nothing and a hand-built test fixture without an
// explicit font encoding would otherwise silently fail every architectural-
// scale match. See backend/src/test/fixtures/estimating/buildSheetPdf.ts for
// where this was actually observed.
function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”ʺ]/g, '"');
}

/** "1", "1.5", or a simple fraction "1/8", "3/32" — never a mixed number
 *  (plan sheet scales are always a unit fraction or a whole/decimal inch
 *  count, never "1 1/2\" = 1'-0\""). Returns NaN for anything else, which the
 *  caller treats as "no match" (never propagates NaN into ftPerPt). */
function parseInchToken(s: string): number {
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    return den !== 0 ? num / den : NaN;
  }
  return Number(s);
}

// Architectural/engineering scale: `<paperInches>" = <feet>'[-<inches>"]`.
// Tolerates a missing `"` after the paper-inches token (`1/4"=1'`), a
// missing inches remainder (`1" = 20'`), and varying whitespace.
const ARCH_SCALE_RE = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*"?\s*=\s*(\d+(?:\.\d+)?)\s*'(?:\s*-?\s*(\d+(?:\.\d+)?)\s*"?)?\s*$/;

// Ratio scale: `1:100`. This app is imperial-only (Decision 7's drop/slack
// defaults are in feet); a ratio is interpreted as inches-paper : inches-
// real, the common CAD-default convention, not a metric one.
const RATIO_SCALE_RE = /^1\s*:\s*(\d+(?:\.\d+)?)$/;

const NTS_RE = /^N\.?\s*T\.?\s*S\.?$/i;

/** Parses a scale label. Returns null for "Not To Scale" (NTS) and anything
 *  unrecognized — the caller (Task 2's sheets service, Task 5's Scale tool)
 *  treats null as "no suggestion available", never as an error. Never
 *  returns a non-finite or non-positive ftPerPt. */
export function parseScaleLabel(raw: string | null | undefined): ParsedScale | null {
  if (!raw) return null;
  let s = normalizeQuotes(raw).trim();
  // A title-block label is often prefixed "SCALE:" or "SCALE " — strip it so
  // callers can hand this either the bare value or the full title-block line.
  s = s.replace(/^SCALE\s*:?\s*/i, '').trim();
  if (!s) return null;
  if (NTS_RE.test(s)) return null;

  const arch = ARCH_SCALE_RE.exec(s);
  if (arch) {
    const paperInches = parseInchToken(arch[1]);
    const feet = Number(arch[2]);
    const inches = arch[3] ? Number(arch[3]) : 0;
    if (!(paperInches > 0) || !Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    const realFeet = feet + inches / 12;
    const ftPerPt = realFeet / (paperInches * PT_PER_INCH);
    if (!Number.isFinite(ftPerPt) || ftPerPt <= 0) return null;
    return { ftPerPt, normalized: `${arch[1]}" = ${feet}'-${inches}"` };
  }

  const ratio = RATIO_SCALE_RE.exec(s);
  if (ratio) {
    const n = Number(ratio[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ftPerPt = n / 12 / PT_PER_INCH;
    if (!Number.isFinite(ftPerPt) || ftPerPt <= 0) return null;
    return { ftPerPt, normalized: `1:${ratio[1]}` };
  }

  return null;
}

/** Locates the first scale-label-shaped substring within a larger block of
 *  page text (a title block usually has other text around it) and parses
 *  it. Used by Task 2's sheets service, which has a page's full text, not a
 *  pre-isolated label string. */
export function findScaleLabel(pageText: string): ParsedScale | null {
  if (!pageText) return null;
  const normalized = normalizeQuotes(pageText);
  // Look for a "SCALE" cue first (title blocks nearly always label it), then
  // fall back to scanning for a bare scale-shaped token so a sheet whose
  // title block omits the word "SCALE" (rare, but seen on riser sheets)
  // still gets a suggestion.
  const scaleCue = /SCALE\s*:?\s*([^\n\r]{1,60})/i.exec(normalized);
  if (scaleCue) {
    // The cue capture can run on past the scale expression itself (other
    // title-block text on the same line/strip, e.g. a sheet title right
    // after it) — parseScaleLabel requires a full-string match, so trim
    // trailing whitespace-separated words one at a time until something
    // parses or there's nothing sensible left to try.
    const words = scaleCue[1].trim().split(/\s+/);
    for (let end = words.length; end > 0; end--) {
      const parsed = parseScaleLabel(words.slice(0, end).join(' '));
      if (parsed) return parsed;
    }
  }
  const lines = normalized.split(/[\n\r]+/);
  for (const line of lines) {
    const parsed = parseScaleLabel(line.trim());
    if (parsed) return parsed;
  }
  return null;
}
