// Estimating Phase B, Task 2 — builds/refreshes est_sheets (one row per
// plan-set PDF page) and authorizes/loads a plan document for the streaming
// route. See docs/superpowers/plans/2026-09-23-estimating-phase-b-plan-viewer.md.
import { Readable } from 'stream';
import { pool } from '../db/pool';
import { getFileMedia } from '../services/googleDrive';
import { logger } from '../utils/logger';
import { titleBlockCropRect } from '../ai/pageClassifier';
import { findScaleLabel, findAllScaleLabels } from './scaleParse';
import { openPdfDocument, PdfJsDocument, PdfJsTextItem } from './pdfjsLoader';

export type SheetDiscipline = 'E' | 'A' | 'M' | 'P' | 'other';
export type SheetKind = 'plan' | 'schedule' | 'detail' | 'riser' | 'cover' | 'other';
export type ScaleSource = 'calibrated' | 'titleblock' | null;

export interface SheetRow {
  bid_id: string;
  document_id: string;
  /** 0-based, matches pdf.js's own page indexing convention used by the
   *  frontend viewer (Decision 5/8) — page NUMBER (1-based) is page_index+1. */
  page_index: number;
  sheet_no: string;
  title: string;
  discipline: SheetDiscipline;
  kind: SheetKind;
  width_pt: number;
  height_pt: number;
  rotation: number;
  ft_per_pt: number | null;
  scale_source: ScaleSource;
  scale_label: string | null;
  has_text_layer: boolean;
  /** Fix round 1 / B7 — the title-block-parsed scale, offered as a
   *  one-click suggestion (never auto-applied to ft_per_pt). null when
   *  nothing was found, OR when scale_ambiguous is true (more than one
   *  distinct scale on the page — no single suggestion can be trusted). */
  suggested_ft_per_pt: number | null;
  suggested_label: string | null;
  /** Fix round 1 / B7 — true when the page's text contains more than one
   *  DISTINCT scale value (e.g. an enlarged detail callout alongside the
   *  main plan's own scale). The UI shows "Multiple scales on this sheet
   *  — calibrate" and offers no suggestion at all. */
  scale_ambiguous: boolean;
  /** Fix round 1 / B7 — a document-wide (not per-sheet) toggle: every
   *  sheet of the same document_id shares this value. */
  half_size: boolean;
}

export interface PlanDocument {
  id: string;
  name: string;
  file_type: string | null;
  file_data: string | null;
  storage_url: string | null;
}

/** Every PDF `documents` row filed under the bid's Plans category (the
 *  category the workspace's file upload writes — PcWorkspaceView.tsx's
 *  addFiles/runPersistFiles always sends category:'plans' for the electrical
 *  plan set). Non-PDF plan-category uploads (a stray .dwg, a spec sheet
 *  someone miscategorized) are silently skipped — nothing here can index a
 *  non-PDF page. */
export async function getPlanPdfDocuments(bidId: string): Promise<PlanDocument[]> {
  const { rows } = await pool.query(
    `SELECT id, name, file_type, file_data, storage_url FROM documents
     WHERE linked_id = $1 AND category = 'plans' AND deleted_at IS NULL
       AND (file_type = 'application/pdf' OR name ILIKE '%.pdf')
     ORDER BY created_at`,
    [bidId]
  );
  return rows as PlanDocument[];
}

/** Loads a document ONLY when it is both plans-category and actually linked
 *  to THIS bid — the second half is what stops the authenticated PDF stream
 *  route from serving another bid's document by id even when the caller
 *  legitimately has access to the bid named in the URL (an adversarial-
 *  review concern the plan calls out explicitly: "no cross-bid document
 *  access by id"). Bid-level access itself (does this user get to act on
 *  this bidId at all) is the caller's job via loadAccessibleBid, same as
 *  every other route in this router. */
export async function loadPlanDocumentForBid(bidId: string, documentId: string): Promise<PlanDocument | null> {
  const { rows } = await pool.query(
    `SELECT id, name, file_type, file_data, storage_url FROM documents
     WHERE id = $1 AND linked_id = $2 AND deleted_at IS NULL`,
    [documentId, bidId]
  );
  return (rows[0] as PlanDocument | undefined) ?? null;
}

