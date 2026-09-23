// Estimating Phase B, Task 4/5 — the canvas + SVG-overlay plan viewer.
// Loads a plan document once per documentId (cached across a page-navigate
// within the same PDF — no re-fetch per page), renders the current page to
// a <canvas> via pdf.js, and draws markers/in-progress draws in an
// absolutely-positioned <svg> whose own coordinate space is native
// render-space pixels at the CURRENT renderScale — a marker's <g> carries
// the one pdfToRenderMatrix() transform (Decision 8: "transform the group,
// not each child"), so panning (native scroll — see below) never touches
// React state for 1,000 markers, and only a renderScale change re-renders
// the transform.
//
// Pan is native container scrolling (`overflow: auto`), not a CSS
// transform — this keeps pointer-event -> PDF-point math a single,
// synchronous, pure calculation (offsetX/Y are already relative to the
// scrolled child, no separate pan bookkeeping to keep in sync with a live
// transform) and needs no getScreenCTM/DOM-CTM dependency, so it stays
// testable without a real browser layout engine. Zoom re-renders pdf.js at
// a new renderScale (clamped by overlay.ts's clampRenderScale) and,
// for "zoom around cursor", adjusts scroll position afterward so the PDF
// point under the cursor stays under it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import { isAbortError } from '../../../api/errors';
import { openPdfDocument, PdfJsDocument, PdfJsRenderTask } from './pdfjsClient';
import { PageGeometry, pdfToRenderMatrix, screenToPdf, fitScale, clampRenderScale, renderedSize } from './overlay';
import { needsTiledRender, planTileRender, tilePlansRoughlyEqual, TileRenderPlan, VisibleRect } from './regionRender';
import { SheetRow } from '../types';
import { ToolState, ToolEvent } from './toolMachine';
import { MarkupDraft } from './markupHistory';

export interface PlanViewerProps {
  bidId: string;
  documentId: string;
  pageIndex: number;
  sheet: SheetRow;
  toolState: ToolState;
  /** The caller (PlansWorkspace) owns the state machine and interprets
   *  its Effect internally (creating/committing a markup) — this is a
   *  fire-and-forget dispatch, not a pure reducer call. */
  dispatchTool: (event: ToolEvent) => void;
  markups: MarkupDraft[];
  colorForLine: (lineKey: string | null) => string;
  onSelectMarker: (id: string, additive: boolean) => void;
  onMoveMarker: (id: string, points: { x: number; y: number }[]) => void;
  /** Task 7 (deferral closed) — "click to confirm" for a suggested
   *  (dashed) marker: a mousedown on a marker whose status is 'suggested'
   *  calls this INSTEAD OF the normal select/drag flow (never both — a
   *  suggested marker is not draggable/selectable until confirmed).
   *  Omitted in view-only mode. */
  onConfirmMarker?: (id: string) => void;
  /** view-only mode (<900px, Decision 2) — tools hidden, no editing, pan/zoom still works. */
  viewOnly?: boolean;
}

interface LoadedDoc {
  documentId: string;
  doc: PdfJsDocument;
}

const MIN_SCALE = 0.1;
const MAX_SCALE_STEP = 1.25;
// Task 9 (deferral closed) — visible-region tiling past the canvas-area
// cap. TILE_SETTLE_MS debounces "re-render on pan/zoom settle" (never on
// every scroll-event pixel); TILE_MARGIN_FACTOR extends the tile beyond
// the visible viewport (half a viewport on every side) so a small pan
// doesn't immediately reveal an un-tiled edge before the next settle fires.
const TILE_SETTLE_MS = 200;
const TILE_MARGIN_FACTOR = 0.5;
// Task 9 (deferral closed) — the user's TARGET zoom (`renderScale`) is
// intentionally allowed to exceed overlay.ts's canvas-area cap; that's the
// entire point of tiling (the tile canvas is viewport-sized, not
// page-sized, so its own pixel budget never grows with scale). Clamping
// `renderScale` itself to the area cap — as this component did before
// tiling existed — would silently defeat tiling by never letting the
// target scale get past the same limit the base canvas is capped at.
// MAX_TARGET_SCALE is a separate, much more generous ceiling that exists
// only to stop `zoomBy` from running away unboundedly; estimators need to
// comfortably reach 300-600% (the coordinator's own figures) on a D-size
// sheet, so this leaves real headroom above that.
const MAX_TARGET_SCALE = 16;

