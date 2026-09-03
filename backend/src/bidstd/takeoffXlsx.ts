// Phase 3 Task 3 — the quantity-takeoff xlsx builder, ported faithfully from
// the APT_Bid_System v4 skill's scripts/build_takeoff.py
// (~/.claude/skills/apt-electrical-bid/scripts/build_takeoff.py). Uses
// exceljs (added this task) rather than SheetJS community edition, which
// can't write fills/borders.
//
// Two modes, same as build_takeoff.py:
//   GC-facing (default)   ITEM | DESCRIPTION | UNIT | QTY | SOURCE / NOTES
//   Pre-bid (prebid:true) adds a CONF. column (FIRM/APPROX/VERIFY) for Chris
//
// A FURNISH BY column is added automatically whenever any takeoff item
// carries a furnish_by value — force on/off via opts.furnish.
//
// Building square footage belongs HERE (building_area/interior_breakdown in
// the header block), never on the bid docx — see docs/Bid_Output_Standards.md
// and Task 2's renderBidDocx, which never reads those two fields.
import ExcelJS from 'exceljs';
import { BidData, TakeoffCategory } from './bidData';
import { TAKEOFF_CATEGORIES } from './boilerplate';

const NAVY = '1F3864';
const ACCENT = 'D9E1F2';
const WHITE = 'FFFFFF';
const BLACK = '000000';
const GREEN = 'E2EFDA';   // FIRM confidence fill
const YELLOW = 'FFF2CC';  // APPROX / VERIFY confidence fill
const BORDER_COLOR = '9AA5B1';

/** exceljs ARGB colors need a leading alpha channel — always opaque here. */
const argb = (hex: string) => `FF${hex}`;

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: argb(BORDER_COLOR) } },
  bottom: { style: 'thin', color: { argb: argb(BORDER_COLOR) } },
  left: { style: 'thin', color: { argb: argb(BORDER_COLOR) } },
  right: { style: 'thin', color: { argb: argb(BORDER_COLOR) } },
};

function fill(hex: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
}

/** FURNISH BY column is warranted when any line names who furnishes. */
export function wantsFurnish(data: BidData): boolean {
  return (data.takeoff ?? []).some(cat => (cat.items ?? []).some(it => !!it.furnish_by));
}

export interface RenderTakeoffXlsxOptions {
  prebid?: boolean;
  /** true/false forces the FURNISH BY column on/off; undefined/null auto-detects via wantsFurnish. */
  furnish?: boolean | null;
}

export interface RenderedTakeoffXlsx {
  buffer: Buffer;
  filename: string;
}

/** GC: `[Project]_Quantity_Takeoff.xlsx`; pre-bid: `[Project]_PreBid_Quantity_Takeoff.xlsx`. */
export function takeoffXlsxFilename(data: BidData, prebid: boolean): string {
  const suffix = prebid ? '_PreBid' : '';
  return `${data.project_slug}${suffix}_Quantity_Takeoff.xlsx`;
}