/** True when storage_url is a Google Drive "view" link (the shape every
 *  Drive-stored document in this app uses — see routes/documents.ts and
 *  preconstruction.ts's own /file\/d\/ matches). */
function driveFileId(storageUrl: string): string | null {
  const m = /\/file\/d\/([^/?#]+)/.exec(storageUrl);
  return m ? m[1] : null;
}

/** Reads a document's full bytes into memory — used ONLY by the one-time
 *  sheet-indexing step below (pdfjs needs the whole buffer to parse a
 *  page's geometry/text; there's no meaningful way to stream-parse a PDF's
 *  page tree). This is deliberately NOT what the streaming route
 *  (GET sheets/:documentId/file) uses to serve bytes to the browser viewer —
 *  that route pipes the Drive/storage stream straight through without
 *  buffering, per the plan's "50-150MB plan sets: stream, don't
 *  buffer-to-base64" note; buffering here is a one-time, cached-after
 *  indexing cost, not a per-view cost. */
async function fetchDocumentBuffer(doc: PlanDocument): Promise<Buffer | null> {
  if (doc.file_data) {
    return Buffer.from(doc.file_data, 'base64');
  }
  if (doc.storage_url) {
    const fileId = driveFileId(doc.storage_url);
    if (fileId) {
      const media = await getFileMedia(fileId);
      if (!media) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of media.stream as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
      return Buffer.concat(chunks);
    }
    try {
      const resp = await fetch(doc.storage_url);
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      logger.warn({ err, documentId: doc.id }, '[estimating/sheets] could not fetch document by URL');
      return null;
    }
  }
  return null;
}

const SHEET_NO_RE = /^([EAMP])-?\d{1,3}(?:\.\d{1,2})?$/i;

function disciplineFromSheetNo(sheetNo: string): SheetDiscipline {
  const m = SHEET_NO_RE.exec(sheetNo);
  if (!m) return 'other';
  const letter = m[1].toUpperCase();
  return (letter === 'E' || letter === 'A' || letter === 'M' || letter === 'P') ? letter : 'other';
}

function kindFromTitle(title: string, hasTextLayer: boolean): SheetKind {
  if (!hasTextLayer) return 'other';
  const t = title.toUpperCase();
  if (/SCHEDULE/.test(t)) return 'schedule';
  if (/RISER/.test(t)) return 'riser';
  if (/COVER|TITLE\s*SHEET|INDEX/.test(t)) return 'cover';
  if (/DETAIL/.test(t)) return 'detail';
  return 'plan';
}

/** Non-whitespace text items only — pdfjs inserts synthetic whitespace-only
 *  items between words it detects a gap before; they're noise for both the
 *  has_text_layer check and the title-block strip scan. */
function meaningfulItems(items: PdfJsTextItem[]): PdfJsTextItem[] {
  return items.filter(i => i.str.trim().length > 0);
}

export interface ExtractedPageInfo {
  width_pt: number;
  height_pt: number;
  rotation: number;
  has_text_layer: boolean;
  sheet_no: string;
  title: string;
  discipline: SheetDiscipline;
  kind: SheetKind;
  /** Fix round 1 / B7 — the parsed scale is ALWAYS a suggestion now; the
   *  indexer never writes to est_sheets.ft_per_pt/scale_source/scale_label
   *  itself (see upsertSheetPage). null when scale_ambiguous is true. */
  suggested_label: string | null;
  suggested_ft_per_pt: number | null;
  scale_ambiguous: boolean;
}

/** Pure-ish (no DB/network — everything it needs is already on the pdfjs
 *  page object) per-page extraction: geometry, text-layer presence, and the
 *  title-block-derived sheet_no/title/scale guess. Exported directly so
 *  tests can exercise it against a fixture PDF without a DB. */
export async function extractPageInfo(doc: PdfJsDocument, pageIndex: number): Promise<ExtractedPageInfo> {
  const page = await doc.getPage(pageIndex + 1);
  const [x0, y0, x1, y1] = page.view;
  const width_pt = Math.abs(x1 - x0);
  const height_pt = Math.abs(y1 - y0);
  const rotation = ((page.rotate % 360) + 360) % 360;

  const textContent = await page.getTextContent();
  const items = meaningfulItems(textContent.items);
  const has_text_layer = items.length > 0;

  // ai/pageClassifier.ts's titleBlockCropRect is pixel-space in its own
  // module (a rasterized crop), but it's purely a ratio of width/height —
  // applying it directly to PDF point-space geometry is the same reuse the
  // plan asks for ("reuse ... its right-strip heuristic"), just on text
  // item x-coordinates instead of image pixels.
  const stripRect = titleBlockCropRect(width_pt, height_pt);
  const stripItems = items.filter(i => (i.transform[4] ?? 0) >= stripRect.left);

  let sheet_no = '';
  let sheetNoItem: PdfJsTextItem | undefined;
  for (const item of stripItems) {
    if (SHEET_NO_RE.test(item.str.trim())) {
      sheet_no = item.str.trim().toUpperCase();
      sheetNoItem = item;
      break;
    }
  }

  // Title: the longest strip text that isn't the sheet_no itself and isn't
  // scale-label-shaped (title blocks commonly print the scale right next to
  // the sheet title, in the same strip).
  let title = '';
  for (const item of stripItems) {
    if (item === sheetNoItem) continue;
    const trimmed = item.str.trim();
    if (!trimmed) continue;
    if (/SCALE/i.test(trimmed) || findScaleLabel(trimmed)) continue;
    if (trimmed.length > title.length) title = trimmed;
  }

  // Fix round 1 / B7 — every DISTINCT scale value anywhere on the page,
  // first: a page with more than one (an enlarged-detail callout's own
  // "SCALE: 1/4" = 1'-0"" alongside the main plan's real scale) can never
  // safely offer a single one-click suggestion — scale_ambiguous covers
  // that case regardless of where either cue sits in content-stream order.
  const fullText = items.map(i => i.str).join('\n');
  const allScales = findAllScaleLabels(fullText);
  const scale_ambiguous = allScales.length > 1;

  // Otherwise, prefer the TITLE BLOCK STRIP's own scale cue over a
  // whole-page search — the strip is where a sheet's real, printed scale
  // for the MAIN plan actually lives; an unrelated "SCALE: ..." elsewhere
  // on the sheet (a detail, a note) must never win just because it
  // happens to appear earlier in the PDF's own content stream. Falls back
  // to the whole-page search only when the strip itself has no cue at all
  // (some sheet formats print the scale near the drawing, not the strip).
  const stripText = stripItems.map(i => i.str).join('\n');
  const scale = scale_ambiguous ? null : (findScaleLabel(stripText) ?? findScaleLabel(fullText));

  const discipline = disciplineFromSheetNo(sheet_no);
  const kind = kindFromTitle(title, has_text_layer);

  return {
    width_pt, height_pt, rotation, has_text_layer,
    sheet_no, title, discipline, kind,
    suggested_label: scale?.normalized ?? null,
    suggested_ft_per_pt: scale?.ftPerPt ?? null,
    scale_ambiguous,
  };
}

/** Upserts one document's pages into est_sheets.
 *
 *  Fix round 1 / B7 — the indexer NEVER writes ft_per_pt/scale_source/
 *  scale_label itself anymore (those three are confirmed-only, set
 *  exclusively by setSheetScale — an explicit one-click confirm or a
 *  two-point calibration). It only ever refreshes suggested_ft_per_pt/
 *  suggested_label/scale_ambiguous, which a re-index is free to update on
 *  every refresh (they're just the parser's current best guess, not a
 *  commitment) — half_size is intentionally left OUT of this upsert
 *  entirely so a re-index can never reset an estimator's own per-document
 *  toggle (setHalfSize, below, is its one and only writer). */
async function upsertSheetPage(bidId: string, documentId: string, pageIndex: number, info: ExtractedPageInfo): Promise<void> {
  await pool.query(
    `INSERT INTO est_sheets
       (bid_id, document_id, page_index, sheet_no, title, discipline, kind,
        width_pt, height_pt, rotation, has_text_layer, suggested_ft_per_pt, suggested_label, scale_ambiguous, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (document_id, page_index) DO UPDATE SET
       sheet_no = EXCLUDED.sheet_no,
       title = EXCLUDED.title,
       discipline = EXCLUDED.discipline,
       kind = EXCLUDED.kind,
       width_pt = EXCLUDED.width_pt,
       height_pt = EXCLUDED.height_pt,
       rotation = EXCLUDED.rotation,
       has_text_layer = EXCLUDED.has_text_layer,
       suggested_ft_per_pt = EXCLUDED.suggested_ft_per_pt,
       suggested_label = EXCLUDED.suggested_label,
       scale_ambiguous = EXCLUDED.scale_ambiguous,
       updated_at = now()`,
    [bidId, documentId, pageIndex, info.sheet_no, info.title, info.discipline, info.kind,
     info.width_pt, info.height_pt, info.rotation, info.has_text_layer,
     info.suggested_ft_per_pt, info.suggested_label, info.scale_ambiguous]
  );
}

/** Indexes every page of one plan PDF document into est_sheets. Never
 *  throws for a single bad/unreadable document (a corrupt PDF, a Drive
 *  fetch failure) — logs and returns 0 so one bad file in a 68-document
 *  plan set doesn't take down the whole bid's sheet list. */
async function indexDocument(bidId: string, doc: PlanDocument): Promise<number> {
  const buf = await fetchDocumentBuffer(doc);
  if (!buf) {
    logger.warn({ documentId: doc.id }, '[estimating/sheets] could not fetch document bytes — skipping');
    return 0;
  }
  let pdfDoc;
  try {
    pdfDoc = await openPdfDocument(buf);
  } catch (err) {
    logger.warn({ err, documentId: doc.id }, '[estimating/sheets] could not parse document as a PDF — skipping');
    return 0;
  }
  try {
    for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex++) {
      const info = await extractPageInfo(pdfDoc, pageIndex);
      await upsertSheetPage(bidId, doc.id, pageIndex, info);
    }
    return pdfDoc.numPages;
  } finally {
    await pdfDoc.destroy();
  }
}

/** Builds (first call) or rebuilds (refresh=true) every plan document's
 *  est_sheets rows for a bid. A calibrated scale always survives a refresh
 *  (see upsertSheetPage). */
export async function buildOrRefreshSheets(bidId: string): Promise<void> {
  const docs = await getPlanPdfDocuments(bidId);
  for (const doc of docs) {
    await indexDocument(bidId, doc);
  }
}

export async function getSheetRows(bidId: string): Promise<SheetRow[]> {
  const { rows } = await pool.query(
    `SELECT bid_id, document_id, page_index, sheet_no, title, discipline, kind,
            width_pt, height_pt, rotation, ft_per_pt, scale_source, scale_label, has_text_layer,
            suggested_ft_per_pt, suggested_label, scale_ambiguous, half_size
     FROM est_sheets WHERE bid_id = $1
     ORDER BY document_id, page_index`,
    [bidId]
  );
  return rows.map(r => ({
    bid_id: r.bid_id,
    document_id: r.document_id,
    page_index: Number(r.page_index),
    sheet_no: r.sheet_no,
    title: r.title,
    discipline: r.discipline,
    kind: r.kind,
    width_pt: Number(r.width_pt),
    height_pt: Number(r.height_pt),
    rotation: Number(r.rotation),
    ft_per_pt: r.ft_per_pt != null ? Number(r.ft_per_pt) : null,
    scale_source: r.scale_source,
    scale_label: r.scale_label,
    has_text_layer: !!r.has_text_layer,
    suggested_ft_per_pt: r.suggested_ft_per_pt != null ? Number(r.suggested_ft_per_pt) : null,
    suggested_label: r.suggested_label,
    scale_ambiguous: !!r.scale_ambiguous,
    half_size: !!r.half_size,
  }));
}

/** GET .../sheets — the route's whole "build on first call, cache after"
 *  contract in one function: only touches Drive/pdfjs when there's nothing
 *  cached yet, or the caller explicitly asked to refresh. */
export async function listSheets(bidId: string, opts: { refresh?: boolean } = {}): Promise<SheetRow[]> {
  const existing = await getSheetRows(bidId);
  if (existing.length === 0 || opts.refresh) {
    await buildOrRefreshSheets(bidId);
    return getSheetRows(bidId);
  }
  return existing;
}

export interface SetScaleInput {
  ft_per_pt: number;
  source: 'calibrated' | 'titleblock';
  label?: string | null;
}

/** PUT .../sheets/:documentId/:pageIndex/scale. Returns false when the
 *  (document_id, page_index) row doesn't exist for this bid (404). */
export async function setSheetScale(bidId: string, documentId: string, pageIndex: number, input: SetScaleInput): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE est_sheets SET ft_per_pt = $1, scale_source = $2, scale_label = $3, updated_at = now()
     WHERE bid_id = $4 AND document_id = $5 AND page_index = $6`,
    [input.ft_per_pt, input.source, input.label ?? null, bidId, documentId, pageIndex]
  );
  return (rowCount ?? 0) > 0;
}

/** Fix round 1 / B7 — the "Half-size set?" toggle, per DOCUMENT (every
 *  sheet of that document_id shares one value — the physical print size
 *  is a property of the whole plan set PDF, not one page of it). Doubles
 *  (turning on) or halves (turning off) BOTH ft_per_pt and
 *  suggested_ft_per_pt on every sheet of the document in one statement —
 *  idempotent against being called twice with the same value (a row
 *  already at that half_size is left untouched by the CASE branches
 *  below), and never touches a row with no scale set yet (NULL stays
 *  NULL either way). Returns false when the document has no est_sheets
 *  rows for this bid at all (404 for the route). */
export async function setHalfSize(bidId: string, documentId: string, halfSize: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE est_sheets SET
       ft_per_pt = CASE
         WHEN ft_per_pt IS NULL THEN NULL
         WHEN half_size = $3 THEN ft_per_pt
         WHEN $3 = true THEN ft_per_pt * 2
         ELSE ft_per_pt / 2
       END,
       suggested_ft_per_pt = CASE
         WHEN suggested_ft_per_pt IS NULL THEN NULL
         WHEN half_size = $3 THEN suggested_ft_per_pt
         WHEN $3 = true THEN suggested_ft_per_pt * 2
         ELSE suggested_ft_per_pt / 2
       END,
       half_size = $3,
       updated_at = now()
     WHERE bid_id = $1 AND document_id = $2`,
    [bidId, documentId, halfSize]
  );
  return (rowCount ?? 0) > 0;
}