export default function PlanViewer({
  bidId, documentId, pageIndex, sheet, toolState, dispatchTool, markups, colorForLine,
  onSelectMarker, onMoveMarker, onConfirmMarker, viewOnly,
}: PlanViewerProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  // Fix round 1 / N2 — devicePixelRatio was never applied anywhere (the
  // fitScale dpr parameter that already existed for it went unused), so
  // the base canvas's NATIVE pixel buffer matched its CSS display size
  // 1:1 — on a Retina screen (dpr 2), the browser then stretches that 1x
  // raster to fill 2x the physical pixels, rendering soft. Read once per
  // mount (a dpr change mid-session, e.g. dragging the window to another
  // display, is rare enough not to need a live matchMedia listener here).
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

  const loadedDocRef = useRef<LoadedDoc | null>(null);
  const renderTaskRef = useRef<PdfJsRenderTask | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Task 9 (deferral closed) — the visible-region tile, rendered at the
  // full (uncapped) renderScale, drawn on top of the low-res base canvas
  // whenever renderScale exceeds what a whole-page render can afford
  // (overlay.ts's canvas-area cap). null = tiling isn't needed right now
  // (the base canvas alone is already sharp enough).
  const [tilePlan, setTilePlan] = useState<TileRenderPlan | null>(null);
  const tilePlanRef = useRef<TileRenderPlan | null>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileRenderTaskRef = useRef<PdfJsRenderTask | null>(null);
  const tileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const geom: PageGeometry = useMemo(
    // Fix round 1 / S1 — originXPt/originYPt (a non-zero MediaBox origin,
    // almost always 0/0) so every marker point and every rendered
    // position lines up with what pdf.js itself renders.
    () => ({
      widthPt: sheet.width_pt, heightPt: sheet.height_pt, rotation: sheet.rotation as never,
      originXPt: sheet.origin_x_pt, originYPt: sheet.origin_y_pt,
    }),
    [sheet.width_pt, sheet.height_pt, sheet.rotation, sheet.origin_x_pt, sheet.origin_y_pt]
  );

  // Fit-to-width once we know the container size and the sheet's geometry —
  // a sensible initial renderScale rather than always starting at 1x
  // (which can be illegibly tiny for a 36"x24" D-size sheet).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const initial = clampRenderScale(geom, fitScale(geom, el.clientWidth || 900, el.clientHeight || 700, 'width'));
    setRenderScale(initial > 0 ? initial : 1);
    // A new sheet/page starts with no tile — the reset avoids a stale tile
    // from the PREVIOUS page briefly showing over the new one's base render.
    setTilePlan(null);
    tilePlanRef.current = null;
    // Only on sheet identity change (new document/page geometry) — the
    // user's own subsequent zoom choices are never overridden by this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, pageIndex, sheet.width_pt, sheet.height_pt, sheet.rotation]);

  // Load (or reuse) the document for this documentId.
  useEffect(() => {
    let cancelled = false;
    if (loadedDocRef.current?.documentId === documentId) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    setErrorMessage(null);
    setProgress(null);

    // Release whatever was open before switching documents.
    if (loadedDocRef.current) {
      void loadedDocRef.current.doc.destroy();
      loadedDocRef.current = null;
    }

    // Fix round 1 / B9 — a real plan set can be 100-150MB; api/client.ts's
    // global 30s axios timeout covers the WHOLE transfer, so a perfectly
    // healthy download on a slow office link used to fail with "timeout of
    // 30000ms exceeded" partway through. `timeout: 0` removes that
    // ceiling for this one (large, user-visible-progress) request; the
    // AbortController below is what actually stops a request that's no
    // longer wanted — switching documents, or unmounting — instead of a
    // time-based cutoff. Every earlier `cancelled` check stays (the
    // AbortController stops the NETWORK transfer; `cancelled` still guards
    // the async continuations after it, e.g. openPdfDocument()).
    const controller = new AbortController();
    (async () => {
      try {
        const res = await api.get<ArrayBuffer>(`/estimating/${bidId}/sheets/${documentId}/file`, {
          responseType: 'arraybuffer',
          timeout: 0,
          signal: controller.signal,
          onDownloadProgress: evt => {
            if (!cancelled) setProgress({ loaded: evt.loaded, total: evt.total ?? null });
          },
        });
        if (cancelled) return;
        const doc = await openPdfDocument(res.data);
        if (cancelled) { void doc.destroy(); return; }
        loadedDocRef.current = { documentId, doc };
        setStatus('ready');
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        setErrorMessage(err instanceof Error ? err.message : 'Could not load this plan sheet.');
        setStatus('error');
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [bidId, documentId]);

  // Destroy the open document when the viewer itself unmounts (not just on
  // a documentId change, which is handled above).
  useEffect(() => () => {
    if (loadedDocRef.current) {
      void loadedDocRef.current.doc.destroy();
      loadedDocRef.current = null;
    }
  }, []);

  // Render the current page whenever the loaded doc, page, or scale changes.
  // `renderScale` is always the TARGET (uncapped) scale — `pageSize` (the
  // wrapper/svg/matrix size everything else in this component uses) is
  // always renderedSize(geom, renderScale), the TRUE zoom level. The base
  // canvas's own NATIVE pixel resolution is separately clamped
  // (`baseScale`) to stay under overlay.ts's canvas-area cap, and CSS-
  // stretched up to pageSize when the two differ — a deliberately blurry
  // placeholder while the sharp tile (below) catches up. At any scale that
  // doesn't hit the cap, baseScale === renderScale and this is exactly the
  // single-canvas behavior this component had before tiling existed.
  useEffect(() => {
    if (status !== 'ready') return;
    const loaded = loadedDocRef.current;
    if (!loaded || loaded.documentId !== documentId) return;
    let cancelled = false;

    (async () => {
      const page = await loaded.doc.getPage(pageIndex + 1);
      if (cancelled || !aliveRef.current) return;
      // Cancel whatever render was previously in flight for this canvas —
      // a rapid zoom/page-change must never let a stale render task finish
      // painting over a newer one.
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      // Fix round 1 / N2 — the NATIVE pixel buffer renders at
      // renderScale*dpr (capped at the same MAX_CANVAS_AREA_PX as the
      // un-multiplied scale would be, via clampRenderScale's own call
      // here — never a separately-capped baseScale multiplied by dpr
      // afterward, which could exceed it); the CSS box below
      // (canvas.style, from pageSize) is untouched and still exactly
      // renderedSize(geom, renderScale) — dpr sharpens the raster the
      // browser has to stretch, it never changes the displayed size.
      const nativeScale = clampRenderScale(geom, renderScale * dpr);
      const viewport = page.getViewport({ scale: nativeScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setPageSize(renderedSize(geom, renderScale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (err) {
        // pdf.js rejects a cancelled render with a RenderingCancelledException
        // — expected and harmless; anything else surfaces as a real error.
        const name = (err as { name?: string } | undefined)?.name;
        if (name !== 'RenderingCancelledException' && aliveRef.current && !cancelled) {
          setErrorMessage('Could not render this page.');
          setStatus('error');
        }
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      }
    })();

    return () => { cancelled = true; };
  }, [status, documentId, pageIndex, renderScale, geom, dpr]);

  // ── Visible-region tiling (Task 9, deferral closed) ─────────────────────
  // Debounced "compute where the tile should be, if one is needed at all"
  // — never renders directly; only ever updates `tilePlan`, which the
  // separate render effect below reacts to.
  const scheduleTileUpdate = useCallback(() => {
    if (tileTimerRef.current) clearTimeout(tileTimerRef.current);
    tileTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || !aliveRef.current) return;
      const baseScale = clampRenderScale(geom, renderScale);
      if (!needsTiledRender(renderScale, baseScale)) {
        if (tilePlanRef.current) { tilePlanRef.current = null; setTilePlan(null); }
        return;
      }
      const visible: VisibleRect = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight };
      const margin = Math.max(el.clientWidth, el.clientHeight) * TILE_MARGIN_FACTOR;
      const plan = planTileRender(geom, renderScale, visible, margin);
      if (tilePlanRef.current && tilePlansRoughlyEqual(tilePlanRef.current, plan)) return;
      tilePlanRef.current = plan;
      setTilePlan(plan);
    }, TILE_SETTLE_MS);
  }, [geom, renderScale]);

  useEffect(() => () => { if (tileTimerRef.current) clearTimeout(tileTimerRef.current); }, []);

  // Re-evaluate whenever the target scale (or the page itself) changes —
  // scroll position also triggers this via the container's onScroll below.
  useEffect(() => { scheduleTileUpdate(); }, [scheduleTileUpdate, pageSize]);

  // Actually renders the tile once `tilePlan` settles on a new value.
  // Same cancel-stale-task discipline as the base render effect, on its
  // OWN render task ref — a stale tile render must never paint over a
  // newer one, and must never be confused with the base canvas's task.
  useEffect(() => {
    if (!tilePlan || status !== 'ready') return;
    const loaded = loadedDocRef.current;
    if (!loaded || loaded.documentId !== documentId) return;
    let cancelled = false;

    (async () => {
      const page = await loaded.doc.getPage(pageIndex + 1);
      if (cancelled || !aliveRef.current) return;
      if (tileRenderTaskRef.current) {
        tileRenderTaskRef.current.cancel();
        tileRenderTaskRef.current = null;
      }
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = tileCanvasRef.current;
      if (!canvas) return;
      canvas.width = tilePlan.width;
      canvas.height = tilePlan.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport, transform: tilePlan.transform });
      tileRenderTaskRef.current = task;
      try {
        await task.promise;
      } catch (err) {
        // A cancelled tile render is expected/harmless; any OTHER failure
        // just means the tile doesn't update — the (correct, just softer)
        // base canvas underneath is still there, so this never needs to
        // surface as a page-level error the way a failed BASE render does.
        const name = (err as { name?: string } | undefined)?.name;
        void name;
      } finally {
        if (tileRenderTaskRef.current === task) tileRenderTaskRef.current = null;
      }
    })();

    return () => { cancelled = true; };
  }, [tilePlan, status, documentId, pageIndex, renderScale]);

  const zoomBy = useCallback((factor: number, anchorClient?: { x: number; y: number }) => {
    const el = scrollRef.current;
    const nextScale = Math.min(MAX_TARGET_SCALE, Math.max(MIN_SCALE, renderScale * factor));
    if (!el || !pageSize) { setRenderScale(nextScale); return; }
    // Zoom around the given anchor (defaults to viewport center): find the
    // PDF point under the anchor at the OLD scale, then after the scale
    // changes, re-derive that same point's new render-space position and
    // scroll so it lands back under the anchor.
    const rect = el.getBoundingClientRect();
    const anchor = anchorClient ?? { x: rect.left + el.clientWidth / 2, y: rect.top + el.clientHeight / 2 };
    const localX = anchor.x - rect.left + el.scrollLeft;
    const localY = anchor.y - rect.top + el.scrollTop;
    const pdfPoint = screenToPdf(geom, renderScale, { x: localX, y: localY });
    setRenderScale(nextScale);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const newLocal = { x: 0, y: 0 };
      const m = pdfToRenderMatrix(geom, nextScale);
      newLocal.x = m[0] * pdfPoint.x + m[2] * pdfPoint.y + m[4];
      newLocal.y = m[1] * pdfPoint.x + m[3] * pdfPoint.y + m[5];
      scrollRef.current.scrollLeft = newLocal.x - (anchor.x - rect.left);
      scrollRef.current.scrollTop = newLocal.y - (anchor.y - rect.top);
      scheduleTileUpdate();
    });
  }, [geom, renderScale, pageSize, scheduleTileUpdate]);

  const fitWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setRenderScale(clampRenderScale(geom, fitScale(geom, el.clientWidth, el.clientHeight, 'width')));
  }, [geom]);
  const fitPage = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setRenderScale(clampRenderScale(geom, fitScale(geom, el.clientWidth, el.clientHeight, 'page')));
  }, [geom]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls natively; ctrl/pinch zooms
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? MAX_SCALE_STEP : 1 / MAX_SCALE_STEP, { x: e.clientX, y: e.clientY });
  }, [zoomBy]);

  const dragPanRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  // mouseup (which clears dragPanRef/dragMarkerRef) fires BEFORE click in
  // DOM event order, so onCanvasClick can't check those refs directly — it
  // would always see null. This flag is set the moment real movement
  // happens (past a tiny threshold, so a plain click-without-moving still
  // registers as a click) and consumed (reset) by the next click.
  const didDragRef = useRef(false);
  const DRAG_THRESHOLD_PX = 3;
  // A marker drag (Select tool, mousedown on a shape) — tracked here, not
  // inside MarkerShape, so the SAME mousemove/mouseup handlers that already
  // run over the whole canvas resolve it; MarkerShape only needs to report
  // "drag started on me".
  //
  // Fix round 1 / S10 — this used to call onMoveMarker (-> PlansWorkspace's
  // mutate -> commit()) on EVERY mousemove: one drag across a few hundred
  // pixels could burn through a meaningful fraction of the 200-step undo
  // history cap, and Undo walked back through every intermediate position
  // instead of undoing the drag as one action. `moved` (crossed the 3px
  // threshold, in SCREEN pixels — matching the existing pan-drag's own
  // convention, not PDF points, which would behave inconsistently across
  // zoom levels) gates BOTH when the marker visually starts following the
  // pointer (via the transient `liveDrag` state below, never committed
  // mid-drag) and whether mouseup calls onMoveMarker at all — exactly ONE
  // call, with the final position, per real drag. A drag that never
  // crosses the threshold (a plain click-to-select) never moves the
  // marker at all, fixing "a click-to-select nudges them" too.
  const dragMarkerRef = useRef<{
    id: string; startPdf: { x: number; y: number }; startClientX: number; startClientY: number;
    originPoints: { x: number; y: number }[]; moved: boolean;
  } | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ id: string; points: { x: number; y: number }[] } | null>(null);
  const liveDragRef = useRef<{ id: string; points: { x: number; y: number }[] } | null>(null);

  const toPdfPointFromEvent = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return screenToPdf(geom, renderScale, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [geom, renderScale]);

  const onStartMarkerDrag = useCallback((id: string, originPoints: { x: number; y: number }[], e: React.MouseEvent) => {
    // Fix round 1 / S10 — "Marker drag also starts while the Count or
    // Linear tool is active." Selecting a marker is already a no-op
    // outside Select at the reducer level (toolMachine.ts's own
    // SELECT_MARKERS case), but nothing stopped a DRAG from starting
    // anyway — a Count/Linear click that happened to land on an existing
    // marker could silently relocate it mid-draw.
    if (toolState.tool !== 'select') return;
    const p = toPdfPointFromEvent(e);
    if (!p) return;
    dragMarkerRef.current = { id, startPdf: p, startClientX: e.clientX, startClientY: e.clientY, originPoints, moved: false };
  }, [toPdfPointFromEvent, toolState.tool]);

  const onMouseDownPan = useCallback((e: React.MouseEvent) => {
    if (toolState.tool !== 'select' || !scrollRef.current) return;
    if ((e.target as HTMLElement).closest('[data-marker]')) return; // a marker's own mousedown owns this (onStartMarkerDrag)
    dragPanRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop };
  }, [toolState.tool]);
  const onMouseMovePan = useCallback((e: React.MouseEvent) => {
    if (dragMarkerRef.current) {
      const drag = dragMarkerRef.current;
      // Fix round 1 / S10 — 3px SCREEN-pixel threshold (matching the pan-
      // drag's own convention below), never PDF points (which scale with
      // zoom, so a fixed PDF-point threshold would feel inconsistent at
      // different zoom levels). Below it: not a real drag yet — no visual
      // move, no undo-step, same as a plain click.
      if (!drag.moved) {
        const screenDx = e.clientX - drag.startClientX;
        const screenDy = e.clientY - drag.startClientY;
        if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
      }
      didDragRef.current = true;
      const p = toPdfPointFromEvent(e);
      if (!p) return;
      const dx = p.x - drag.startPdf.x;
      const dy = p.y - drag.startPdf.y;
      const points = drag.originPoints.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
      // Visual-only — never committed until mouseup, so a drag across
      // N mousemoves is still exactly ONE undo step, not N.
      liveDragRef.current = { id: drag.id, points };
      setLiveDrag(liveDragRef.current);
      return;
    }
    const d = dragPanRef.current;
    if (!d || !scrollRef.current) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) didDragRef.current = true;
    scrollRef.current.scrollLeft = d.scrollLeft - dx;
    scrollRef.current.scrollTop = d.scrollTop - dy;
    scheduleTileUpdate();
  }, [toPdfPointFromEvent, scheduleTileUpdate]);
  const onMouseUpPan = useCallback(() => {
    const drag = dragMarkerRef.current;
    // Fix round 1 / S10 — the ONE commit for the whole drag, with the
    // final position. A drag that never crossed the threshold (moved ===
    // false) never calls onMoveMarker at all — nothing to commit.
    if (drag && drag.moved && liveDragRef.current) {
      onMoveMarker(drag.id, liveDragRef.current.points);
    }
    dragPanRef.current = null;
    dragMarkerRef.current = null;
    liveDragRef.current = null;
    setLiveDrag(null);
  }, [onMoveMarker]);

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (viewOnly) return;
    if (didDragRef.current) { didDragRef.current = false; return; } // a real pan/marker-drag just ended — never also place a marker
    const point = toPdfPointFromEvent(e);
    if (!point) return;
    dispatchTool({ type: 'POINTER_CLICK', point });
  }, [viewOnly, toPdfPointFromEvent, dispatchTool]);

  const onCanvasDoubleClick = useCallback(() => {
    if (viewOnly) return;
    dispatchTool({ type: 'FINISH_LINEAR' });
  }, [viewOnly, dispatchTool]);

  useEffect(() => {
    if (viewOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchTool({ type: 'CANCEL' });
      if (e.key === 'Enter') dispatchTool({ type: 'FINISH_LINEAR' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewOnly, dispatchTool]);

  const matrix = pageSize ? pdfToRenderMatrix(geom, renderScale) : null;
  const matrixStr = matrix ? `matrix(${matrix.join(',')})` : undefined;

  return (
    <div className="plan-viewer">
      {!viewOnly && (
        <div className="plan-toolbar" role="toolbar" aria-label="Plan tools">
          <button className="plan-toolbar-btn" onClick={fitWidth}>Fit width</button>
          <button className="plan-toolbar-btn" onClick={fitPage}>Fit page</button>
          <button className="plan-toolbar-btn" onClick={() => zoomBy(1 / MAX_SCALE_STEP)} aria-label="Zoom out">−</button>
          <span style={{ fontSize: 11.5, color: 'var(--text3)', minWidth: 44, textAlign: 'center' }}>{Math.round(renderScale * 100)}%</span>
          <button className="plan-toolbar-btn" onClick={() => zoomBy(MAX_SCALE_STEP)} aria-label="Zoom in">+</button>
          <div className="plan-toolbar-scale">
            {sheet.ft_per_pt == null
              ? <span className="plan-toolbar-scale-warn">No scale set — measuring disabled</span>
              : <span>Scale: {sheet.scale_label ?? 'calibrated'}</span>}
          </div>
        </div>
      )}
      {viewOnly && (
        <div className="plan-viewer-mobile-notice">View only on this screen size — open on a larger screen to mark up.</div>
      )}
      <div className="plan-canvas-wrap">
        <div
          className="plan-canvas-scroll"
          ref={scrollRef}
          onWheel={onWheel}
          onMouseDown={onMouseDownPan}
          onMouseMove={onMouseMovePan}
          onMouseUp={onMouseUpPan}
          onMouseLeave={onMouseUpPan}
          onScroll={scheduleTileUpdate}
        >
          {status !== 'error' && (
            // The canvas/svg are mounted as soon as we're past the initial
            // "loading" gate — NOT gated on pageSize being known yet, since
            // pageSize is only SET inside the render effect below, which
            // itself needs canvasRef.current to already exist (a gate on
            // pageSize would make the canvas and its own size-setting
            // effect wait on each other forever). Sized 0x0 until the
            // first page render reports real dimensions.
            <div className="plan-canvas-page" style={{ width: pageSize?.width ?? 0, height: pageSize?.height ?? 0 }}>
              {/* Base canvas: its NATIVE resolution is the capped
                  baseScale (set imperatively in the render effect via
                  canvas.width/height), but its CSS box always fills the
                  true renderScale size — the browser stretches the
                  (possibly softer) raster to fit, which is exactly the
                  "low-res placeholder while the sharp tile renders"
                  behavior Task 9 asks for. At any scale under the cap
                  baseScale===renderScale and this stretch is a no-op. */}
              <canvas
                ref={canvasRef}
                onClick={onCanvasClick}
                onDoubleClick={onCanvasDoubleClick}
                style={{ width: pageSize?.width ?? 0, height: pageSize?.height ?? 0 }}
              />
              {tilePlan && (
                <canvas
                  ref={tileCanvasRef}
                  className="plan-tile-canvas"
                  style={{ left: tilePlan.left, top: tilePlan.top, width: tilePlan.width, height: tilePlan.height }}
                  data-testid="plan-tile-canvas"
                />
              )}
              <svg
                ref={svgRef}
                className="plan-overlay-svg"
                width={pageSize?.width ?? 0}
                height={pageSize?.height ?? 0}
                style={{ cursor: toolState.tool === 'select' ? 'default' : 'crosshair' }}
              >
                {matrixStr && (
                  <g transform={matrixStr}>
                    {markups.map(m => (
                      <MarkerShape
                        key={m.id}
                        // Fix round 1 / S10 — while THIS marker is the one
                        // actively being dragged, render at the transient
                        // liveDrag position (never committed until
                        // mouseup) instead of the prop-driven `m.points`,
                        // which won't move until onMoveMarker's single
                        // post-drag commit causes a re-render.
                        markup={liveDrag && liveDrag.id === m.id ? { ...m, points: liveDrag.points } : m}
                        color={colorForLine(m.lineKey)}
                        selected={toolState.selectedIds.includes(m.id)}
                        strokeWidth={1.5 / renderScale}
                        radius={6 / renderScale}
                        onSelect={additive => onSelectMarker(m.id, additive)}
                        onStartDrag={e => onStartMarkerDrag(m.id, m.points, e)}
                        onConfirm={onConfirmMarker ? () => onConfirmMarker(m.id) : undefined}
                      />
                    ))}
                    {toolState.tool === 'linear' && toolState.drawPoints.length > 0 && (
                      <polyline
                        points={toolState.drawPoints.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="none"
                        stroke="#4D8DF7"
                        strokeWidth={2 / renderScale}
                        strokeDasharray={`${6 / renderScale} ${4 / renderScale}`}
                      />
                    )}
                    {toolState.tool === 'scale' && toolState.scaleFirstPoint && (
                      <circle cx={toolState.scaleFirstPoint.x} cy={toolState.scaleFirstPoint.y} r={5 / renderScale} fill="#E0A53B" />
                    )}
                  </g>
                )}
              </svg>
            </div>
          )}
        </div>
        {status === 'loading' && (
          <div className="plan-viewer-loading">
            <div>Loading plan…</div>
            {/* Fix round 1 / B9 — a real, visible progress bar (not just
                a percentage number) for a transfer that can now run well
                past the old 30s ceiling on a large plan set; `total` is
                null whenever the server didn't send a Content-Length
                (chunked/streamed — see sheets.ts's streamPlanDocument),
                in which case only the loaded-bytes count is shown. */}
            {progress?.total ? (
              <>
                <progress className="plan-viewer-progress" value={progress.loaded} max={progress.total} />
                <div>{Math.round((progress.loaded / progress.total) * 100)}%</div>
              </>
            ) : progress?.loaded ? (
              <div>{Math.round(progress.loaded / 1024 / 1024)} MB…</div>
            ) : null}
          </div>
        )}
        {status === 'error' && (
          <div className="plan-viewer-error" role="alert">{errorMessage ?? 'Could not load this plan sheet.'}</div>
        )}
      </div>
    </div>
  );
}

// ── One marker/run shape ─────────────────────────────────────────────────

interface MarkerShapeProps {
  markup: MarkupDraft;
  color: string;
  selected: boolean;
  strokeWidth: number;
  radius: number;
  onSelect: (additive: boolean) => void;
  /** Reports "a drag started on me" — PlanViewer's own mousemove/mouseup
   *  (already wired for panning) resolves the actual PDF-point math, so
   *  every geometry conversion has one owner. */
  onStartDrag: (e: React.MouseEvent) => void;
  /** Task 7 (deferral closed) — present only when this marker is
   *  status==='suggested' AND the parent gave PlanViewer an
   *  onConfirmMarker. A mousedown then confirms it INSTEAD OF selecting or
   *  starting a drag — a suggested marker isn't draggable/selectable until
   *  it's confirmed. */
  onConfirm?: () => void;
}

function MarkerShape({ markup, color, selected, strokeWidth, radius, onSelect, onStartDrag, onConfirm }: MarkerShapeProps) {
  const onPointerDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (markup.status === 'suggested' && onConfirm) {
      onConfirm();
      return;
    }
    onSelect(e.shiftKey);
    onStartDrag(e);
  };

  const dashArray = markup.status === 'suggested' ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined;

  if (markup.kind === 'count') {
    const p = markup.points[0];
    if (!p) return null;
    return (
      <circle
        data-marker
        data-status={markup.status}
        className="plan-marker"
        cx={p.x} cy={p.y} r={radius}
        fill={color} fillOpacity={markup.status === 'suggested' ? 0.35 : 0.85}
        stroke={selected ? '#fff' : color} strokeWidth={selected ? strokeWidth * 1.5 : strokeWidth}
        strokeDasharray={dashArray}
        onMouseDown={onPointerDown}
      >
        {markup.status === 'suggested' && <title>Click to confirm{markup.label ? `: ${markup.label}` : ''}</title>}
      </circle>
    );
  }
  return (
    <polyline
      data-marker
      data-status={markup.status}
      className="plan-marker"
      points={markup.points.map(p => `${p.x},${p.y}`).join(' ')}
      fill="none"
      stroke={color}
      strokeWidth={selected ? strokeWidth * 2 : strokeWidth}
      strokeDasharray={dashArray}
      onMouseDown={onPointerDown}
    />
  );
}
