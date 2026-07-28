// Parses APT quantity-takeoff spreadsheets into category rollups + line items, for
// comparing a new bid against similar past jobs. Non-AI, structure-based.
//
// Takeoff workbooks are NOT uniform across job types — the car wash/self-storage ones
// are a single "Quantity Takeoff" sheet, AutoZone splits "Project Info" + "Takeoff",
// and 7-Eleven has four sheets ("Summary & Flags", "Store Takeoff", "Fuel-Canopy",
// "Panel Summary"). Column layouts differ too (5 vs 8 columns). What IS consistent is
// the numbered category header ("1. SERVICE & DISTRIBUTION") and a header row naming
// a description/unit/qty column, so parsing keys off those rather than fixed positions.
import AdmZip from 'adm-zip';

export interface TakeoffLineItem {
  category: string;
  description: string;
  unit: string;
  qty: number;
  notes?: string;
}

export interface TakeoffCategory {
  name: string;
  itemCount: number;
  // Quantities summed per unit — categories mix EA/LOT/RUN/SET/LF, so a single
  // total would be meaningless.
  totals: Record<string, number>;
}

export interface ParsedTakeoff {
  sqFt: number | null;
  // Some takeoff templates carry "… | Price $287,905.36" in the header block, which is
  // the only price on file for jobs that never got a saved proposal document.
  price: number | null;
  categories: TakeoffCategory[];
  lineItems: TakeoffLineItem[];
}

type Grid = Record<number, Record<string, string>>;

const SQFT_PATTERNS = [
  /([\d,]{3,7})\s*SF\s*gross/i,
  /(?:building\s+area|gross\s+(?:building\s+)?(?:area|footprint)|total\s+(?:building\s+)?(?:sq\.?\s*ft\.?|square\s+foot(?:age)?)):?\s*([\d,]{3,7})\s*(?:SF|sq\.?\s*ft\.?)?/i,
  /([\d,]{3,7})\s*(?:SF|sq\.?\s*ft\.?|square\s+feet)\b/i,
];

// "1. SERVICE & DISTRIBUTION", "2. INTERIOR LIGHTING  (all fixtures AutoZone-furnished)",
// "5. BRANCH POWER — BUILDING". Numbering restarts per workbook and the trailing
// qualifiers vary, so capture loosely and normalize afterwards.
const CATEGORY_RE = /^(\d{1,2})\.\s+([A-Z].*)$/;

// Reduces a raw header to a canonical name so the same scope lines up across job
// types: the car wash splits "BRANCH POWER — BUILDING" from "BRANCH POWER — CAR WASH
// EQUIPMENT" while AutoZone has a single "BRANCH POWER", and parenthetical notes
// ("(Conduit & Boxes Only)") differ job to job.
function normalizeCategory(raw: string): string {
  const name = raw
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*[—–-]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // Trailing segment drifts between job types ("SITE / UNDERGROUND / ALLOWANCES" vs
  // "… / SIGNAGE", "LOW VOLTAGE" vs "LOW VOLTAGE INFRASTRUCTURE"); collapse to the
  // stable prefix so the same scope lines up in a comparison.
  if (name.startsWith('SITE / UNDERGROUND')) return 'SITE / UNDERGROUND';
  if (name.startsWith('LOW VOLTAGE')) return 'LOW VOLTAGE';
  return name;
}

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readSharedStrings(zip: AdmZip): string[] {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = entry.getData().toString('utf8');
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(si => decodeEntities(si.replace(/<[^>]+>/g, '')).trim());
}

// Reads one worksheet into { rowNumber: { columnLetter: value } }. Handles both shared
// strings (t="s") and inline strings (t="inlineStr"), which the 7-Eleven books use.
function readSheet(zip: AdmZip, entryName: string, shared: string[]): Grid {
  const entry = zip.getEntry(entryName);
  if (!entry) return {};
  const xml = entry.getData().toString('utf8');
  const grid: Grid = {};
  const cellRe = /<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml))) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const refM = attrs.match(/\br="([A-Z]+)(\d+)"/);
    if (!refM) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];

    let value: string;
    if (type === 'inlineStr') {
      value = decodeEntities((body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '').replace(/<[^>]+>/g, ''));
    } else {
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (raw === undefined) continue;
      value = type === 's' ? (shared[Number(raw)] ?? '') : decodeEntities(raw);
    }
    value = value.trim();
    if (!value) continue;
    (grid[Number(refM[2])] ??= {})[refM[1]] = value;
  }
  return grid;
}

function rowCells(row: Record<string, string> | undefined): { col: string; val: string }[] {
  if (!row) return [];
  return Object.keys(row)
    .sort((a, b) => colToIndex(a) - colToIndex(b))
    .map(col => ({ col, val: row[col] }));
}

function rowText(row: Record<string, string> | undefined): string {
  return rowCells(row).map(c => c.val).join('\t');
}

// A takeoff sheet is the one with the most numbered category headers. Falls back to
// whichever sheet has a description/qty header row if no categories are present.
function scoreSheet(grid: Grid): number {
  let score = 0;
  for (const rn of Object.keys(grid).map(Number)) {
    const cells = rowCells(grid[rn]);
    if (cells.length && cells.length <= 2 && CATEGORY_RE.test(cells[0].val)) score += 10;
    const text = rowText(grid[rn]).toUpperCase();
    if (/\bQTY\b/.test(text) && /\b(DESCRIPTION|ITEM)\b/.test(text)) score += 3;
  }
  return score;
}

// Locates the description / unit / qty columns from a header row, so an 8-column
// AutoZone sheet and a 5-column car wash sheet both parse correctly.
interface ColumnMap { desc: string; unit?: string; qty: string; notes?: string }

