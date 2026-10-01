// Estimating Phase B, Task 5 — frontend mirror of
// backend/src/estimating/scaleParse.ts. Same shape, same algorithm,
// deliberately duplicated rather than imported: this repo has no shared
// build target between frontend/ and backend/ (frontend/src/features/
// estimating/types.ts already mirrors backend wire types the same way).
// Kept in sync by hand; a change to one side's parsing rules should be
// mirrored in the other and vice versa.
//
// 1 inch = 72 PDF points, always — a fixed property of the PDF coordinate
// system, not something a plan set's own scale can override.
const PT_PER_INCH = 72;

export interface ParsedScale {
  /** feet of real-world distance per one PDF user-space point. */
  ftPerPt: number;
  /** Canonical re-rendering of the label, for display next to the parsed value. */
  normalized: string;
}

// See backend/src/estimating/scaleParse.ts's header comment for why this
// exists: a base-14 PDF font with no explicit /Encoding falls back to
// StandardEncoding, whose apostrophe/quote glyphs are Unicode
// U+2019/U+201D, not the plain ASCII a keyboard produces.
function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”ʺ]/g, '"');
}

function parseInchToken(s: string): number {
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    return den !== 0 ? num / den : NaN;
  }
  return Number(s);
}

const ARCH_SCALE_RE = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*"?\s*=\s*(\d+(?:\.\d+)?)\s*'(?:\s*-?\s*(\d+(?:\.\d+)?)\s*"?)?\s*$/;
const RATIO_SCALE_RE = /^1\s*:\s*(\d+(?:\.\d+)?)$/;
const NTS_RE = /^N\.?\s*T\.?\s*S\.?$/i;

/** Parses a scale label — `1/8" = 1'-0"`, `1/4"=1'`, `3/32" = 1'-0"`,
 *  `1" = 20'`, `1:100`. Returns null for "Not To Scale" (NTS) and anything
 *  unrecognized. Never returns a non-finite or non-positive ftPerPt. */
export function parseScaleLabel(raw: string | null | undefined): ParsedScale | null {
  if (!raw) return null;
  let s = normalizeQuotes(raw).trim();
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

/** Converts an architectural/engineering scale label directly to
 *  ft-per-point without the "SCALE:"-prefixed search findScaleLabel does —
 *  used by the Scale tool's "Use 1/8" = 1'-0"" one-click button, which
 *  already has the isolated label text from est_sheets.scale_label. */
export function ftPerPtFromLabel(label: string): number | null {
  return parseScaleLabel(label)?.ftPerPt ?? null;
}

// Fix round 2 / R2-B2 — the ONE function every consumer of a title-block
// SUGGESTION goes through: the ScaleCalibrationPopover's "Use <label>"
// button, PlansWorkspace.tsx's standalone banner Confirm, and the
// popover's own 2% disagreement check. est_sheets.suggested_ft_per_pt is
// always stored RAW (the parser's own reading of the title-block text,
// never pre-multiplied by half_size — see sheets.ts's own setHalfSize,
// which no longer touches it at all) precisely so there's one place, not
// three independently-drifting ones, that applies the ×2 for a half-size
// print. A two-point CALIBRATION never goes through this at all — it
// measures the actual sheet as printed, so whatever the estimator
// measured IS the real answer regardless of half_size (see sheets.ts's
// own setHalfSize, which only ever scales a scale_source='titleblock'
// row's ft_per_pt, never a 'calibrated' one).
export function effectiveTitleBlockFtPerPt(rawFtPerPt: number | null, halfSize: boolean): number | null {
  if (rawFtPerPt == null) return null;
  return halfSize ? rawFtPerPt * 2 : rawFtPerPt;
}

// ── "Pick a scale" dropdown ────────────────────────────────────────────────
// Scanned plan sets have no text layer, so the title-block parser finds
// nothing even when the sheet plainly says SCALE: 1/4" = 1'-0". The estimator
// picks it from the standard list instead. Each entry is stored by its
// inches-of-drawing-per-foot-of-building so there is no string parsing (and
// "1-1/2"" needs none). The ft/pt returned is RAW (as designed): half-size is
// applied once, by standardFtPerPt -> effectiveTitleBlockFtPerPt.
export interface StandardScale {
  id: string;
  group: 'Architectural' | 'Engineering';
  label: string;
  /** Inches of drawing per foot of building. */
  inPerFt: number;
}

const arch = (id: string, paper: string, inPerFt: number): StandardScale =>
  ({ id: `arch-${id}`, group: 'Architectural', label: `${paper}" = 1'-0"`, inPerFt });
const eng = (feet: number): StandardScale =>
  ({ id: `eng-${feet}`, group: 'Engineering', label: `1" = ${feet}'`, inPerFt: 1 / feet });

export const STANDARD_SCALES: readonly StandardScale[] = [
  arch('1/32', '1/32', 1 / 32), arch('1/16', '1/16', 1 / 16), arch('3/32', '3/32', 3 / 32),
  arch('1/8', '1/8', 1 / 8), arch('3/16', '3/16', 3 / 16), arch('1/4', '1/4', 1 / 4),
  arch('3/8', '3/8', 3 / 8), arch('1/2', '1/2', 1 / 2), arch('3/4', '3/4', 3 / 4),
  arch('1', '1', 1), arch('1-1/2', '1-1/2', 1.5), arch('3', '3', 3),
  eng(10), eng(20), eng(30), eng(40), eng(50), eng(60), eng(100),
];

export function rawFtPerPtFromInPerFt(inPerFt: number): number {
  return 1 / (inPerFt * PT_PER_INCH);
}

export function standardScaleById(id: string): StandardScale | null {
  return STANDARD_SCALES.find(s => s.id === id) ?? null;
}

/** ft per PDF point for a picked standard scale, half-size applied exactly once. */
export function standardFtPerPt(scale: StandardScale, halfSize: boolean): number {
  return effectiveTitleBlockFtPerPt(rawFtPerPtFromInPerFt(scale.inPerFt), halfSize) as number;
}

/** The label saved with a picked scale and shown in the toolbar afterwards. */
export function pickedScaleLabel(scale: StandardScale): string {
  return `${scale.label} (picked)`;
}

/** The standard scale whose RAW ft/pt matches `rawFtPerPt` (within 0.5%), if any. */
export function matchStandardScale(rawFtPerPt: number | null | undefined): StandardScale | null {
  if (rawFtPerPt == null || !(rawFtPerPt > 0)) return null;
  return STANDARD_SCALES.find(s => Math.abs(rawFtPerPt - rawFtPerPtFromInPerFt(s.inPerFt)) / rawFtPerPt <= 0.005) ?? null;
}

/** True when two RAW ft/pt readings differ by more than `tolPct` percent. */
export function scalesDisagree(a: number | null, b: number | null, tolPct = 2): boolean {
  if (a == null || b == null || !(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) / b * 100 > tolPct;
}
