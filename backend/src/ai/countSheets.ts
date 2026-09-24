// Takeoff accuracy, Tasks 4-5 — which pages the counting stage counts, and
// what role each plays in the cross-sheet rules (Decision 7). Pure.
//
// Input is the pipeline's prep inventory (the page classifier's per-page
// sheet number / title / discipline / class). Only electrical PLAN pages are
// counted. Photometric (PH*), lighting-calculation and schedule sheets are
// never counted — that is where Kissimmee's stacked "site lights" came from.

export interface InventoryPage {
  file: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
  cls: string;
  included: boolean;
  /** Next round A1/A3 — the sheet check's role for this page. */
  role?: string;
}

export type SheetRole = 'site' | 'building' | 'enlarged';
export type SheetFocus = 'lighting' | 'power' | 'combined';

export interface CountSheet {
  /** Stable id: `${file}#${page}`. */
  key: string;
  file: string;
  page: number;
  sheetNo: string;
  title: string;
  /** What the estimator reads: `E-3 "LIGHTING PLAN"`. */
  label: string;
  role: SheetRole;
  focus: SheetFocus;
  /** Floor/level identity when the title states one ("LEVEL 2"), else ''. */
  level: string;
  /** Fix round 1 / B4 — the part of a level the sheet shows, when the title
   *  names one ("AREA A", "NORTH", "PART 2", "UNIT B", "WING 1"), else ''.
   *  Different areas of one level are SUMMED. */
  area?: string;
  /** Title says PARTIAL (a partition of a level; not an enlarged detail). */
  partial?: boolean;
  /** Next round A3 — a photometric / site-lighting sheet: counted for site
   *  and building-exterior fixture types only, and used only when the
   *  electrical plans show none of that type (never stacked on them). */
  photometric?: boolean;
}

export interface SheetSelection {
  counted: CountSheet[];
  /** `suspect` (fix round 1 / S3): the page looks like an electrical PLAN
   *  (title says PLAN, E/F sheet number) but was not counted because of how
   *  it was classified — the estimator must confirm nothing was missed. */
  skipped: Array<{ file: string; page: number; label: string; reason: string; suspect?: boolean }>;
}

const COUNTABLE_DISCIPLINES = new Set(['electrical', 'fuel']);
const PHOTOMETRIC_RE = /PHOTOMETRIC|FOOT[\s-]?CANDLE|LIGHTING\s+CALC|POINT[\s-]BY[\s-]POINT|ILLUMINANCE/i;

export function sheetLabel(sheetNo: string, title: string, fallback: string): string {
  const no = sheetNo.trim();
  const t = title.trim();
  if (no && t) return `${no} "${t}"`;
  return no || (t ? `"${t}"` : fallback);
}

/** Level identity from a sheet title, normalized ("LEVEL 2", "L2", "2ND
 *  FLOOR", "SECOND FLOOR" -> "2"; "UPPER"/"LOWER"/"MEZZANINE"/"ROOF"/
 *  "BASEMENT" kept as words; "FLOORS 2-4" -> "2-4"). '' when none.
 *  Fix round 3 / S15 — L1/L2, LEVEL TWO, 2ND LEVEL, UPPER/LOWER, BASEMENT /
 *  CELLAR and FLOORS n-m were unparsed, so two stacked floors landed in one
 *  level group. */
export function levelOf(title: string): string {
  const t = title.toUpperCase().replace(/[–—]/g, '-');
  const words: Record<string, string> = { FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', GROUND: '1', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5' };
  let m = /\bFLOORS?\s+(\d+)\s*(?:-|TO|THRU|THROUGH)\s*(\d+)\b/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /\b(?:LEVEL|FLOOR|LVL)\s*#?\s*(\d+)\b/.exec(t);
  if (m) return m[1];
  m = /\b(?:LEVEL|FLOOR)\s+(ONE|TWO|THREE|FOUR|FIVE)\b/.exec(t);
  if (m) return words[m[1]];
  m = /\bL(\d{1,2})\b/.exec(t);
  if (m) return m[1];
  m = /\b(\d+)(?:ST|ND|RD|TH)\s+(?:FLOOR|LEVEL)\b/.exec(t);
  if (m) return m[1];
  m = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|GROUND)\s+(?:FLOOR|LEVEL)\b/.exec(t);
  if (m) return words[m[1]];
  m = /\b(UPPER|LOWER)\s+(?:FLOOR|LEVEL)\b/.exec(t);
  if (m) return m[1];
  m = /\b(BASEMENT|CELLAR)\b/.exec(t);
  if (m) return 'BASEMENT';
  m = /\b(MEZZANINE|ROOF)\b/.exec(t);
  return m ? m[1] : '';
}

