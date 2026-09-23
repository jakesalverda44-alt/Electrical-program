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
import { screenPosition, displayedSize } from './pageGeometry';

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
  /** Fix round 1 / S1 — this page's own MediaBox/CropBox origin, almost
   *  always (0, 0). See ExtractedPageInfo's own comment. */
  origin_x_pt: number;
  origin_y_pt: number;
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
 *  every other route in this router.
 *
 *  Fix round 1 / S4 — this comment used to claim "plans-category" but the
 *  query never actually checked it: ANY document linked to the bid (a W9,
 *  a contract, a spec PDF, a stray text/html upload) could be streamed
 *  through the "plan file" route by id, with routes/documents.ts's own
 *  Content-Type/Content-Disposition lockdown (Security #6) bypassed
 *  entirely — a category:'other' text/html document came back as a plain
 *  200 text/html with no Content-Disposition. Now filters exactly like
 *  getPlanPdfDocuments() above: plans-category AND (a real PDF file_type,
 *  or a .pdf name for older rows that never got file_type populated). */
export async function loadPlanDocumentForBid(bidId: string, documentId: string): Promise<PlanDocument | null> {
  const { rows } = await pool.query(
    `SELECT id, name, file_type, file_data, storage_url FROM documents
     WHERE id = $1 AND linked_id = $2 AND deleted_at IS NULL
       AND category = 'plans'
       AND (file_type = 'application/pdf' OR name ILIKE '%.pdf')`,
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
  /** Fix round 1 / S1 — the page's own MediaBox/CropBox origin (page.view's
   *  x0/y0). Almost always (0, 0) — pdf.js normalizes the overwhelming
   *  majority of real-world PDFs to start there — but a CAD-exported PDF
   *  can use any origin, and every stored/clicked marker point needs it to
   *  line up with what pdf.js itself renders (see overlay.ts's matching
   *  frontend-side fix). */
  origin_x_pt: number;
  origin_y_pt: number;
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
  //
  // Fix round 1 / S1 — this used to compare the item's RAW, unrotated,
  // origin-absolute x-coordinate straight against a strip boundary
  // computed purely from width_pt (0..width_pt). Two separate bugs: (1) a
  // non-zero origin (x0 != 0) means raw item x-coordinates live in
  // [x0, x0+width_pt], not [0, width_pt] — the strip boundary and the
  // coordinates being tested were in different coordinate systems
  // entirely; (2) "the right side of the title block, as printed" is a
  // property of the DISPLAYED (rotated) page, not the raw content-stream
  // x-axis — a page rotated 90 degrees has its title block's raw PDF
  // x-coordinate wherever the UNROTATED content happens to put it, which
  // has nothing to do with "the right 25% of the sheet as someone reads
  // it". pageGeometry.ts's screenPosition (the backend's own
  // reimplementation of overlay.ts's already-verified transform) fixes
  // both at once: compute each item's DISPLAYED position first, then
  // compare against a strip boundary computed from the DISPLAYED size.
  const displayed = displayedSize(width_pt, height_pt, rotation);
  const stripRect = titleBlockCropRect(displayed.width, displayed.height);
  const stripItems = items.filter(i => {
    const pos = screenPosition(i.transform[4] ?? 0, i.transform[5] ?? 0, x0, y0, width_pt, height_pt, rotation);
    return pos.x >= stripRect.left;
  });

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
    width_pt, height_pt, rotation, origin_x_pt: x0, origin_y_pt: y0, has_text_layer,
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
        width_pt, height_pt, rotation, origin_x_pt, origin_y_pt, has_text_layer, suggested_ft_per_pt, suggested_label, scale_ambiguous, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
     ON CONFLICT (document_id, page_index) DO UPDATE SET
       sheet_no = EXCLUDED.sheet_no,
       title = EXCLUDED.title,
       discipline = EXCLUDED.discipline,
       kind = EXCLUDED.kind,
       width_pt = EXCLUDED.width_pt,
       height_pt = EXCLUDED.height_pt,
       rotation = EXCLUDED.rotation,
       origin_x_pt = EXCLUDED.origin_x_pt,
       origin_y_pt = EXCLUDED.origin_y_pt,
       has_text_layer = EXCLUDED.has_text_layer,
       suggested_ft_per_pt = EXCLUDED.suggested_ft_per_pt,
       suggested_label = EXCLUDED.suggested_label,
       scale_ambiguous = EXCLUDED.scale_ambiguous,
       updated_at = now()`,
    [bidId, documentId, pageIndex, info.sheet_no, info.title, info.discipline, info.kind,
     info.width_pt, info.height_pt, info.rotation, info.origin_x_pt, info.origin_y_pt, info.has_text_layer,
     info.suggested_ft_per_pt, info.suggested_label, info.scale_ambiguous]
  );
}

/** Fix round 1 / B9 — hands control back to the event loop between pages.
 *  A big plan set's getTextContent()/text-item scan is CPU-bound JS work
 *  (not I/O), so the `await`s already in this loop (DB upserts) aren't
 *  enough on their own to guarantee a yield if a future change ever moved
 *  upsertSheetPage off the hot path — an explicit yield makes "index a
 *  150-page set never blocks this process for more than one page's worth
 *  of work at a time" true by construction, not by accident of today's
 *  call shape. setImmediate (not setTimeout(0) or a microtask) — it runs
 *  after I/O callbacks already queued, which is what actually keeps other
 *  requests (a concurrent GET /markups, a health check) responsive. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
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
      await yieldToEventLoop();
    }
    return pdfDoc.numPages;
  } finally {
    await pdfDoc.destroy();
  }
}

// ── Fix round 1 / B9 — background indexing + per-document status ───────────
//
// GET /sheets used to index every plan PDF SYNCHRONOUSLY inside the request
// (a Drive download, a whole-file buffer, a pdfjs parse of every page) — a
// real 100-150MB set takes far longer than the frontend's 30s axios
// timeout, the browser shows "timeout of 30000ms exceeded" while the
// server keeps indexing in the background anyway, and a partial result (one
// bad document skipped, or the process restarting mid-set) became
// permanent since nothing ever re-tried it.
//
// Now: every plan PDF document gets a row in est_document_index_status
// (pending -> indexing -> done, or -> failed). GET /sheets NEVER awaits
// indexing itself — it (1) registers any newly-seen document as 'pending',
// (2) atomically claims every 'pending'/'failed' document (flips it to
// 'indexing' in the same statement, so two concurrent requests can't both
// kick off the same job), (3) fires the claimed jobs without awaiting them,
// and (4) immediately returns whatever est_sheets rows already exist plus
// the current status of every document. The client (PlansWorkspace.tsx)
// polls while anything is pending/indexing. A 'failed' document is always
// eligible to be re-claimed on the very next GET /sheets — never a
// permanent dead end.
export type IndexStatus = 'pending' | 'indexing' | 'done' | 'failed';

/** Registers a status row (defaulting to 'pending') for every plan PDF
 *  document that doesn't have one yet — covers a document uploaded after
 *  the bid's sheets were first opened. Never touches an EXISTING row (an
 *  in-progress or already-finished job is left alone). */
async function ensureIndexStatusRows(bidId: string, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  await pool.query(
    `INSERT INTO est_document_index_status (bid_id, document_id, status, updated_at)
     SELECT $1, d, 'pending', now() FROM unnest($2::uuid[]) AS d
     ON CONFLICT (bid_id, document_id) DO NOTHING`,
    [bidId, documentIds]
  );
}

/** "Refresh sheets" — resets every document back to 'pending' so it's
 *  re-claimed on this same call, even one that's already 'done'. A
 *  document currently mid-'indexing' is left alone (its own in-flight job
 *  will mark it 'done'/'failed' when it finishes; resetting it here would
 *  let a second job claim it concurrently). */
async function resetIndexStatusForRefresh(bidId: string, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  await pool.query(
    `UPDATE est_document_index_status SET status = 'pending', error = NULL, updated_at = now()
     WHERE bid_id = $1 AND document_id = ANY($2::uuid[]) AND status != 'indexing'`,
    [bidId, documentIds]
  );
}

/** Atomically claims every 'pending' document among the given ids for
 *  indexing — the UPDATE's own WHERE clause is the compare-and-set: only a
 *  row still 'pending' gets flipped to 'indexing' and returned, so two
 *  overlapping GET /sheets calls can never both start a job for the same
 *  document.
 *
 *  Deliberately does NOT reclaim 'failed' documents here — only
 *  resetIndexStatusForRefresh (an explicit `?refresh=1`, the "Refresh
 *  sheets" button) puts a failed document back to 'pending' so it becomes
 *  eligible again. If a plain (unrefreshed) GET silently re-claimed
 *  'failed' too, the very next poll after a failure would immediately flip
 *  it back to 'indexing' before any caller ever got to SEE 'failed' —
 *  the estimator would have no visible "this one didn't work" state and no
 *  reason to notice or click Refresh, and a persistently-down Drive link
 *  would be hammered on every single poll tick instead of once per
 *  explicit retry. */
async function claimDocumentsForIndexing(bidId: string, documentIds: string[]): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const { rows } = await pool.query(
    `UPDATE est_document_index_status SET status = 'indexing', updated_at = now()
     WHERE bid_id = $1 AND document_id = ANY($2::uuid[]) AND status = 'pending'
     RETURNING document_id`,
    [bidId, documentIds]
  );
  return rows.map(r => r.document_id as string);
}

async function markIndexDone(bidId: string, documentId: string, pageCount: number): Promise<void> {
  await pool.query(
    `UPDATE est_document_index_status SET status = 'done', error = NULL, page_count = $3, updated_at = now()
     WHERE bid_id = $1 AND document_id = $2`,
    [bidId, documentId, pageCount]
  );
}

async function markIndexFailed(bidId: string, documentId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE est_document_index_status SET status = 'failed', error = $3, updated_at = now()
     WHERE bid_id = $1 AND document_id = $2`,
    [bidId, documentId, error.slice(0, 2000)]
  );
}

/** Fire-and-forget — GET /sheets must respond immediately with whatever's
 *  already there; it never awaits this. Each document indexes and updates
 *  its own status independently, so one slow/corrupt document never delays
 *  another's 'done' from landing. */
function runClaimedIndexingInBackground(bidId: string, docs: PlanDocument[]): void {
  for (const doc of docs) {
    void (async () => {
      try {
        const pageCount = await indexDocument(bidId, doc);
        await markIndexDone(bidId, doc.id, pageCount);
      } catch (err) {
        logger.error({ err, documentId: doc.id }, '[estimating/sheets] background indexing failed');
        await markIndexFailed(bidId, doc.id, err instanceof Error ? err.message : String(err));
      }
    })();
  }
}

export async function getIndexStatuses(bidId: string): Promise<Record<string, IndexStatus>> {
  const { rows } = await pool.query(
    `SELECT document_id, status FROM est_document_index_status WHERE bid_id = $1`,
    [bidId]
  );
  const out: Record<string, IndexStatus> = {};
  for (const r of rows) out[r.document_id as string] = r.status as IndexStatus;
  return out;
}

export async function getSheetRows(bidId: string): Promise<SheetRow[]> {
  const { rows } = await pool.query(
    `SELECT bid_id, document_id, page_index, sheet_no, title, discipline, kind,
            width_pt, height_pt, rotation, origin_x_pt, origin_y_pt, ft_per_pt, scale_source, scale_label, has_text_layer,
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
    origin_x_pt: r.origin_x_pt != null ? Number(r.origin_x_pt) : 0,
    origin_y_pt: r.origin_y_pt != null ? Number(r.origin_y_pt) : 0,
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

export interface ListSheetsResult {
  sheets: SheetRow[];
  /** Fix round 1 / B9 — per plan PDF document_id. The client polls (see
   *  PlansWorkspace.tsx) while any value here is 'pending'/'indexing'. */
  statuses: Record<string, IndexStatus>;
}

/** GET .../sheets — NEVER blocks on indexing (Fix round 1 / B9). Registers
 *  any newly-seen document as 'pending', claims + kicks off (fire-and-
 *  forget) every 'pending' document, and returns immediately with
 *  whatever est_sheets rows already exist plus every document's current
 *  status. `refresh` (the "Refresh sheets" button — an explicit,
 *  one-time action, never sent on every poll tick) resets EVERY document
 *  (including 'done' and 'failed' ones) back to 'pending' first, so this
 *  same claim step picks them all up again. */
export async function listSheets(bidId: string, opts: { refresh?: boolean } = {}): Promise<ListSheetsResult> {
  const docs = await getPlanPdfDocuments(bidId);
  const documentIds = docs.map(d => d.id);
  await ensureIndexStatusRows(bidId, documentIds);
  if (opts.refresh) await resetIndexStatusForRefresh(bidId, documentIds);

  const claimedIds = await claimDocumentsForIndexing(bidId, documentIds);
  if (claimedIds.length > 0) {
    const claimedSet = new Set(claimedIds);
    runClaimedIndexingInBackground(bidId, docs.filter(d => claimedSet.has(d.id)));
  }

  const [sheets, statuses] = await Promise.all([getSheetRows(bidId), getIndexStatuses(bidId)]);
  return { sheets, statuses };
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
