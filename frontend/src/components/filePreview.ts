import * as XLSX from 'xlsx';

export type PreviewKind = 'inline' | 'sheet' | 'doc' | 'none';

const SHEET_EXT = ['.xlsx', '.xls', '.csv'];
const MAX_ROWS_PER_SHEET = 200;

/** Decide how a document should be previewed based on its filename/mime type. */
export function previewKind(name: string, fileType?: string | null): PreviewKind {
  const lower = (name || '').toLowerCase();

  if (lower.endsWith('.pdf')) return 'inline';
  if (SHEET_EXT.some(ext => lower.endsWith(ext))) return 'sheet';
  if (lower.endsWith('.docx')) return 'doc';

  const type = (fileType || '').toLowerCase();
  if (type === 'application/pdf' || type.startsWith('image/')) return 'inline';

  return 'none';
}

/** Parse a spreadsheet ArrayBuffer into rows of cell text per sheet, capped at 200 rows/sheet. */
export async function sheetToRows(buf: ArrayBuffer): Promise<string[][][]> {
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map(sheetName => {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    return rows.slice(0, MAX_ROWS_PER_SHEET).map(row => (row || []).map(cell => (cell == null ? '' : String(cell))));
  });
}

/** Convert a .docx ArrayBuffer to HTML via mammoth (dynamically imported to keep it out of the main bundle). */
export async function docxToHtml(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return result.value;
}