function findColumnMap(grid: Grid): ColumnMap | null {
  for (const rn of Object.keys(grid).map(Number).sort((a, b) => a - b)) {
    const cells = rowCells(grid[rn]);
    if (cells.length < 2) continue;
    let desc: string | undefined, unit: string | undefined, qty: string | undefined, notes: string | undefined;
    for (const { col, val } of cells) {
      const v = val.toUpperCase().replace(/\s+/g, ' ').trim();
      if (!desc && /(DESCRIPTION|^ITEM(\s*\/\s*DESCRIPTION)?$)/.test(v)) desc = col;
      else if (!unit && /^UNIT$/.test(v)) unit = col;
      else if (!qty && /^(QTY|QUANTITY|COUNT)$/.test(v)) qty = col;
      else if (!notes && /^(NOTES?|SOURCE\s*\/\s*NOTES)$/.test(v)) notes = col;
    }
    // The car wash layout has ITEM in col A and DESCRIPTION in col B; prefer DESCRIPTION.
    if (desc && qty) {
      const descHeader = grid[rn][desc]?.toUpperCase() ?? '';
      if (/^ITEM$/.test(descHeader.trim())) {
        const better = cells.find(c => /DESCRIPTION/.test(c.val.toUpperCase()));
        if (better) desc = better.col;
      }
      return { desc, unit, qty, notes };
    }
  }
  return null;
}

// Older takeoff templates label sections in unnumbered title case ("Service &
// Distribution") instead of "1. SERVICE & DISTRIBUTION". Accept a bare heading only
// after the column header row has been seen, and only when it reads like a title —
// otherwise the cover-block lines ("GC: Bay to Bay | Job JS…") would be swallowed.
function looksLikeBareHeading(text: string): boolean {
  return text.length <= 60
    && !/[:|]/.test(text)
    && !/\d/.test(text)
    && /^[A-Z]/.test(text)
    && text.split(/\s+/).length <= 7;
}

function parseSheet(grid: Grid, out: TakeoffLineItem[]): void {
  const map = findColumnMap(grid);
  if (!map) return;

  let category = 'Uncategorized';
  let seenHeader = false;
  for (const rn of Object.keys(grid).map(Number).sort((a, b) => a - b)) {
    const row = grid[rn];
    const cells = rowCells(row);
    if (!cells.length) continue;

    if (!seenHeader) {
      const t = rowText(row).toUpperCase();
      if (/\bQTY\b/.test(t) && /\b(DESCRIPTION|ITEM)\b/.test(t)) { seenHeader = true; continue; }
    }

    // Category headers sit alone on their row — no quantity alongside them.
    const isAlone = cells.length <= 2 && !row[map.qty];
    const catM = cells[0].val.match(CATEGORY_RE);
    if (catM && isAlone) {
      category = normalizeCategory(catM[2]);
      continue;
    }
    if (isAlone && seenHeader && looksLikeBareHeading(cells[0].val)) {
      category = normalizeCategory(cells[0].val);
      continue;
    }

    const description = row[map.desc];
    const qtyRaw = map.qty ? row[map.qty] : undefined;
    if (!description || qtyRaw === undefined) continue;
    // Skip repeated header rows (each category restates them in the AutoZone books).
    if (/^(ITEM|DESCRIPTION|QTY|UNIT)$/i.test(description.trim())) continue;

    const qty = Number(String(qtyRaw).replace(/,/g, ''));
    if (!Number.isFinite(qty)) continue;

    out.push({
      category,
      description: description.trim(),
      unit: (map.unit ? row[map.unit] : '')?.trim() || 'EA',
      qty,
      notes: map.notes ? row[map.notes]?.trim() : undefined,
    });
  }
}

export function parseTakeoffWorkbook(buf: Buffer): ParsedTakeoff {
  const zip = new AdmZip(buf);
  const shared = readSharedStrings(zip);
  const sheetEntries = zip.getEntries()
    .map(e => e.entryName)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();

  const grids = sheetEntries.map(name => readSheet(zip, name, shared));

  // Square footage may live on a cover/info sheet rather than the takeoff sheet.
  let sqFt: number | null = null;
  const allText = grids.map(g =>
    Object.keys(g).map(Number).sort((a, b) => a - b).map(rn => rowText(g[rn])).join('\n')
  ).join('\n');
  for (const pattern of SQFT_PATTERNS) {
    const m = allText.match(pattern);
    if (m) { sqFt = Number(m[1].replace(/,/g, '')); break; }
  }

  const priceM = allText.match(/\bPrice\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  const price = priceM ? Number(priceM[1].replace(/,/g, '')) : null;

  // Parse every sheet that looks like a takeoff — 7-Eleven splits store scope from
  // fuel-canopy scope across sheets, and both belong in the totals.
  const scored = grids.map(g => ({ grid: g, score: scoreSheet(g) }));
  const best = Math.max(0, ...scored.map(s => s.score));
  const lineItems: TakeoffLineItem[] = [];
  for (const { grid, score } of scored) {
    if (score > 0 && score >= best / 4) parseSheet(grid, lineItems);
  }

  const byCategory = new Map<string, TakeoffCategory>();
  for (const item of lineItems) {
    let cat = byCategory.get(item.category);
    if (!cat) { cat = { name: item.category, itemCount: 0, totals: {} }; byCategory.set(item.category, cat); }
    cat.itemCount += 1;
    cat.totals[item.unit] = (cat.totals[item.unit] ?? 0) + item.qty;
  }

  return { sqFt, price, categories: [...byCategory.values()], lineItems };
}
