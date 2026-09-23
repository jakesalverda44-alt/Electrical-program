// @vitest-environment happy-dom
// Estimating Phase B, Task 7 (deferral closed) — sheetTextCache.ts.
// happy-dom (not the repo's default 'node' env) — Fix round 1 / N11's own
// SESSION_CLEARED_EVENT listener needs a real `window` to dispatch against.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SESSION_CLEARED_EVENT } from '../../../api/session';

const get = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => get(...a) } };
});

const openPdfDocument = vi.fn();
vi.mock('./pdfjsClient', () => ({
  openPdfDocument: (...a: unknown[]) => openPdfDocument(...a),
}));

import { getSheetTextItems, __clearSheetTextCacheForTests } from './sheetTextCache';

function makeDoc(pages: Record<number, { str?: string; transform?: number[]; width?: number; height?: number }[]>) {
  return {
    getPage: vi.fn((n: number) => Promise.resolve({
      getTextContent: () => Promise.resolve({ items: pages[n] ?? [] }),
    })),
    // Fix round 1 / N11 — every real PdfJsDocument has a destroy(); the
    // SESSION_CLEARED_EVENT listener calls it on every cached document.
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  get.mockReset();
  openPdfDocument.mockReset();
  __clearSheetTextCacheForTests();
  get.mockResolvedValue({ data: new ArrayBuffer(8) });
});