// ── Authenticated PDF streaming (GET .../sheets/:documentId/file) ──────────

export interface StreamedFile {
  stream: Readable;
  contentType: string;
  contentLength: number | null;
}

/** Streams a plan document's raw bytes WITHOUT buffering the whole file —
 *  plan sets can be 50-150MB (env facts). Mirrors routes/documents.ts's
 *  /:id/view three-way branch (Drive storage_url / other storage_url /
 *  DB-stored file_data), reusing the exact same Drive access path
 *  (getFileMedia) the rest of the app already trusts. Range requests are
 *  NOT forwarded to Drive in this pass — getFileMedia has no parameter for
 *  it today, and adding one touches every other caller of that shared
 *  helper; deferred to whenever the frontend viewer (Task 4) actually needs
 *  partial-content loading, so the two can be designed and tested together
 *  instead of guessing at the contract in isolation. Every response here is
 *  a full stream with `Cache-Control: private, no-store` (never a shared/
 *  public cache — the plan's own callout: "no caching headers that leak
 *  across users").
 */
export async function streamPlanDocument(doc: PlanDocument): Promise<StreamedFile | null> {
  const contentType = doc.file_type === 'application/pdf' ? 'application/pdf' : (doc.file_type || 'application/octet-stream');

  if (doc.storage_url) {
    const fileId = driveFileId(doc.storage_url);
    if (fileId) {
      const media = await getFileMedia(fileId);
      if (!media) return null;
      return { stream: media.stream, contentType: media.mimeType || contentType, contentLength: null };
    }
    try {
      const resp = await fetch(doc.storage_url);
      if (!resp.ok || !resp.body) return null;
      const stream = Readable.fromWeb(resp.body as import('stream/web').ReadableStream);
      const len = resp.headers.get('content-length');
      return { stream, contentType, contentLength: len ? Number(len) : null };
    } catch (err) {
      logger.error({ err, documentId: doc.id }, '[estimating/sheets] streamPlanDocument: storage fetch failed');
      return null;
    }
  }
  if (doc.file_data) {
    const buf = Buffer.from(doc.file_data, 'base64');
    return { stream: Readable.from(buf), contentType, contentLength: buf.length };
  }
  return null;
}