export async function renderTakeoffXlsx(data: BidData, opts: RenderTakeoffXlsxOptions = {}): Promise<RenderedTakeoffXlsx> {
  const prebid = !!opts.prebid;
  const furnish = typeof opts.furnish === 'boolean' ? opts.furnish : wantsFurnish(data);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quantity Takeoff');

  const headers = ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY']
    .concat(prebid ? ['CONF.'] : [])
    .concat(furnish ? ['FURNISH BY'] : [])
    .concat(['SOURCE / BASIS / NOTES']);
  const widths = [8, 52, 8, 9]
    .concat(prebid ? [9] : [])
    .concat(furnish ? [14] : [])
    .concat([50]);
  ws.columns = widths.map(width => ({ width }));
  const ncols = headers.length;

  let r = 1;

  function merged(text: string, o: { bold?: boolean; size?: number; fillHex?: string; color?: string; height?: number } = {}) {
    ws.mergeCells(r, 1, r, ncols);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: 'Arial', size: o.size ?? 11, bold: !!o.bold, color: { argb: argb(o.color ?? BLACK) } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
    if (o.fillHex) {
      for (let k = 1; k <= ncols; k++) ws.getCell(r, k).fill = fill(o.fillHex);
    }
    if (o.height) ws.getRow(r).height = o.height;
    r += 1;
  }

  // ---- Header block -------------------------------------------------------
  merged('ACCURATE POWER & TECHNOLOGY  -  ELECTRICAL QUANTITY TAKEOFF',
    { bold: true, size: 14, color: NAVY, height: 20 });
  merged(`${data.project_name}  |  ${data.project_address}`, { bold: true });
  merged(`Job No. ${data.job_number}   |   ${data.client}   |   Drawings dated ${data.plan_date || '—'}   |   Prepared ${data.date}`);
  if (data.building_area) merged(`Building area:  ${data.building_area}`);
  if (data.interior_breakdown) merged(`Interior breakdown:  ${data.interior_breakdown}`);
  if (prebid) {
    merged(
      'PRE-BID PACKAGE - INTERNAL USE   |   Confidence: FIRM = read off a schedule/panel/riser  ·  '
      + 'APPROX = symbol count (± range stated)  ·  VERIFY = partial/inferred',
      { bold: true, color: NAVY }
    );
  }
  r += 1;

  // ---- Column headers -------------------------------------------------------
  headers.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { name: 'Arial', size: 10, bold: true, color: { argb: argb(WHITE) } };
    c.fill = fill(NAVY);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = THIN_BORDER;
  });
  // Freeze every row above this one (the header block + this column-header row).
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: r }];
  r += 1;

  // ---- Categories -------------------------------------------------------
  const byName = new Map<string, TakeoffCategory>((data.takeoff ?? []).map(c => [c.name, c]));
  for (const name of TAKEOFF_CATEGORIES) {
    const cat: TakeoffCategory = byName.get(name) ?? { name, items: [] };
    merged(name.toUpperCase(), { bold: true, size: 10, fillHex: ACCENT, color: NAVY });
    ws.getCell(r - 1, 1).border = THIN_BORDER;

    for (const it of cat.items) {
      const vals: (string | number)[] = [it.item ?? '', it.description ?? '', it.unit ?? '', it.qty ?? ''];
      let confCol: number | null = null;
      let furnishCol: number | null = null;
      if (prebid) { vals.push(it.conf ?? ''); confCol = vals.length; }
      if (furnish) { vals.push(it.furnish_by ?? ''); furnishCol = vals.length; }
      vals.push(it.source ?? '');

      const centered = new Set([1, 3, 4]);
      if (confCol) centered.add(confCol);
      if (furnishCol) centered.add(furnishCol);

      vals.forEach((v, idx) => {
        const i = idx + 1;
        const c = ws.getCell(r, i);
        c.value = v;
        c.font = { name: 'Arial', size: 10 };
        c.border = THIN_BORDER;
        c.alignment = {
          horizontal: centered.has(i) ? 'center' : 'left',
          vertical: 'top',
          wrapText: i === 2 || i === ncols,
        };
      });

      if (confCol) {
        const conf = String(it.conf ?? '').toUpperCase();
        if (conf) {
          ws.getCell(r, confCol).fill = fill(conf === 'FIRM' ? GREEN : YELLOW);
        }
      }
      r += 1;
    }
  }

  // ---- Notes block -------------------------------------------------------
  if (data.takeoff_notes && data.takeoff_notes.length) {
    r += 1;
    merged('NOTES', { bold: true, size: 10, fillHex: ACCENT, color: NAVY });
    for (const n of data.takeoff_notes) {
      merged(`·  ${n}`, { size: 10 });
    }
  }

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: takeoffXlsxFilename(data, prebid) };
}