describe('getSheetTextItems', () => {
  it('fetches the document bytes, opens it, and returns non-whitespace items for the requested page (1-indexed internally)', async () => {
    const doc = makeDoc({ 1: [{ str: 'A1', transform: [1, 0, 0, 1, 10, 20] }] });
    openPdfDocument.mockResolvedValue(doc);

    const items = await getSheetTextItems('bid1', 'doc-1', 0);

    expect(get).toHaveBeenCalledWith('/estimating/bid1/sheets/doc-1/file', expect.objectContaining({ responseType: 'arraybuffer' }));
    expect(doc.getPage).toHaveBeenCalledWith(1); // pageIndex 0 -> pdf.js page 1
    expect(items).toEqual([{ str: 'A1', transform: [1, 0, 0, 1, 10, 20], width: undefined, height: undefined }]);
  });

  it('filters out whitespace-only and malformed items', async () => {
    const doc = makeDoc({
      1: [
        { str: '   ', transform: [1, 0, 0, 1, 0, 0] },
        { str: '', transform: [1, 0, 0, 1, 0, 0] },
        { transform: [1, 0, 0, 1, 0, 0] }, // no str at all
        { str: 'REAL' }, // no transform
        { str: 'A1', transform: [1, 0, 0, 1, 5, 5] },
      ],
    });
    openPdfDocument.mockResolvedValue(doc);

    const items = await getSheetTextItems('bid1', 'doc-1', 0);
    expect(items.map(i => i.str)).toEqual(['A1']);
  });

  it('caches the opened document across multiple pages/calls for the same documentId — only one fetch/open', async () => {
    const doc = makeDoc({ 1: [{ str: 'A1', transform: [1, 0, 0, 1, 0, 0] }], 2: [{ str: 'B1', transform: [1, 0, 0, 1, 0, 0] }] });
    openPdfDocument.mockResolvedValue(doc);

    await getSheetTextItems('bid1', 'doc-1', 0);
    await getSheetTextItems('bid1', 'doc-1', 1);

    expect(get).toHaveBeenCalledTimes(1);
    expect(openPdfDocument).toHaveBeenCalledTimes(1);
  });

  it('fetches separately per distinct documentId', async () => {
    openPdfDocument.mockResolvedValue(makeDoc({ 1: [] }));

    await getSheetTextItems('bid1', 'doc-1', 0);
    await getSheetTextItems('bid1', 'doc-2', 0);

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not poison the cache on a failed fetch — a later call retries', async () => {
    get.mockRejectedValueOnce(new Error('network down'));
    await expect(getSheetTextItems('bid1', 'doc-1', 0)).rejects.toThrow('network down');

    get.mockResolvedValue({ data: new ArrayBuffer(8) });
    openPdfDocument.mockResolvedValue(makeDoc({ 1: [{ str: 'A1', transform: [1, 0, 0, 1, 0, 0] }] }));
    const items = await getSheetTextItems('bid1', 'doc-1', 0);
    expect(items.map(i => i.str)).toEqual(['A1']);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

// Fix round 1 / S9 — this cache used to keep every document ever text-
// searched open (with its own pdf.js worker) for the whole SPA session,
// never evicting anything short of a full logout.
describe('sheetTextCache — LRU eviction at MAX_CACHED_DOCS (S9)', () => {
  it('a 3rd distinct document evicts and destroys the LEAST-recently-used one (not the most recent)', async () => {
    const docA = makeDoc({ 1: [{ str: 'A', transform: [1, 0, 0, 1, 0, 0] }] });
    const docB = makeDoc({ 1: [{ str: 'B', transform: [1, 0, 0, 1, 0, 0] }] });
    const docC = makeDoc({ 1: [{ str: 'C', transform: [1, 0, 0, 1, 0, 0] }] });
    openPdfDocument.mockResolvedValueOnce(docA).mockResolvedValueOnce(docB).mockResolvedValueOnce(docC);

    await getSheetTextItems('bid1', 'doc-A', 0);
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-C', 0); // 3rd distinct document — doc-A (oldest, never re-touched) evicted

    await Promise.resolve(); // let the eviction's doc.destroy().then(...) microtask run
    expect(docA.destroy).toHaveBeenCalledTimes(1);
    expect(docB.destroy).not.toHaveBeenCalled();
    expect(docC.destroy).not.toHaveBeenCalled();

    // doc-A is gone from the cache — fetching it again is a fresh fetch.
    openPdfDocument.mockResolvedValueOnce(makeDoc({ 1: [] }));
    await getSheetTextItems('bid1', 'doc-A', 0);
    expect(get).toHaveBeenCalledTimes(4); // A, B, C, A-again
  });

  it('re-accessing a document promotes it to most-recently-used, protecting it from eviction', async () => {
    const docA = makeDoc({ 1: [{ str: 'A', transform: [1, 0, 0, 1, 0, 0] }] });
    const docB = makeDoc({ 1: [{ str: 'B', transform: [1, 0, 0, 1, 0, 0] }] });
    const docC = makeDoc({ 1: [{ str: 'C', transform: [1, 0, 0, 1, 0, 0] }] });
    openPdfDocument.mockResolvedValueOnce(docA).mockResolvedValueOnce(docB).mockResolvedValueOnce(docC);

    await getSheetTextItems('bid1', 'doc-A', 0);
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-A', 1); // re-touch A — now B is the least-recently-used, not A
    await getSheetTextItems('bid1', 'doc-C', 0); // 3rd distinct document — B evicted instead of A

    await Promise.resolve();
    expect(docB.destroy).toHaveBeenCalledTimes(1);
    expect(docA.destroy).not.toHaveBeenCalled();
  });

  it('never evicts while at or under the cap (2 documents stay cached indefinitely)', async () => {
    const docA = makeDoc({ 1: [] });
    const docB = makeDoc({ 1: [] });
    openPdfDocument.mockResolvedValueOnce(docA).mockResolvedValueOnce(docB);

    await getSheetTextItems('bid1', 'doc-A', 0);
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-A', 1);
    await getSheetTextItems('bid1', 'doc-B', 1);

    expect(docA.destroy).not.toHaveBeenCalled();
    expect(docB.destroy).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(2); // still just the original two fetches
  });
});

// Fix round 1 / N11 — a second person signing in on the same tab must
// never be able to read the previous user's already-cached plan text.
describe('sheetTextCache — cleared on logout (SESSION_CLEARED_EVENT, N11)', () => {
  it('a cached document is destroyed and the cache emptied when the session is cleared', async () => {
    const doc = makeDoc({ 1: [{ str: 'A1', transform: [1, 0, 0, 1, 0, 0] }] });
    openPdfDocument.mockResolvedValue(doc);
    await getSheetTextItems('bid1', 'doc-1', 0);
    expect(get).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event(SESSION_CLEARED_EVENT));
    await Promise.resolve(); // let the destroy().then(...) microtask run

    expect(doc.destroy).toHaveBeenCalledTimes(1);

    // The cache is empty — the SAME documentId is fetched fresh again.
    await getSheetTextItems('bid1', 'doc-1', 0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('clearing an empty cache (nothing ever loaded) is a harmless no-op', () => {
    expect(() => window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))).not.toThrow();
  });

  it('a document whose fetch/open is still in flight is dropped from the cache without throwing', async () => {
    get.mockReturnValueOnce(new Promise(() => { /* never settles */ }));
    void getSheetTextItems('bid1', 'doc-pending', 0).catch(() => {}); // fire and forget — intentionally left in flight

    expect(() => window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))).not.toThrow();
    await Promise.resolve();
  });
});

// Fix round 2 / R2-N2 — a 3rd+ distinct document (e.g. a concurrent
// "Suggest markers" action reading a different sheet than an in-progress
// "Find tag on sheets…" search) used to evict-and-destroy a document a
// DIFFERENT caller was still mid getTextContent() on — pdf.js then throws
// or returns garbage from the destroyed document, silently dropping that
// sheet from find-tag's results. Separately, an entry whose fetch was
// still in flight when evicted just ran to completion for nothing, wasting
// a 100-150MB download nobody would ever use.
describe('sheetTextCache — an eviction never destroys/aborts an entry someone is actively using (R2-N2)', () => {
  /** A never-resolves-until-released promise, so the test controls exactly
   *  when a "reader" finishes with a document — the only way to land a
   *  3rd document's eviction pressure WHILE a page's getTextContent() is
   *  still genuinely in flight. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
  }

  it('evicting a document another caller is mid-getTextContent() on does NOT destroy it until that read finishes', async () => {
    const gate = deferred<{ items: unknown[] }>();
    const docA = {
      getPage: vi.fn(() => Promise.resolve({ getTextContent: () => gate.promise })),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    const docB = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) })), destroy: vi.fn().mockResolvedValue(undefined) };
    const docC = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) })), destroy: vi.fn().mockResolvedValue(undefined) };
    openPdfDocument.mockResolvedValueOnce(docA).mockResolvedValueOnce(docB).mockResolvedValueOnce(docC);

    // Start reading A, but don't let its getTextContent() resolve yet —
    // this call is "in flight, mid-read" for the rest of the test.
    const readA = getSheetTextItems('bid1', 'doc-A', 0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // let it reach getTextContent() and suspend there

    // A DIFFERENT, concurrent caller reads B then C — 3 distinct documents
    // now wanted at once, pushing A (least-recently-touched) past the cap.
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-C', 0);

    // A was evicted from the cache, but its read is STILL in flight —
    // must not have been destroyed yet.
    expect(docA.destroy).not.toHaveBeenCalled();

    // Now let A's read finish.
    gate.resolve({ items: [{ str: 'A1', transform: [1, 0, 0, 1, 0, 0] }] });
    const items = await readA;
    expect(items.map(i => i.str)).toEqual(['A1']); // the read itself completed correctly, undamaged by the eviction

    // Only NOW, once the last active reader released it, is A destroyed.
    expect(docA.destroy).toHaveBeenCalledTimes(1);
  });

  it('re-acquiring a just-evicted-but-still-in-use document starts a genuinely fresh fetch, never reuses the doomed entry', async () => {
    const gate = deferred<{ items: unknown[] }>();
    const docA1 = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => gate.promise })), destroy: vi.fn().mockResolvedValue(undefined) };
    const docB = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) })), destroy: vi.fn().mockResolvedValue(undefined) };
    const docC = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) })), destroy: vi.fn().mockResolvedValue(undefined) };
    const docA2 = { getPage: vi.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [{ str: 'A-again', transform: [1, 0, 0, 1, 0, 0] }] }) })), destroy: vi.fn().mockResolvedValue(undefined) };
    openPdfDocument.mockResolvedValueOnce(docA1).mockResolvedValueOnce(docB).mockResolvedValueOnce(docC).mockResolvedValueOnce(docA2);

    const readA1 = getSheetTextItems('bid1', 'doc-A', 0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-C', 0); // evicts A while readA1 is still in flight

    // A fresh request for the SAME documentId while the old A entry is
    // still doomed-but-alive gets its own new fetch/open — never the
    // stale, about-to-be-destroyed entry.
    const items2 = await getSheetTextItems('bid1', 'doc-A', 0);
    expect(items2.map(i => i.str)).toEqual(['A-again']);
    expect(get).toHaveBeenCalledTimes(4); // A(1st), B, C, A(2nd) — a genuinely new fetch, not a reuse

    gate.resolve({ items: [] });
    await readA1;
  });
});

// Fix round 2 / R2-N2 — the SAME 3rd-document eviction pressure, but this
// time the evicted document's FETCH itself (not yet a doc, still
// downloading bytes) is still in flight — the underlying request must be
// aborted, not left to run to completion for a document nobody will ever
// read.
describe('sheetTextCache — an eviction aborts an entry whose fetch is still in flight, never lets it finish uselessly (R2-N2)', () => {
  it('aborts the underlying request for a document evicted before its fetch ever resolved', async () => {
    let capturedSignal: AbortSignal | undefined;
    get.mockImplementationOnce((_url: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise(() => { /* never settles on its own — only via the signal aborting */ });
    });
    void getSheetTextItems('bid1', 'doc-pending', 0).catch(() => {}); // A's fetch never resolves; intentionally unawaited

    expect(capturedSignal).toBeTruthy();
    expect(capturedSignal!.aborted).toBe(false);

    openPdfDocument.mockResolvedValueOnce(makeDoc({ 1: [] })).mockResolvedValueOnce(makeDoc({ 1: [] }));
    await getSheetTextItems('bid1', 'doc-B', 0);
    await getSheetTextItems('bid1', 'doc-C', 0); // 3rd distinct document — evicts doc-pending, still mid-fetch

    expect(capturedSignal!.aborted).toBe(true);
  });
});
