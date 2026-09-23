// @vitest-environment happy-dom
// Estimating Phase B, Task 4 — PlanViewer.tsx with pdf.js mocked: render
// calls, stale-render cancellation, and cleanup (doc.destroy) on unmount/
// document change. happy-dom does not implement canvas 2D contexts, so
// HTMLCanvasElement.prototype.getContext is stubbed for this file only.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => get(...a) } };
});

const renderTaskPromises: { resolve: () => void; reject: (e: unknown) => void; cancel: ReturnType<typeof vi.fn> }[] = [];
const getPage = vi.fn();
const docDestroy = vi.fn().mockResolvedValue(undefined);
const openPdfDocument = vi.fn();
vi.mock('./pdfjsClient', () => ({
  openPdfDocument: (...a: unknown[]) => openPdfDocument(...a),
}));

import PlanViewer from './PlanViewer';
import { SheetRow } from '../types';
import { initToolState } from './toolMachine';

function makeRenderTask() {
  let resolveFn!: () => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolveFn = res; rejectFn = rej; });
  const cancel = vi.fn();
  const task = { promise, cancel };
  renderTaskPromises.push({ resolve: resolveFn, reject: rejectFn, cancel });
  return task;
}

function makePage() {
  const render = vi.fn(() => makeRenderTask());
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 792 * scale, height: 612 * scale })),
    render,
  };
}

function sheet(over: Partial<SheetRow> = {}): SheetRow {
  return {
    bid_id: 'bid1', document_id: 'doc-1', page_index: 0, sheet_no: 'E1.1', title: 'Lighting Plan',
    discipline: 'E', kind: 'plan', width_pt: 792, height_pt: 612, rotation: 0,
    ft_per_pt: 0.01, scale_source: 'calibrated', scale_label: '1/8" = 1\'-0"', has_text_layer: true,
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
  getPage.mockReset();
  docDestroy.mockReset().mockResolvedValue(undefined);
  openPdfDocument.mockReset();
  renderTaskPromises.length = 0;
  get.mockResolvedValue({ data: new ArrayBuffer(8) });
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({}) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function baseProps(over: Partial<React.ComponentProps<typeof PlanViewer>> = {}) {
  return {
    bidId: 'bid1',
    documentId: 'doc-1',
    pageIndex: 0,
    sheet: sheet(),
    toolState: initToolState(),
    dispatchTool: vi.fn(),
    markups: [],
    colorForLine: () => '#4D8DF7',
    onSelectMarker: vi.fn(),
    onMoveMarker: vi.fn(),
    ...over,
  };
}

describe('PlanViewer — load + render', () => {
  it('fetches the document bytes, opens it, and renders page 1 at the initial scale', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    render(<PlanViewer {...baseProps()} />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/estimating/bid1/sheets/doc-1/file',
      expect.objectContaining({ responseType: 'arraybuffer' })
    ));
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(1)); // pageIndex 0 -> pdf.js page 1
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
  });

  it('shows an error state when the file fetch fails', async () => {
    get.mockRejectedValue(new Error('network down'));
    const { getByRole } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(getByRole('alert')).toBeTruthy());
  });
});

describe('PlanViewer — stale render cancellation', () => {
  it('cancels the in-flight render task when the page changes before it settles', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    const { rerender } = render(<PlanViewer {...baseProps({ pageIndex: 0 })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));

    // A second page navigation arrives before the first render's promise
    // has resolved — the first render task must be cancelled.
    act(() => { rerender(<PlanViewer {...baseProps({ pageIndex: 1 })} />); });
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    expect(renderTaskPromises[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('a cancelled render task rejecting with RenderingCancelledException does not surface as an error', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    const { rerender, queryByRole } = render(<PlanViewer {...baseProps({ pageIndex: 0 })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    act(() => { rerender(<PlanViewer {...baseProps({ pageIndex: 1 })} />); });
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));

    const cancelledError = { name: 'RenderingCancelledException' };
    await act(async () => { renderTaskPromises[0].reject(cancelledError); await Promise.resolve(); });
    expect(queryByRole('alert')).toBeNull(); // no error state from the expected cancellation
  });
});

describe('PlanViewer — cleanup', () => {
  it('destroys the pdf document on unmount', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    const { unmount } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(1));
    unmount();
    expect(docDestroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the previous document (not the same one) when documentId changes', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    const destroyA = vi.fn().mockResolvedValue(undefined);
    const destroyB = vi.fn().mockResolvedValue(undefined);
    openPdfDocument
      .mockResolvedValueOnce({ getPage, destroy: destroyA })
      .mockResolvedValueOnce({ getPage, destroy: destroyB });

    const { rerender } = render(<PlanViewer {...baseProps({ documentId: 'doc-1' })} />);
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(1));

    act(() => { rerender(<PlanViewer {...baseProps({ documentId: 'doc-2', sheet: sheet({ document_id: 'doc-2' }) })} />); });
    await waitFor(() => expect(destroyA).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(2));
  });

  it('does NOT re-fetch or re-open the document for a page-index-only change (same documentId)', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    const { rerender } = render(<PlanViewer {...baseProps({ pageIndex: 0 })} />);
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(1));
    act(() => { rerender(<PlanViewer {...baseProps({ pageIndex: 1 })} />); });
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
    expect(openPdfDocument).toHaveBeenCalledTimes(1); // still just once — same PDF file, no re-fetch
  });
});
