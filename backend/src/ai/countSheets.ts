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
}

export interface SheetSelection {
  counted: CountSheet[];
  skipped: Array<{ file: string; page: number; label: string; reason: string }>;
}

const COUNTABLE_DISCIPLINES = new Set(['electrical', 'fuel']);
const PHOTOMETRIC_RE = /PHOTOMETRIC|FOOT[\s-]?CANDLE|LIGHTING\s+CALC|POINT[\s-]BY[\s-]POINT|ILLUMINANCE/i;

export function sheetLabel(sheetNo: string, title: string, fallback: string): string {
  const no = sheetNo.trim();
  const t = title.trim();
  if (no && t) return `${no} "${t}"`;
  return no || (t ? `"${t}"` : fallback);
}

/** Level identity from a sheet title, normalized ("LEVEL 2", "2ND FLOOR",
 *  "SECOND FLOOR" -> "2"; "MEZZANINE"/"ROOF" kept as words). '' when none. */
export function levelOf(title: string): string {
  const t = title.toUpperCase();
  const words: Record<string, string> = { FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', GROUND: '1' };
  let m = /\b(?:LEVEL|FLOOR)\s+(\d+)\b/.exec(t);
  if (m) return m[1];
  m = /\b(\d+)(?:ST|ND|RD|TH)\s+FLOOR\b/.exec(t);
  if (m) return m[1];
  m = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|GROUND)\s+FLOOR\b/.exec(t);
  if (m) return words[m[1]];
  m = /\b(MEZZANINE|ROOF)\b/.exec(t);
  return m ? m[1] : '';
}

export function roleOf(sheetNo: string, title: string): SheetRole {
  const t = title.toUpperCase();
  if (/\bENLARGED\b|\bPARTIAL\b/.test(t)) return 'enlarged';
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
    const skip = (reason: string) => skipped.push({ file: p.file, page: p.page, label, reason });
    if (!p.included) { skip('not selected for analysis'); continue; }
    if (!COUNTABLE_DISCIPLINES.has(p.discipline)) { skip(`not an electrical sheet (${p.discipline || 'unclassified'})`); continue; }
    if (/^PH/i.test(p.sheetNo.trim()) || PHOTOMETRIC_RE.test(p.title)) { skip('photometric / lighting-calculation sheet — never counted'); continue; }
    if (p.cls !== 'plan') { skip(`${p.cls || 'unclassified'} sheet — only plan sheets are counted`); continue; }
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
    });
  }
  return { counted, skipped };
}
