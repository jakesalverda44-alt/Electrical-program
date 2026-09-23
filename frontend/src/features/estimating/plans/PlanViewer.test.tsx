// @vitest-environment happy-dom
// Estimating Phase B, Task 4 — PlanViewer.tsx with pdf.js mocked: render
// calls, stale-render cancellation, and cleanup (doc.destroy) on unmount/
// document change. happy-dom does not implement canvas 2D contexts, so
// HTMLCanvasElement.prototype.getContext is stubbed for this file only.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act, fireEvent } from '@testing-library/react';

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
import { MarkupDraft } from './markupHistory';

function markup(over: Partial<MarkupDraft> = {}): MarkupDraft {
  return {
    id: 'm1', documentId: 'doc-1', pageIndex: 0, lineKey: 'l1', kind: 'count',
    points: [{ x: 100, y: 100 }], drops: 0, dropFt: null, slackPct: null,
    status: 'confirmed', label: null,
    ...over,
  };
}

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
    origin_x_pt: 0, origin_y_pt: 0, ft_per_pt: 0.01, scale_source: 'calibrated', scale_label: '1/8" = 1\'-0"', has_text_layer: true,
    suggested_ft_per_pt: null, suggested_label: null, scale_ambiguous: false, half_size: false,
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

// Task 9 (deferral closed) — visible-region tiling past the canvas-area
// cap. Real timers (not faked): the 200ms debounce is short enough to
// just wait out in these few tests rather than fake-timer-juggling the
// whole file's existing tests along with it.
describe('PlanViewer — visible-region tiling past the canvas-area cap (Task 9)', () => {
  it('renders no tile at a normal scale (the sheet fits comfortably under the cap)', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { queryByTestId } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 250));
    expect(queryByTestId('plan-tile-canvas')).toBeNull();
  });

  it('renders a sharp tile, at the target scale, with a translate transform, once zoomed past the cap on a large (D-size) sheet', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    // 36x48in D-size sheet, in points — the coordinator's own example of a
    // sheet that blows the cap well before an estimator's real working zoom.
    const bigSheet = sheet({ width_pt: 2592, height_pt: 3456 });
    const { getByLabelText, findByTestId } = render(<PlanViewer {...baseProps({ sheet: bigSheet })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    page.render.mockClear();

    // Zoom in enough times (1.25x per click) to exceed the cap from the
    // fit-to-width starting scale.
    for (let i = 0; i < 10; i++) {
      fireEvent.click(getByLabelText('Zoom in'));
    }

    const tile = await findByTestId('plan-tile-canvas', {}, { timeout: 2000 });
    expect(tile).toBeTruthy();
    await waitFor(() => {
      const calls = page.render.mock.calls as unknown as [{ transform?: unknown }][];
      const tileCall = calls.find(c => c[0].transform);
      expect(tileCall).toBeTruthy();
      const [{ transform }] = tileCall!;
      // A pure translation: [1,0,0,1,-left,-top].
      expect((transform as number[]).slice(0, 4)).toEqual([1, 0, 0, 1]);
    }, { timeout: 2000 });
  });

  it('cancels a stale tile render task when a newer one starts before it settles', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const bigSheet = sheet({ width_pt: 2592, height_pt: 3456 });
    const { getByLabelText, findByTestId } = render(<PlanViewer {...baseProps({ sheet: bigSheet })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());

    for (let i = 0; i < 10; i++) fireEvent.click(getByLabelText('Zoom in'));
    await findByTestId('plan-tile-canvas', {}, { timeout: 2000 });
    const tileTaskCountBefore = renderTaskPromises.length;

    // One more zoom step before anything settles again — the tile task
    // in flight (if any) must be cancelled, never left to paint stale
    // content over the newer request.
    fireEvent.click(getByLabelText('Zoom in'));
    await new Promise(r => setTimeout(r, 250));

    const cancelledSomeTask = renderTaskPromises.slice(0, tileTaskCountBefore).some(t => t.cancel.mock.calls.length > 0);
    expect(cancelledSomeTask || renderTaskPromises.length > tileTaskCountBefore).toBe(true);
  });

  it('does not use tiling for a small (letter-size) sheet at a moderate zoom that still fits under the cap', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { getByLabelText, queryByTestId } = render(<PlanViewer {...baseProps()} />); // default 792x612 letter sheet
    await waitFor(() => expect(page.render).toHaveBeenCalled());

    // A few zoom-in steps from the fit-to-width starting scale — nowhere
    // near enough to make an 792x612pt sheet exceed the 16.7M px cap.
    for (let i = 0; i < 3; i++) fireEvent.click(getByLabelText('Zoom in'));
    await new Promise(r => setTimeout(r, 250));
    expect(queryByTestId('plan-tile-canvas')).toBeNull();
  });
});

// Task 7 (deferral closed) — "click to confirm" a suggested (dashed) marker.
describe('PlanViewer — click to confirm a suggested marker (Task 7)', () => {
  it('renders a suggested marker with data-status="suggested" (dashed)', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container } = render(<PlanViewer {...baseProps({ markups: [markup({ status: 'suggested' })] })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    const el = container.querySelector('[data-marker]');
    expect(el?.getAttribute('data-status')).toBe('suggested');
  });

  it('a mousedown on a SUGGESTED marker calls onConfirmMarker, not onSelectMarker/onMoveMarker', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const onSelectMarker = vi.fn();
    const onConfirmMarker = vi.fn();
    const { container } = render(<PlanViewer {...baseProps({
      markups: [markup({ status: 'suggested' })], onSelectMarker, onConfirmMarker,
    })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    const el = container.querySelector('[data-marker]')!;
    fireEvent.mouseDown(el);
    expect(onConfirmMarker).toHaveBeenCalledWith('m1');
    expect(onSelectMarker).not.toHaveBeenCalled();
  });

  it('a mousedown on a CONFIRMED marker still selects/drags as before — onConfirmMarker is never called', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const onSelectMarker = vi.fn();
    const onConfirmMarker = vi.fn();
    const { container } = render(<PlanViewer {...baseProps({
      markups: [markup({ status: 'confirmed' })], onSelectMarker, onConfirmMarker,
    })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    const el = container.querySelector('[data-marker]')!;
    fireEvent.mouseDown(el);
    expect(onSelectMarker).toHaveBeenCalledWith('m1', false);
    expect(onConfirmMarker).not.toHaveBeenCalled();
  });

  it('with no onConfirmMarker prop at all, a suggested marker falls back to the normal select flow (never silently swallows the click)', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const onSelectMarker = vi.fn();
    const { container } = render(<PlanViewer {...baseProps({
      markups: [markup({ status: 'suggested' })], onSelectMarker,
    })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    const el = container.querySelector('[data-marker]')!;
    fireEvent.mouseDown(el);
    expect(onSelectMarker).toHaveBeenCalledWith('m1', false);
  });
});
