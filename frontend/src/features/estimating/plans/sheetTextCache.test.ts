// Estimating Phase B, Task 7 (deferral closed) — sheetTextCache.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
