// Estimating Phase B, Task 7 — suggested markers from the PDF text layer.
// Pure: given pdf.js text items (str + transform, exactly what
// page.getTextContent() returns) and a list of tags, returns candidate
// points for a dashed "suggested" marker per whole-token match.
import { PageGeometry, pdfToScreen, renderedSize } from './overlay';

export interface TextItem {
  str: string;
  /** [a, b, c, d, e, f] — pdf.js's own item transform; e/f are the item's
   *  origin in PDF user-space points, UNAFFECTED by the page's own
   *  /Rotate (verified against real pdfjs-dist output — see overlay.ts's
   *  header comment and backend/src/estimating/sheets.ts). */
  transform: number[];
  /** pdf.js text items carry an approximate width; used to center the
   *  suggested marker on the matched run rather than its top-left origin. */
  width?: number;
  height?: number;
}

export type SheetKindForSuggest = 'plan' | 'schedule' | 'detail' | 'riser' | 'cover' | 'other';

export interface TagCandidate {
  tag: string;
  /** PDF user-space point (Decision 5) — center of the matched text run. */
  point: { x: number; y: number };
  /** The full text of the matched item, for a hover/tooltip. */
  text: string;
}

const SCHEDULE_LIKE_KINDS: ReadonlySet<SheetKindForSuggest> = new Set(['schedule', 'cover', 'riser']);

/** Case-insensitive whole-alphanumeric-token split — "Type A" -> ["TYPE","A"],
 *  "A1" -> ["A1"], "A-1" -> ["A","1"]. Never splits a run of letters+digits
 *  with no separator (so tag "A" cannot match inside "A1" or "AMP" — the
 *  plan's own examples). */
function tokenize(s: string): string[] {
  return s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

// ── Title-block strip (rotation-aware) ──────────────────────────────────

/** True when an item's DISPLAYED position (after applying the page's own
 *  rotation, via overlay.ts's already-verified transform) falls in the
 *  right 25% of the displayed page — the same "right strip, full height"
 *  convention ai/pageClassifier.ts's titleBlockCropRect and backend's
 *  sheets.ts use, but applied to the RENDERED (rotation-corrected)
 *  position rather than the raw, unrotated PDF coordinate. A tag sitting
 *  in the title block of a page rotated 90 degrees has a raw PDF x
 *  coordinate that has nothing to do with "the right side of the drawing
 *  as printed" — only the rotated/displayed position does. */
function isInTitleBlockStrip(item: TextItem, geom: PageGeometry): boolean {
  const displayed = pdfToScreen(geom, 1, { x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 });
  const { width } = renderedSize(geom, 1);
  if (width <= 0) return false;
  return displayed.x >= width * 0.75;
}

// ── Table-region heuristic ────────────────────────────────────────────────
// "Dense aligned text grid" — a schedule accidentally left on a 'plan'-kind
// sheet, or a legend/table drawn on the sheet itself. Deterministic, no
// per-page tuning: buckets items into rows by y, finds each row's column
// (x-start) signature, and flags a row as "table" when enough OTHER rows
// share enough of the same column positions. A handful of scattered device
// tags never produces this pattern; a real table (repeated rows, aligned
// columns) always does.
const ROW_Y_TOLERANCE_PT = 3;
const COL_X_TOLERANCE_PT = 6;
const MIN_ITEMS_PER_ROW = 3;
const MIN_ROWS_FOR_TABLE = 3;
const MIN_POPULAR_COLUMNS = 3;
/** A row counts toward the table when it hits at least this many of the
 *  table's "popular" columns — avoids one stray row with a single
 *  coincidental x-alignment being swept in. */
const MIN_SHARED_COLUMNS_PER_ROW = 2;

function roundTo(v: number, tolerance: number): number {
  return Math.round(v / tolerance) * tolerance;
}

/** Returns the SET of item indices (into `items`) that sit inside a
 *  detected table region and should never produce a suggestion. */
function detectTableItemIndices(items: TextItem[]): Set<number> {
  const rowsByY = new Map<number, number[]>(); // y-bucket -> item indices
  items.forEach((item, idx) => {
    const yBucket = roundTo(item.transform[5] ?? 0, ROW_Y_TOLERANCE_PT);
    const list = rowsByY.get(yBucket) ?? [];
    list.push(idx);
    rowsByY.set(yBucket, list);
  });

  const candidateRows = Array.from(rowsByY.entries()).filter(([, idxs]) => idxs.length >= MIN_ITEMS_PER_ROW);
  if (candidateRows.length < MIN_ROWS_FOR_TABLE) return new Set();

  const rowSignatures = candidateRows.map(([yBucket, idxs]) => ({
    yBucket,
    idxs,
    cols: new Set(idxs.map(i => roundTo(items[i].transform[4] ?? 0, COL_X_TOLERANCE_PT))),
  }));

  const columnRowCounts = new Map<number, number>();
  for (const row of rowSignatures) {
    for (const col of row.cols) {
      columnRowCounts.set(col, (columnRowCounts.get(col) ?? 0) + 1);
    }
  }
  const popularColumns = new Set(
    Array.from(columnRowCounts.entries()).filter(([, count]) => count >= MIN_ROWS_FOR_TABLE).map(([col]) => col)
  );
  if (popularColumns.size < MIN_POPULAR_COLUMNS) return new Set();

  const excluded = new Set<number>();
  for (const row of rowSignatures) {
    let shared = 0;
    for (const col of row.cols) if (popularColumns.has(col)) shared++;
    if (shared >= MIN_SHARED_COLUMNS_PER_ROW) {
      for (const idx of row.idxs) excluded.add(idx);
    }
  }
  return excluded;
}

// ── Public API ───────────────────────────────────────────────────────────

export interface SuggestTagMarkersOptions {
  geom: PageGeometry;
  /** Sheets whose kind is schedule/cover/riser never produce suggestions at
   *  all (Task 7's own rule) — cheaper to check once than per item. */
  sheetKind?: SheetKindForSuggest;
}

/** Finds every whole-token match of any of `tags` among `items`, excluding
 *  anything in the title-block strip or inside a detected table region.
 *  Deterministic; returns one candidate per (item, matched tag) pair — an
 *  item mentioning two different tags (rare) yields two candidates at the
 *  same point, left for the caller to dedupe/display as it sees fit. */
export function suggestTagMarkers(items: TextItem[], tags: string[], opts: SuggestTagMarkersOptions): TagCandidate[] {
  if (opts.sheetKind && SCHEDULE_LIKE_KINDS.has(opts.sheetKind)) return [];
  if (tags.length === 0 || items.length === 0) return [];

  const upperTags = new Set(tags.map(t => t.toUpperCase()).filter(Boolean));
  if (upperTags.size === 0) return [];

  const tableExcluded = detectTableItemIndices(items);

  const out: TagCandidate[] = [];
  items.forEach((item, idx) => {
    if (tableExcluded.has(idx)) return;
    if (isInTitleBlockStrip(item, opts.geom)) return;
    const tokens = tokenize(item.str);
    if (tokens.length === 0) return;
    const matched = new Set<string>();
    for (const token of tokens) {
      if (upperTags.has(token) && !matched.has(token)) {
        matched.add(token);
        const x = (item.transform[4] ?? 0) + (item.width ?? 0) / 2;
        const y = (item.transform[5] ?? 0) + (item.height ?? 0) / 2;
        out.push({ tag: token, point: { x, y }, text: item.str });
      }
    }
  });
  return out;
}
