// Estimating Phase B, Task 7 (deferral closed) — fetches a sheet's PDF text
// layer (for tag-suggestion search) independently of PlanViewer's own
// rendering pipeline. PlanViewer already loads/renders a page via pdf.js,
// but it doesn't expose text content to its parent — "Suggest markers for
// this sheet"/"this line" and "Find tag on sheets…" (PlansWorkspace) need
// text from sheets that may not even be the CURRENT sheet, so this module
// keeps its own small per-document cache rather than reaching into
// PlanViewer's internals.
//
// Known tradeoff (documented, not silently accepted): when the estimator
// runs a suggest action on the sheet they're currently viewing, this fetches
// the same PDF bytes PlanViewer already fetched for rendering — a second
// network request for the same document. Acceptable for Phase B (this is an
// on-demand, user-initiated action, not something that runs on every
// render/scroll), flagged as a follow-up to share one cache between the two
// if profiling ever shows it matters.
import api from '../../../api/client';
import { openPdfDocument, PdfJsDocument } from './pdfjsClient';
import { TextItem } from './tagSuggest';

const docCache = new Map<string, Promise<PdfJsDocument>>();

function loadDoc(bidId: string, documentId: string): Promise<PdfJsDocument> {
  let pending = docCache.get(documentId);
  if (!pending) {
    pending = api
      // Fix round 1 / B9 — same fix as PlanViewer.tsx's own file GET: the
      // global 30s axios timeout (api/client.ts) covers this whole
      // transfer too, and a 100-150MB plan set can legitimately take
      // longer than that on a slow link.
      .get<ArrayBuffer>(`/estimating/${bidId}/sheets/${documentId}/file`, { responseType: 'arraybuffer', timeout: 0 })
      .then(res => openPdfDocument(res.data));
    docCache.set(documentId, pending);
    // A failed fetch/parse must not poison the cache forever — the next
    // caller gets a fresh attempt rather than a permanently-rejected entry.
    pending.catch(() => { if (docCache.get(documentId) === pending) docCache.delete(documentId); });
  }
  return pending;
}

interface RawTextItem { str?: string; transform?: number[]; width?: number; height?: number }

/** Every non-empty text item on one page, in the exact shape tagSuggest.ts's
 *  suggestTagMarkers expects. Filters out pdf.js's synthetic whitespace-only
 *  items (mirrors backend/src/estimating/sheets.ts's own meaningfulItems). */
export async function getSheetTextItems(bidId: string, documentId: string, pageIndex: number): Promise<TextItem[]> {
  const doc = await loadDoc(bidId, documentId);
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  return (content.items as RawTextItem[])
    .filter((it): it is { str: string; transform: number[]; width?: number; height?: number } =>
      typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
    .map(it => ({ str: it.str, transform: it.transform, width: it.width, height: it.height }));
}

/** Test-only escape hatch — production code never needs to clear this
 *  (a document's text never changes within a session), but each test needs
 *  a clean cache so mocked fetches/opens are observed per-test. */
export function __clearSheetTextCacheForTests() { docCache.clear(); }
