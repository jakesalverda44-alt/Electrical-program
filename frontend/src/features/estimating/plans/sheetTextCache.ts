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
// if profiling ever shows it matters — NOT done in this round (Fix round 1
// / S9): a full shared-cache merge with PlanViewer.tsx's own load/render/
// unmount lifecycle was judged too large and too risky to that already-
// tested, already-shipped code (this round's own N7/S10/N2 fixes) to take
// on with the budget remaining; disclosed explicitly, not silently
// dropped. What S9 DOES fix here, self-contained to this module: this
// cache used to keep every document ever text-searched open (with its own
// pdf.js worker) for the WHOLE SPA session, never evicting anything short
// of a full logout — "Find tag on sheets…" alone can open every plan
// document in the bid in one search. Now an LRU of MAX_CACHED_DOCS.
import api from '../../../api/client';
import { openPdfDocument, PdfJsDocument } from './pdfjsClient';
import { TextItem } from './tagSuggest';
import { SESSION_CLEARED_EVENT } from '../../../api/session';

// Fix round 1 / S9 — 2, matching the review's own "LRU of 1-2 documents"
// ask. A `Map` already preserves insertion order; touchEntry (below) moves
// an entry to the END on every access, so the FRONT is always the true
// least-recently-USED entry (not just least-recently-inserted) once one
// needs evicting.
const MAX_CACHED_DOCS = 2;

// Fix round 2 / R2-N2 — the original version destroyed an evicted entry
// the instant its promise resolved, with no regard for whether a DIFFERENT
// concurrent caller was still mid getPage()/getTextContent() on that exact
// document object. "Find tag on sheets…" walks its own documents
// sequentially, but "Suggest markers for this sheet/line" is a SEPARATE
// action the estimator can trigger at the same time — nothing stopped that
// from reading a 3rd+ distinct document, pushing a document find-tag was
// still actively reading out of the LRU and destroying it underneath that
// read (pdf.js then throws or returns garbage from the destroyed document,
// which find-tag's own per-sheet try/catch silently swallowed — a sheet
// just vanishing from the results with no explanation). Separately, an
// entry whose fetch was STILL IN FLIGHT (not yet resolved to a document at
// all) when evicted just got silently orphaned — the 100-150MB download
// kept running to completion for nothing, only to be destroyed the instant
// it finally landed.
//
// Fix: each entry tracks a live reference count, incremented only once its
// document is actually open and a caller is reading pages from it (NOT
// during the raw fetch — see refCount's own comment), and decremented when
// that read finishes. An eviction never destroys/aborts an entry with
// refCount > 0; it's marked `removedFromCache` instead, and whichever
// caller's `finally` block is the one that drops refCount back to 0
// performs the actual destroy/abort at that point. An entry whose fetch is
// still pending when evicted (refCount is necessarily 0 then — nobody has
// gotten as far as reading a page from it yet) has its underlying request
// aborted immediately instead of left to complete uselessly.
interface CacheEntry {
  promise: Promise<PdfJsDocument>;
  abortController: AbortController;
  /** Set once `promise` resolves — see the `.then()` in createEntry.
   *  null while the fetch/open is still in flight. */
  doc: PdfJsDocument | null;
  /** Active getPage()/getTextContent() readers currently using `doc`. */
  refCount: number;
  /** True once this entry has been evicted (LRU) or the session was
   *  cleared — `doc` stays around, still readable by whoever already
   *  holds it, but is no longer reachable via a fresh acquireEntry() call
   *  for this documentId, and gets destroyed/aborted as soon as refCount
   *  reaches 0. */
  removedFromCache: boolean;
}

const docCache = new Map<string, CacheEntry>();

/** Destroys the resolved document, or aborts the still-in-flight fetch —
 *  whichever applies — but only when nobody is actively reading it right
 *  now (refCount === 0). Safe to call more than once for the same entry
 *  (an already-destroyed/aborted entry's abortController.abort() or
 *  doc.destroy() call is a harmless no-op) — callers don't need to track
 *  whether they already did this. */
function destroyOrAbort(entry: CacheEntry): void {
  if (entry.refCount > 0) return; // still being actively read — the reader's own release will finish this
  if (entry.doc) {
    void entry.doc.destroy();
  } else {
    entry.abortController.abort(); // still fetching/opening — cancel it, nothing to destroy yet
  }
}

/** Moves `key` to the end of the Map (most-recently-used) and evicts the
 *  LEAST-recently-used entries past MAX_CACHED_DOCS — `removedFromCache`
 *  plus destroyOrAbort (deferred if still in active use), never an
 *  unconditional destroy (see this module's own R2-N2 comment above). */
function touchEntry(key: string, entry: CacheEntry): void {
  docCache.delete(key);
  docCache.set(key, entry);
  while (docCache.size > MAX_CACHED_DOCS) {
    const oldestKey = docCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = docCache.get(oldestKey)!;
    docCache.delete(oldestKey);
    evicted.removedFromCache = true;
    destroyOrAbort(evicted);
  }
}

