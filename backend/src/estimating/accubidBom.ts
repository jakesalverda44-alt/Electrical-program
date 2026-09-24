// Next round Part B, Task 1 — pure parser for an Accubid "BOM" (Bill of
// Material) export, extracted with `pdftotext -layout`. One row per material
// line: description (attributes + item text, kept together — see below),
// qty, unit (E/C/M), price, cost, vendor cost adjustment %, net cost, total
// material $, labor unit (hours per unit), field labor adjustment %, total
// field labor hours, and the material condition (Normal/Halted/Quoted/
// Budget/No Cost). Pure: no I/O — accubidImport.ts resolves rows against the
// library.
//
// Two report layouts were found across the five real BOMs this was built
// against (see backend/src/test/fixtures/estimating/accubid/*.txt):
//   - 2026 Kissimmee: ... Total Mat. $ | U | Labor U | Field Labor Adj % |
//     Total Field Labor | Mat. Cond.  (Mat. Cond. LAST)
//   - 2024 jobs (36th Street, North Port, Orlando, Rockledge): ... Total
//     Mat. $ | Mat. Cond. | U | Labor U | Field Labor Adj % | Total Field
//     Labor  (Mat. Cond. BEFORE the labor-unit column)
// Rather than special-case two layouts, the parser finds the Mat. Cond. word
// wherever it falls in the row, removes it, and re-tokenizes what's left —
// which makes both layouts (and any other column order Accubid might use)
// parse identically. The two unit letters (material-side and labor-side —
// always the same letter, since one row prices one unit) bracket the two
// numeric groups: everything before the second occurrence of the unit letter
// is the material block (price/cost/vendor-adj%/net-cost/total-material, 0-5
// of them present), everything after is the labor block (labor-unit/
// field-labor-adj%/total-field-labor, 0-3 of them present).
//
// A handful of real rows (Toggle Switch lines on three of the five BOMs) print
// a vendor cost adjustment % over 1000% with its decimal digits clipped by
// the PDF's own column width ("1,315." with nothing after the dot) — the
// number parser below accepts a bare trailing dot (Number("1315.") === 1315)
// rather than rejecting the row over one low-precision, rarely-used field.

export type BomUnit = 'E' | 'C' | 'M';

/** Per-unit divisor, same convention as pricing.ts's UNIT_DIVISOR (E == EA). */
export const BOM_UNIT_DIVISOR: Record<BomUnit, number> = { E: 1, C: 100, M: 1000 };

export type MatCondition = 'Normal' | 'Halted' | 'Quoted' | 'Budget' | 'No Cost';
const MAT_CONDITIONS: MatCondition[] = ['No Cost', 'Normal', 'Halted', 'Quoted', 'Budget'];
// "No Cost" must be tried before "Normal"/etc individually would ever matter —
// alternation order below matches the longer, two-word phrase first.
const MAT_COND_RE = new RegExp(`\\b(${MAT_CONDITIONS.join('|')})\\b`, 'g');

export interface BomRow {
  /** Attributes + item description, kept as one field (pdftotext -layout's
   *  column spacing between them isn't reliable enough to split without
   *  risking silently truncating a real description — see module comment). */
  description: string;
  qty: number;
  unit: BomUnit;
  price: number | null;
  cost: number | null;
  vendorCostAdjPct: number | null;
  netCost: number | null;
  totalMaterial: number | null;
  /** Hours per unit (per EA / per C / per M). */
  laborUnit: number | null;
  fieldLaborAdjPct: number | null;
  /** Hours, already extended: laborUnit * (qty / divisor) * (1 + adjPct/100). */
  totalFieldLaborHours: number | null;
  matCondition: MatCondition | null;
}

/** A line that had the right qty/unit/mat-cond shape but couldn't be split
 *  into a known number of material/labor fields — surfaced so an import
 *  preview can show "N rows could not be read" rather than silently
 *  dropping them (never guessed at). */
export interface BomParseWarning {
  line: string;
  reason: string;
}

export interface ParsedBom {
  rows: BomRow[];
  warnings: BomParseWarning[];
  /** The report's own footer totals ($material, hours) — null if not found. */
  footerMaterialTotal: number | null;
  footerLaborHours: number | null;
  /** Sum of each row's own totalMaterial / totalFieldLaborHours — compare
   *  against the footer to confirm nothing was dropped or double-counted. */
  computedMaterialTotal: number;
  computedLaborHours: number;
}

