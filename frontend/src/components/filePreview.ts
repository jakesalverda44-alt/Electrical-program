import * as XLSX from 'xlsx';
import DOMPurify from 'dompurify';

export type PreviewKind = 'inline' | 'sheet' | 'doc' | 'none';

// Tags/attributes mammoth's default HTML writer can produce. Anything else
// (script, style, iframe, object, embed, event-handler attributes, form
// elements, etc.) is dropped.
const DOC_HTML_ALLOWED_TAGS = [
  'p', 'br', 'span', 'div',
  'strong', 'em', 'b', 'i', 'u', 's', 'sup', 'sub',
  'a', 'img',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote',
];
const DOC_HTML_ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'];

// Defense-in-depth on top of DOMPurify's own URI allowlist (which already
// rejects javascript:/data:text-html etc.): explicitly restrict <a href> to
// http(s)/mailto/same-page anchors. Registered once at module load so
// sanitizeDocHtml doesn't re-register the hook on every call.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName !== 'A' || !node.hasAttribute('href')) return;
  const href = node.getAttribute('href') || '';
  const isRootRelative = href.startsWith('/') && !href.startsWith('//');
  if (!/^(https?:|mailto:)/i.test(href) && !href.startsWith('#') && !isRootRelative) {
    node.removeAttribute('href');
  }
});

/** Sanitize mammoth-generated docx HTML before it's injected via dangerouslySetInnerHTML.
 * The HTML is generated from the docx (not typed by a user), but a crafted docx can still
 * carry a `javascript:` hyperlink or an event-handler attribute that mammoth round-trips
 * verbatim — this is the only guard between that and script execution in-origin. */
export function sanitizeDocHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOC_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: DOC_HTML_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

const SHEET_EXT = ['.xlsx', '.xls', '.csv'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const MAX_ROWS_PER_SHEET = 200;

/** Decide how a document should be previewed based on its filename/mime type. */
export function previewKind(name: string, fileType?: string | null): PreviewKind {
  const lower = (name || '').toLowerCase();

  if (lower.endsWith('.pdf')) return 'inline';
  if (SHEET_EXT.some(ext => lower.endsWith(ext))) return 'sheet';
  if (lower.endsWith('.docx')) return 'doc';
  // Legacy docs saved without a file_type: fall back to the image extension
  // so they still preview inline instead of forcing a download.
  if (IMAGE_EXT.some(ext => lower.endsWith(ext))) return 'inline';

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