function createEntry(bidId: string, documentId: string): CacheEntry {
  const abortController = new AbortController();
  const entry: CacheEntry = {
    // Assigned synchronously right below — TypeScript can't see that, so
    // this placeholder keeps `entry` referenceable from inside the .then()
    // that needs to write back to `entry.doc`.
    promise: undefined as unknown as Promise<PdfJsDocument>,
    abortController,
    doc: null,
    refCount: 0,
    removedFromCache: false,
  };
  entry.promise = api
    // Fix round 1 / B9 — same fix as PlanViewer.tsx's own file GET: the
    // global 30s axios timeout (api/client.ts) covers this whole
    // transfer too, and a 100-150MB plan set can legitimately take
    // longer than that on a slow link. Fix round 2 / R2-N2 — `signal`
    // is what actually lets an eviction stop a fetch nobody wants
    // anymore, the same AbortController pattern PlanViewer.tsx's own
    // file GET already uses (N7).
    .get<ArrayBuffer>(`/estimating/${bidId}/sheets/${documentId}/file`, {
      responseType: 'arraybuffer', timeout: 0, signal: abortController.signal,
    })
    .then(res => openPdfDocument(res.data))
    .then(doc => { entry.doc = doc; return doc; });
  // A failed fetch/parse (including an abort) must not poison the cache
  // forever — the next caller gets a fresh attempt rather than a
  // permanently-rejected entry. Only cleans up the cache MAP slot (nothing
  // to destroy — doc never resolved); if this entry was already evicted,
  // docCache no longer holds it under this key at all, so this is a no-op.
  entry.promise.catch(() => { if (docCache.get(documentId) === entry) docCache.delete(documentId); });
  return entry;
}

/** Gets (creating or reusing) the cache entry for this document and
 *  promotes it to most-recently-used. Does NOT ref-count — that's
 *  acquired separately, only once a caller actually starts reading pages
 *  (see getSheetTextItems) — otherwise every in-flight fetch would be
 *  permanently un-abortable simply because its own original caller is
 *  still awaiting it, which defeats the whole point of aborting an
 *  evicted-while-still-fetching entry. */
function acquireEntry(bidId: string, documentId: string): CacheEntry {
  let entry = docCache.get(documentId);
  // A cache MISS, or a same-key entry that was evicted (removedFromCache)
  // but hasn't finished being torn down yet because someone's still
  // reading it — either way, don't hand out a doomed/stale entry; start a
  // fresh fetch. (The old evicted entry, once its own last reader
  // releases it, still gets torn down normally — this doesn't leak it.)
  if (!entry || entry.removedFromCache) {
    entry = createEntry(bidId, documentId);
  }
  touchEntry(documentId, entry);
  return entry;
}

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
    const entries = Array.from(docCache.values());
    docCache.clear();
    for (const entry of entries) {
      entry.removedFromCache = true;
      destroyOrAbort(entry);
    }
  });
}

interface RawTextItem { str?: string; transform?: number[]; width?: number; height?: number }

/** Every non-empty text item on one page, in the exact shape tagSuggest.ts's
 *  suggestTagMarkers expects. Filters out pdf.js's synthetic whitespace-only
 *  items (mirrors backend/src/estimating/sheets.ts's own meaningfulItems). */
export async function getSheetTextItems(bidId: string, documentId: string, pageIndex: number): Promise<TextItem[]> {
  const entry = acquireEntry(bidId, documentId);
  const doc = await entry.promise; // may reject if this entry was evicted-and-aborted while still fetching
  // Fix round 2 / R2-N2 — refCount only starts protecting `doc` from
  // destruction from HERE — once it's actually open and about to be read.
  // Guaranteed not to race destroyOrAbort: nothing awaits between the line
  // above resolving and this increment, so no eviction can run in between.
  entry.refCount++;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    return (content.items as RawTextItem[])
      .filter((it): it is { str: string; transform: number[]; width?: number; height?: number } =>
        typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
      .map(it => ({ str: it.str, transform: it.transform, width: it.width, height: it.height }));
  } finally {
    entry.refCount--;
    // This entry may have been evicted WHILE this read was in flight — if
    // so, and nobody else is reading it either, this is the moment to
    // finally tear it down (deferred exactly until now, not sooner).
    if (entry.removedFromCache) destroyOrAbort(entry);
  }
}

/** Test-only escape hatch — production clears this cache on logout (see
 *  the SESSION_CLEARED_EVENT listener above), but a document's text never
 *  changes within one logged-in session, so each TEST still needs its own
 *  clean cache (independent of any logout) so mocked fetches/opens are
 *  observed per-test. */
export function __clearSheetTextCacheForTests() { docCache.clear(); }