const HEADER_SKIP = /^(Job Name|Job #|Attributes|Item Description|%|Extensi)/;
// A footer line is just "$material  hours" with nothing else on it.
const FOOTER_RE = /^\$?([\d,]+\.\d{2})\s+([\d,]+\.\d{3})$/;
// Qty is always printed with exactly 3 decimals ("1,475.000"); the unit
// letter that follows is E, C or M.
const ROW_HEAD_RE = /^(.+?)\s+([\d,]+\.\d{3})\s+([ECM])\s+(.*)$/;
// Accepts "1,234.56", "1234", "1315." (clipped decimal) and "-14.453".
const NUM_TOKEN_RE = /^-?[\d,]+\.?\d*$/;

function num(token: string): number {
  return Number(token.replace(/,/g, ''));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function parseRow(line: string): BomRow | BomParseWarning | null {
  if (!line.trim()) return null;
  const head = line.match(ROW_HEAD_RE);
  if (!head) return null;
  const [, descRaw, qtyStr, unitStr, rest] = head;
  const unit = unitStr as BomUnit;

  MAT_COND_RE.lastIndex = 0;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = MAT_COND_RE.exec(rest))) lastMatch = m;
  if (!lastMatch) return { line, reason: 'no material condition (Normal/Halted/Quoted/Budget/No Cost) found' };

  const matCondition = lastMatch[1] as MatCondition;
  const withoutMatCond = `${rest.slice(0, lastMatch.index)} ${rest.slice(lastMatch.index + lastMatch[0].length)}`.trim();
  const tokens = withoutMatCond.length ? withoutMatCond.split(/\s+/) : [];

  // The labor-side unit repeats the material-side unit (unit1) exactly once,
  // partway through the row — its LAST occurrence is the marker (there is
  // never a legitimate numeric token equal to a bare unit letter).
  let unitIdx = -1;
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === unit) unitIdx = i;
  if (unitIdx === -1) return { line, reason: `no second "${unit}" unit column found` };

  const before = tokens.slice(0, unitIdx);
  const after = tokens.slice(unitIdx + 1);
  const allNumeric = [...before, ...after].every(t => NUM_TOKEN_RE.test(t));
  if (!allNumeric) return { line, reason: 'a non-numeric token where a cost/labor field was expected' };

  const b = before.map(num);
  let price: number | null = null;
  let cost: number | null = null;
  let vendorCostAdjPct: number | null = null;
  let netCost: number | null = null;
  let totalMaterial: number | null = null;
  switch (b.length) {
    case 0: break;
    case 1: [netCost] = b; break;
    case 2: [netCost, totalMaterial] = b; break;
    case 3: [cost, netCost, totalMaterial] = b; break;
    case 4: [price, cost, netCost, totalMaterial] = b; break;
    case 5: [price, cost, vendorCostAdjPct, netCost, totalMaterial] = b; break;
    default: return { line, reason: `${b.length} material fields — expected 0-5` };
  }

  const a = after.map(num);
  let laborUnit: number | null = null;
  let fieldLaborAdjPct: number | null = null;
  let totalFieldLaborHours: number | null = null;
  switch (a.length) {
    case 0: break;
    case 1: [laborUnit] = a; break;
    case 2: [laborUnit, totalFieldLaborHours] = a; break;
    case 3: [laborUnit, fieldLaborAdjPct, totalFieldLaborHours] = a; break;
    default: return { line, reason: `${a.length} labor fields — expected 0-3` };
  }

  return {
    description: descRaw.trim().replace(/\s{2,}/g, ' '),
    qty: num(qtyStr),
    unit,
    price, cost, vendorCostAdjPct, netCost, totalMaterial,
    laborUnit, fieldLaborAdjPct, totalFieldLaborHours,
    matCondition,
  };
}

function isWarning(x: BomRow | BomParseWarning): x is BomParseWarning {
  return 'reason' in x;
}

/** Parses `pdftotext -layout` output of an Accubid BOM export into rows. */
export function parseAccubidBom(text: string): ParsedBom {
  const rows: BomRow[] = [];
  const warnings: BomParseWarning[] = [];
  let footerMaterialTotal: number | null = null;
  let footerLaborHours: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (HEADER_SKIP.test(trimmed)) continue;
    const footer = trimmed.match(FOOTER_RE);
    if (footer) {
      footerMaterialTotal = num(footer[1]);
      footerLaborHours = num(footer[2]);
      continue;
    }
    const parsed = parseRow(rawLine);
    if (parsed === null) continue;
    if (isWarning(parsed)) warnings.push(parsed);
    else rows.push(parsed);
  }

  const computedMaterialTotal = round2(rows.reduce((s, r) => s + (r.totalMaterial ?? 0), 0));
  const computedLaborHours = round3(rows.reduce((s, r) => s + (r.totalFieldLaborHours ?? 0), 0));

  return { rows, warnings, footerMaterialTotal, footerLaborHours, computedMaterialTotal, computedLaborHours };
}
