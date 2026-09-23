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
import { SESSION_CLEARED_EVENT } from '../../../api/session';

const docCache = new Map<string, Promise<PdfJsDocument>>();

// Fix round 1 / N11 — this module-level cache used to survive a logout for
// the whole SPA session: a second person signing in on the same tab could
// read the first person's already-cached plan text with no fresh access
// check at all (getSheetTextItems never re-hits the API once a document is
// cached). session.ts fires SESSION_CLEARED_EVENT from clearSession()
// (both an explicit Logout and a 401-triggered signalUnauthorized go
// through it) — every cached pdf.js document is destroyed (releases its
// internal worker/canvas resources, same as PlanViewer.tsx's own
// loadedDocRef cleanup) and the cache is emptied. Importing session.ts
// here is safe (no cycle): session.ts itself imports nothing from this
// app, by design (see its own header comment). The `typeof window` guard
// matches push.ts/useIsMobile.ts/PlansWorkspace.tsx elsewhere in this
// codebase — this module can be imported under a plain Node test
// environment with no DOM at all, which never dispatches this event.
if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_CLEARED_EVENT, () => {
    const pending = Array.from(docCache.values());
    docCache.clear();
    for (const p of pending) {
      p.then(doc => { void doc.destroy(); }).catch(() => { /* never loaded — nothing to destroy */ });
    }
  });
}

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

/** Test-only escape hatch — production clears this cache on logout (see
 *  the SESSION_CLEARED_EVENT listener above), but a document's text never
 *  changes within one logged-in session, so each TEST still needs its own
 *  clean cache (independent of any logout) so mocked fetches/opens are
 *  observed per-test. */
export function __clearSheetTextCacheForTests() { docCache.clear(); }
