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
