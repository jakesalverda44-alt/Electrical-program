// @vitest-environment happy-dom
// Estimating Phase B, Task 4 — PlanViewer.tsx with pdf.js mocked: render
// calls, stale-render cancellation, and cleanup (doc.destroy) on unmount/
// document change. happy-dom does not implement canvas 2D contexts, so
// HTMLCanvasElement.prototype.getContext is stubbed for this file only.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

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
import { fitScale, clampRenderScale, pdfToRenderMatrixWithOrigin, PageGeometry } from './overlay';

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

// Fix round 2 / R2-B1 — S1 (round 1) made STORING a click origin-aware but
// left DRAWING (this <g transform>) on the raw, zero-origin matrix: a
// marker stored at the correct pdf-space point got drawn hundreds of
// pixels away on any sheet whose MediaBox doesn't start at (0,0).
// overlay.test.ts proves the MATH (pdfToRenderMatrixWithOrigin) round-
// trips correctly in isolation; this proves PlanViewer.tsx's actual
// rendered <g> element uses that same origin-aware matrix, not the raw
// one — the exact regression this round's fix guards against reverting.
describe('PlanViewer — the rendered <g> transform is origin-aware (R2-B1 integration)', () => {
  it('the <g> transform matrix matches pdfToRenderMatrixWithOrigin, not the raw zero-origin matrix, on an offset-origin sheet', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    // MediaBox [100 200 712 992] — the review's own worked example.
    const offsetSheet = sheet({ width_pt: 612, height_pt: 792, origin_x_pt: 100, origin_y_pt: 200, rotation: 0 });
    const { container } = render(<PlanViewer {...baseProps({ sheet: offsetSheet })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));

    const g = container.querySelector('svg.plan-overlay-svg > g')!;
    const transformAttr = g.getAttribute('transform')!;
    const actualMatrix = transformAttr.match(/matrix\(([^)]+)\)/)![1].split(',').map(Number);

    // The same fit-to-width computation PlanViewer's own initial-fit
    // effect uses (happy-dom reports clientWidth 0, so the 900/700
    // fallback applies — matching PlanViewer.tsx's own `el.clientWidth
    // || 900` exactly).
    const geom: PageGeometry = { widthPt: 612, heightPt: 792, rotation: 0, originXPt: 100, originYPt: 200 };
    const expectedScale = clampRenderScale(geom, fitScale(geom, 900, 700, 'width'));
    const expectedMatrix = pdfToRenderMatrixWithOrigin(geom, expectedScale);

    for (let i = 0; i < 6; i++) expect(actualMatrix[i]).toBeCloseTo(expectedMatrix[i], 6);

    // And explicitly NOT the raw (origin-less) matrix — e/f would be
    // completely different (H*scale/0 instead of origin-shifted) if
    // PlanViewer regressed to importing pdfToRenderMatrix directly.
    expect(actualMatrix[4]).not.toBeCloseTo(0, 1);
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

// Fix round 1 / N7 — "The viewer's file GET has no AbortController.
// Switching documents keeps downloading the old 150MB in the background."
// Verified explicitly here (it was fixed as part of this round's B9 work,
// but had no dedicated test of its own).
describe('PlanViewer — the file GET has a real AbortController, and no fixed timeout (N7)', () => {
  it('sends timeout: 0 (no ceiling on the transfer) and an AbortSignal', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    render(<PlanViewer {...baseProps()} />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(
      '/estimating/bid1/sheets/doc-1/file',
      expect.objectContaining({ timeout: 0, signal: expect.any(AbortSignal) })
    ));
  });

  it('aborts the in-flight request\'s signal on unmount, before the fetch ever resolves', async () => {
    let resolveGet!: (v: { data: ArrayBuffer }) => void;
    get.mockReturnValueOnce(new Promise(res => { resolveGet = res; }));

    const { unmount } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const signal = (get.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);

    // The fetch resolving AFTER unmount must not crash or try to open a
    // document for an unmounted component (the existing `cancelled` guard
    // covers this; asserted here as a sanity check specific to this path).
    resolveGet({ data: new ArrayBuffer(8) });
    await Promise.resolve();
    expect(openPdfDocument).not.toHaveBeenCalled();
  });

  it('aborts the OLD document\'s in-flight request when documentId changes mid-fetch — never the new one', async () => {
    let resolveFirst!: (v: { data: ArrayBuffer }) => void;
    get.mockReturnValueOnce(new Promise(res => { resolveFirst = res; }));

    const { rerender } = render(<PlanViewer {...baseProps({ documentId: 'doc-1' })} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const firstSignal = (get.mock.calls[0][1] as { signal: AbortSignal }).signal;

    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    get.mockResolvedValueOnce({ data: new ArrayBuffer(8) }); // the SECOND (doc-2) request

    act(() => { rerender(<PlanViewer {...baseProps({ documentId: 'doc-2', sheet: sheet({ document_id: 'doc-2' }) })} />); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    const secondSignal = (get.mock.calls[1][1] as { signal: AbortSignal }).signal;

    expect(firstSignal.aborted).toBe(true); // the abandoned doc-1 fetch
    expect(secondSignal.aborted).toBe(false); // the live doc-2 fetch, untouched

    resolveFirst({ data: new ArrayBuffer(8) }); // resolving the stale one must not crash
    await waitFor(() => expect(openPdfDocument).toHaveBeenCalledTimes(1)); // only doc-2's
  });
});

// Fix round 1 / N2 — devicePixelRatio was never applied, so the base
// canvas's native pixel buffer matched its CSS display size 1:1 and
// rendered soft on a Retina screen. Verified here by comparing the
// canvas's NATIVE resolution (canvas.width, driven by devicePixelRatio)
// against its CSS-facing size (pageSize, which must stay dpr-independent
// — the fix must sharpen the raster, never change the displayed size).
describe('PlanViewer — canvas resolution scales with devicePixelRatio (N2)', () => {
  const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  afterEach(() => {
    if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr);
  });

  it('renders the base canvas at devicePixelRatio times the CSS-facing scale', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const page1x = makePage();
    getPage.mockResolvedValue(page1x);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { unmount } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page1x.render).toHaveBeenCalledTimes(1));
    const scale1x = (page1x.getViewport.mock.calls[0][0] as { scale: number }).scale;
    unmount();

    getPage.mockReset();
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    const page2x = makePage();
    getPage.mockResolvedValue(page2x);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page2x.render).toHaveBeenCalledTimes(1));
    const scale2x = (page2x.getViewport.mock.calls[0][0] as { scale: number }).scale;

    // Both renders fit the SAME (tiny, well under the canvas-area cap)
    // page into the same fallback container size, so the un-multiplied
    // "CSS-facing" scale is identical either way — only the NATIVE scale
    // (what actually reaches getViewport/canvas.width/height) should
    // differ, by exactly the dpr ratio.
    expect(scale2x).toBeCloseTo(scale1x * 2, 6);
  });

  it('the CSS-facing display size (pageSize) is unaffected by devicePixelRatio', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const page1x = makePage();
    getPage.mockResolvedValue(page1x);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container: c1, unmount } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page1x.render).toHaveBeenCalledTimes(1));
    const style1x = (c1.querySelector('canvas') as HTMLCanvasElement).style.width;
    unmount();

    getPage.mockReset();
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    const page3x = makePage();
    getPage.mockResolvedValue(page3x);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container: c3 } = render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page3x.render).toHaveBeenCalledTimes(1));
    const style3x = (c3.querySelector('canvas') as HTMLCanvasElement).style.width;

    expect(style3x).toBe(style1x); // identical CSS box either way
  });

  it('a missing/invalid devicePixelRatio falls back to 1, not NaN/0', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true });
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    render(<PlanViewer {...baseProps()} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scale = (page.getViewport.mock.calls[0][0] as { scale: number }).scale;
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
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

  // Fix round 2 / R2-N5 — scheduleTileUpdate used to decide "needs a tile?"
  // by comparing the UN-multiplied renderScale against clampRenderScale
  // (geom, renderScale), but the base canvas's own render effect actually
  // paints its native pixel buffer at renderScale*dpr (N2's own fix,
  // clamped the same way). At a high enough devicePixelRatio,
  // renderScale*dpr can exceed the area cap even when plain renderScale —
  // the value this check was actually comparing — doesn't: the base
  // canvas got silently soft-clamped (blurrier than it should be) while
  // this decision concluded no tile was needed at all. Same moderate
  // zoom level as the sibling "does not use tiling... under the cap" test
  // above (which passes at the default ~1x test-environment dpr) — only
  // the devicePixelRatio differs here.
  it('schedules a tile when renderScale*dpr exceeds the cap even though renderScale alone does not (R2-N5)', async () => {
    const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 8, configurable: true });
    try {
      const page = makePage();
      getPage.mockResolvedValue(page);
      openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
      const { getByLabelText, findByTestId } = render(<PlanViewer {...baseProps()} />); // default 792x612 letter sheet
      await waitFor(() => expect(page.render).toHaveBeenCalled());

      for (let i = 0; i < 3; i++) fireEvent.click(getByLabelText('Zoom in'));

      const tile = await findByTestId('plan-tile-canvas', {}, { timeout: 2000 });
      expect(tile).toBeTruthy();
    } finally {
      if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    }
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

// Fix round 1 / S10 — a marker drag used to call onMoveMarker (a commit)
// on every mousemove, with no distance threshold and no gating on the
// active tool.
describe('PlanViewer — marker drag is one commit, gated by a 3px threshold and the Select tool (S10)', () => {
  async function setupDraggable(over: Partial<React.ComponentProps<typeof PlanViewer>> = {}) {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const onMoveMarker = vi.fn();
    const utils = render(<PlanViewer {...baseProps({ markups: [markup({ status: 'confirmed' })], onMoveMarker, ...over })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    const markerEl = utils.container.querySelector('[data-marker]')!;
    const scrollEl = utils.container.querySelector('.plan-canvas-scroll')!;
    return { ...utils, markerEl, scrollEl, onMoveMarker };
  }

  it('movement below the 3px threshold never calls onMoveMarker, even after mouseup', async () => {
    const { markerEl, scrollEl, onMoveMarker } = await setupDraggable();
    fireEvent.mouseDown(markerEl, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(scrollEl, { clientX: 101, clientY: 101 }); // ~1.4px — under threshold
    fireEvent.mouseUp(scrollEl);
    expect(onMoveMarker).not.toHaveBeenCalled();
  });

  it('movement past the threshold calls onMoveMarker EXACTLY ONCE, on mouseup — not per mousemove', async () => {
    const { markerEl, scrollEl, onMoveMarker } = await setupDraggable();
    fireEvent.mouseDown(markerEl, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(scrollEl, { clientX: 130, clientY: 100 }); // well past 3px
    expect(onMoveMarker).not.toHaveBeenCalled(); // not yet — only on mouseup
    fireEvent.mouseMove(scrollEl, { clientX: 150, clientY: 110 }); // a second move, same drag
    expect(onMoveMarker).not.toHaveBeenCalled();
    fireEvent.mouseUp(scrollEl);
    expect(onMoveMarker).toHaveBeenCalledTimes(1);
    expect(onMoveMarker).toHaveBeenCalledWith('m1', expect.any(Array));
  });

  it('a drag never starts while a non-Select tool is active — onMoveMarker is never called', async () => {
    const countToolState = { tool: 'count' as const, drawPoints: [], selectedIds: [], scaleFirstPoint: null };
    const { markerEl, scrollEl, onMoveMarker } = await setupDraggable({ toolState: countToolState });
    fireEvent.mouseDown(markerEl, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(scrollEl, { clientX: 200, clientY: 200 }); // a large move — would easily cross the threshold in Select
    fireEvent.mouseUp(scrollEl);
    expect(onMoveMarker).not.toHaveBeenCalled();
  });
});

// Fix round 1 / S11 — "the zoom and fit controls sit inside !viewOnly ...
// a phone user sees only the first sheet, at fit-width [with] no way to
// change sheets or zoom [and] pinch does nothing on a phone."
describe('PlanViewer — zoom/fit stay available in view-only mode, and touch pinch zooms (S11)', () => {
  it('the zoom/fit toolbar renders (and works) even when viewOnly is true', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { getByLabelText } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scaleBefore = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;

    fireEvent.click(getByLabelText('Zoom in'));
    await waitFor(() => expect(page.render.mock.calls.length).toBeGreaterThan(1));
    const scaleAfter = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    expect(scaleAfter).toBeGreaterThan(scaleBefore);
  });

  it('the mobile view-only notice still shows alongside the (now-available) toolbar', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { getByLabelText, getByText } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    expect(getByLabelText('Zoom in')).toBeTruthy();
    expect(getByText(/View only on this screen size/)).toBeTruthy();
  });

  it('a 2-finger pinch OUT (fingers moving apart) zooms in', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scaleBefore = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    const scrollEl = container.querySelector('.plan-canvas-scroll')!;

    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 150, clientY: 100 }] });
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 80, clientY: 100 }, { clientX: 220, clientY: 100 }] }); // distance 50 -> 140
    await waitFor(() => expect(page.render.mock.calls.length).toBeGreaterThan(1));
    const scaleAfter = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    expect(scaleAfter).toBeGreaterThan(scaleBefore);
  });

  it('a 2-finger pinch IN (fingers moving together) zooms out', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scaleBefore = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    const scrollEl = container.querySelector('.plan-canvas-scroll')!;

    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 80, clientY: 100 }, { clientX: 220, clientY: 100 }] });
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 150, clientY: 100 }] }); // distance 140 -> 50
    await waitFor(() => expect(page.render.mock.calls.length).toBeGreaterThan(1));
    const scaleAfter = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    expect(scaleAfter).toBeLessThan(scaleBefore);
  });

  it('a ONE-finger touch (a normal tap/scroll, not a pinch) never triggers a zoom', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    page.render.mockClear();
    const scrollEl = container.querySelector('.plan-canvas-scroll')!;

    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 200, clientY: 100 }] });
    await new Promise(r => setTimeout(r, 50));
    expect(page.render).not.toHaveBeenCalled();
  });

  it('touchend dropping below 2 touches ends the pinch — a stray touchmove afterward does not zoom', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });
    const { container } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scrollEl = container.querySelector('.plan-canvas-scroll')!;

    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 150, clientY: 100 }] });
    fireEvent.touchEnd(scrollEl, { touches: [{ clientX: 100, clientY: 100 }] }); // down to 1 touch
    page.render.mockClear();
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 100, clientY: 100 }] });
    await new Promise(r => setTimeout(r, 50));
    expect(page.render).not.toHaveBeenCalled();
  });

  // Fix round 2 / R2-N1 — the OLD implementation called zoomBy(stepFactor,
  // ...) directly from every touchmove; zoomBy computes nextScale from the
  // CLOSED-OVER renderScale, which hasn't been updated by React yet for a
  // second touchmove arriving before a re-render — so the first
  // touchmove's own setRenderScale call was simply overwritten (not
  // compounded) by the second one's, computed off the SAME stale base.
  // Net effect: multiple touchmoves inside one frame under-zoomed (as if
  // only the LAST one had ever happened) and fired one full re-render
  // EACH. The fix accumulates step factors in a ref and only calls zoomBy
  // once per animation frame with the fully compounded factor.
  it('two touchmoves before the next animation frame compound into ONE zoomBy call with the combined factor — not just the last touchmove\'s (R2-N1)', async () => {
    const page = makePage();
    getPage.mockResolvedValue(page);
    openPdfDocument.mockResolvedValue({ getPage, destroy: docDestroy });

    // Captures every requestAnimationFrame call instead of auto-firing it,
    // so the test controls exactly when "the next frame" happens — letting
    // both touchmoves below land BEFORE any flush, which is the only way
    // to prove they compound instead of racing a real timer.
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const flushRAF = () => rafQueue.splice(0, rafQueue.length).forEach(cb => cb(0));

    const { container } = render(<PlanViewer {...baseProps({ viewOnly: true })} />);
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    const scaleBefore = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    const renderCallsBefore = page.render.mock.calls.length;
    rafQueue.splice(0, rafQueue.length); // discard anything queued by mount itself
    const scrollEl = container.querySelector('.plan-canvas-scroll')!;

    fireEvent.touchStart(scrollEl, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 100 }] }); // dist 100
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 90, clientY: 100 }, { clientX: 220, clientY: 100 }] }); // dist 130 -> f1 = 1.3
    fireEvent.touchMove(scrollEl, { touches: [{ clientX: 80, clientY: 100 }, { clientX: 249, clientY: 100 }] }); // dist 169 -> f2 = 169/130

    // Nothing applied yet, and only ONE frame was ever scheduled for the
    // whole gesture — the second touchmove didn't queue its own.
    expect(page.render.mock.calls.length).toBe(renderCallsBefore);
    expect(rafQueue.length).toBe(1);

    flushRAF();
    await waitFor(() => expect(page.render.mock.calls.length).toBeGreaterThan(renderCallsBefore));
    expect(page.render.mock.calls.length).toBe(renderCallsBefore + 1); // exactly one new render — not two

    const scaleAfter = (page.getViewport.mock.calls[page.getViewport.mock.calls.length - 1][0] as { scale: number }).scale;
    const compoundFactor = (130 / 100) * (169 / 130); // both steps, correctly multiplied together
    expect(scaleAfter).toBeCloseTo(scaleBefore * compoundFactor, 5);
    // The old, buggy result: the first touchmove's factor silently lost,
    // landing on scaleBefore * f2 alone — provably a different number.
    expect(scaleAfter).not.toBeCloseTo(scaleBefore * (169 / 130), 5);

    rafSpy.mockRestore();
  });

  // Vitest here doesn't run the CSS pipeline (no `test.css` in vite.config.ts,
  // and PlanViewer.tsx itself doesn't even import plans.css — PlansWorkspace.
  // tsx, its parent, does), so a rendered element's getComputedStyle never
  // reflects the real stylesheet in this test environment. Reading the CSS
  // source directly is the reliable way to guard this rule, the same
  // approach nodeVersionPin.test.ts (R2-S5) uses for render.yaml.
  it('.plan-canvas-scroll opts out of the browser\'s own touch pinch/double-tap zoom in plans.css, so it never fights this component\'s own zoomBy (R2-N1)', () => {
    const css = readFileSync(join(__dirname, 'plans.css'), 'utf8');
    const ruleMatch = /\.plan-canvas-scroll\s*\{([^}]*)\}/.exec(css);
    expect(ruleMatch).toBeTruthy();
    // Strip comments first — the rule's own explanatory comment mentions
    // the literal string "touch-action: none" (explaining why it's NOT
    // used), which would otherwise false-positive the very check below.
    const rule = ruleMatch![1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rule).toMatch(/touch-action:\s*pan-x pan-y;/);
    // Never "none" — see plans.css's own comment: `none` would ALSO
    // disable native single-finger panning, which this component has no
    // JS fallback for at all (onTouchMove only ever handles exactly 2
    // touches).
    expect(rule).not.toMatch(/touch-action:\s*none/);
  });
});