/** Fix round 1 / B4 — the partition of a level a sheet shows, '' when the
 *  title names none. "AREA A", "AREA A/B", "NORTH", "NORTH HALF", "PART 2",
 *  "UNIT B", "WING 1", "BUILDING 2", "ZONE 3", "SECTOR C". Fix round 2 /
 *  N-R2-5: never PHASE — phased remodel sets often show the SAME area in each
 *  phase, so two PHASE sheets of one level get the blocking same-area-or-
 *  additive question instead of being summed. */
export function areaOf(title: string): string {
  const t = title.toUpperCase().replace(/\s+/g, ' ');
  let m = /\b(AREA|PART|UNIT|WING|ZONE|SECTOR|SECTION|BUILDING|BLDG\.?)(?:\s+|\s*[#:-]\s*)([A-Z0-9]+(?:\s*[/&]\s*[A-Z0-9]+)*)\b/.exec(t);
  if (m) {
    const kind = m[1].replace(/^BLDG\.?$/, 'BUILDING');
    // "SECTION" is only an area with a short tag ("SECTION A"), never "SECTION VIEW"
    if (!(kind === 'SECTION' && m[2].length > 2)) return `${kind} ${m[2].replace(/\s+/g, '')}`;
  }
  m = /\b(NORTH|SOUTH|EAST|WEST)(?:\s*(EAST|WEST))?\b/.exec(t);
  if (m) return m[2] ? `${m[1]}${m[2]}` : m[1];
  return '';
}

export function roleOf(sheetNo: string, title: string): SheetRole {
  const t = title.toUpperCase();
  // B4 — only ENLARGED is a zoomed copy of an area shown elsewhere. PARTIAL
  // is a partition of a level (summed with its sibling partitions).
  if (/\bENLARGED\b/.test(t)) return 'enlarged';
  if (/\bSITE\b/.test(t)) return 'site';
  return 'building';
}

export function focusOf(title: string): SheetFocus {
  const t = title.toUpperCase();
  const lighting = /\bLIGHTING\b/.test(t);
  const power = /\bPOWER\b|\bDEVICE|\bRECEPTACLE|\bSYSTEMS\b/.test(t);
  if (lighting && !power) return 'lighting';
  if (power && !lighting) return 'power';
  return 'combined';
}

export function selectCountSheets(inventory: InventoryPage[]): SheetSelection {
  const counted: CountSheet[] = [];
  const skipped: SheetSelection['skipped'] = [];
  for (const p of inventory) {
    const label = sheetLabel(p.sheetNo, p.title, `${p.file} p${p.page}`);
    const skip = (reason: string, suspect = false) => skipped.push({ file: p.file, page: p.page, label, reason, ...(suspect ? { suspect } : {}) });
    const photometric = /^PH/i.test(p.sheetNo.trim()) || PHOTOMETRIC_RE.test(p.title);
    const looksLikeElectricalPlan = !photometric && /\bPLANS?\b/i.test(p.title) && !/\bSCHEDULES?\b|\bDETAILS?\b|\bRISER\b|\bONE[\s-]LINE\b|\bLEGEND\b/i.test(p.title)
      && (COUNTABLE_DISCIPLINES.has(p.discipline) || /^(E|EL|F|FP)[-\s.]?\d/i.test(p.sheetNo.trim()));
    if (!p.included) { skip('not selected for analysis'); continue; }
    // Next round A3 — a photometric SITE PLAN (often classified civil, sent
    // as a reference page) is where site fixtures like W1/W2/S1/S2 may be the
    // only place they are drawn. Counted for site / exterior types only, as a
    // fallback (countMerge). Calculation-only sheets are still never counted.
    if (photometric) {
      if (/\bPLANS?\b|\bLAYOUT\b/i.test(p.title) && !/\bCALC|\bSCHEDULE|\bDETAIL|\bSTATISTIC/i.test(p.title)) {
        counted.push({
          key: `${p.file}#${p.page}`, file: p.file, page: p.page, sheetNo: p.sheetNo.trim(), title: p.title.trim(), label,
          role: 'site', focus: 'lighting', level: '', area: '', partial: false, photometric: true,
        });
      } else {
        skip('photometric / lighting-calculation sheet — never counted');
      }
      continue;
    }
    if (p.role === 'reference') { skip('reference page — context only, not counted'); continue; }
    if (!COUNTABLE_DISCIPLINES.has(p.discipline)) {
      skip(`not an electrical sheet (${p.discipline || 'unclassified'})`, looksLikeElectricalPlan);
      continue;
    }
    if (p.cls !== 'plan') { skip(`${p.cls || 'unclassified'} sheet — only plan sheets are counted`, looksLikeElectricalPlan); continue; }
    counted.push({
      key: `${p.file}#${p.page}`,
      file: p.file,
      page: p.page,
      sheetNo: p.sheetNo.trim(),
      title: p.title.trim(),
      label,
      role: roleOf(p.sheetNo, p.title),
      focus: focusOf(p.title),
      level: levelOf(p.title),
      area: areaOf(p.title),
      partial: /\bPARTIAL\b/i.test(p.title),
    });
  }
  return { counted, skipped };
}
