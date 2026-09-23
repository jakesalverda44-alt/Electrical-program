// Estimating Phase B, Task 4-8 — the Plans view's top-level component:
// wires SheetNavigator + PlanViewer + Toolbar + ItemsPanel + the markup
// draft/history/autosave/rollup pipeline together. This is the ONE module
// PcWorkspaceView.tsx's Takeoff step React.lazy()-imports (Task 9) — see
// index.ts's default export.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { Toast } from '../../../types';
import { EstimateLine, EstimateSettings, SheetRow, SheetDiscipline, MarkupWire, RollupEntry, ApplyMarkupsResponse } from '../types';
import SheetNavigator, { sheetKey } from './SheetNavigator';
import PlanViewer from './PlanViewer';
import Toolbar from './Toolbar';
import ItemsPanel from './ItemsPanel';
import ScaleCalibrationPopover from './ScaleCalibrationPopover';
import { reduceTool, initToolState, ToolEvent, PdfPoint } from './toolMachine';
import {
  initHistory, commit, undo, redo, canUndo, canRedo, replacePresent,
  createMarkup, deleteMarkups, reassignMarkups, moveMarkup, MarkupDraft,
} from './markupHistory';
import { useMarkupAutosave } from './useMarkupAutosave';
import './plans.css';

const LINE_COLORS = ['#4D8DF7', '#E0A53B', '#34C588', '#F2854F', '#E06A6A', '#9B7EDE', '#3BB6C9', '#D96BA0'];

/** Decision 2 — below 900px the viewer is view-only (pan/zoom, see markers,
 *  no editing). Same addEventListener-with-Safari-fallback shape as
 *  EstimateShell.tsx's useEstimateBreakpoint() (the same 900px threshold as
 *  its mobile/tablet split), kept local rather than imported so this module
 *  doesn't need to pull in EstimateShell's own step-rail concerns. */
function useIsNarrowViewport(): boolean {
  const getIsNarrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? !window.matchMedia('(min-width: 900px)').matches
    : false;
  const [isNarrow, setIsNarrow] = useState(getIsNarrow);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(min-width: 900px)');
    const update = () => setIsNarrow(!mql.matches);
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    const legacy = mql as unknown as { addListener?: (h: () => void) => void; removeListener?: (h: () => void) => void };
    legacy.addListener?.(update);
    return () => legacy.removeListener?.(update);
  }, []);
  return isNarrow;
}

function colorForLineKey(lineKey: string | null): string {
  if (!lineKey) return '#6A7892';
  let hash = 0;
  for (let i = 0; i < lineKey.length; i++) hash = (hash * 31 + lineKey.charCodeAt(i)) >>> 0;
  return LINE_COLORS[hash % LINE_COLORS.length];
}

function wireToDraft(m: MarkupWire): MarkupDraft {
  return {
    id: m.id, documentId: m.documentId, pageIndex: m.pageIndex, lineKey: m.lineKey, kind: m.kind,
    points: m.points, drops: m.drops, dropFt: m.dropFt, slackPct: m.slackPct, status: m.status, label: m.label,
  };
}

export interface PlansWorkspaceProps {
  bidId: string;
  lines: EstimateLine[];
  /** The bid's own current settings (useEstimatingBid) — used for the
   *  "Apply all that differ" $ impact preview so it prices with the SAME
   *  labor rate/OH/profit/etc. the estimate is actually saved at, not a
   *  hardcoded default. */
  settings: EstimateSettings;
  initialSheetKey?: string | null;
  initialLineKey?: string | null;
  onSheetKeyChange?: (key: string | null) => void;
  onLineKeyChange?: (key: string | null) => void;
  /** Called after a successful apply-markups so the caller (PcWorkspaceView,
   *  via useEstimatingBid) can refresh lines/recap/Bid Summary. */
  onApplied?: () => void;
  viewOnly?: boolean;
  /** Matches the rest of the estimating feature's convention (see
   *  LaborPricingStep.tsx) of taking showToast as a prop rather than
   *  reading it via context — keeps this component testable without an
   *  <AppProviders> wrapper. Toasts are simply skipped when omitted. */
  showToast?: (t: Toast) => void;
}

export default function PlansWorkspace({
  bidId, lines, settings, initialSheetKey, initialLineKey, onSheetKeyChange, onLineKeyChange, onApplied, viewOnly: viewOnlyProp, showToast,
}: PlansWorkspaceProps) {
  // Decision 2 — below 900px, view-only regardless of the caller's own prop
  // (a caller can still force it on above 900px, e.g. a read-only role —
  // that's what the prop is for; the viewport check only ever ADDS the
  // restriction, never removes one the caller asked for).
  const isNarrow = useIsNarrowViewport();
  const viewOnly = !!viewOnlyProp || isNarrow;
  const { data: sheetsData, loading: sheetsLoading, reload: reloadSheets } = useApi<{ sheets: SheetRow[] }>(`/estimating/${bidId}/sheets`);
  const sheets = useMemo(() => sheetsData?.sheets ?? [], [sheetsData]);

  const [disciplineFilter, setDisciplineFilter] = useState<SheetDiscipline | 'all'>('all');
  const [currentKey, setCurrentKey] = useState<string | null>(initialSheetKey ?? null);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(initialLineKey ?? null);
  const [showOnlyActiveLine, setShowOnlyActiveLine] = useState(false);

  // Default to the first sheet once the list loads, if nothing was in the URL.
  useEffect(() => {
    if (currentKey || sheets.length === 0) return;
    const first = sheets[0];
    setCurrentKey(sheetKey(first.document_id, first.page_index));
  }, [sheets, currentKey]);

  useEffect(() => { onSheetKeyChange?.(currentKey); }, [currentKey, onSheetKeyChange]);
  useEffect(() => { onLineKeyChange?.(activeLineKey); }, [activeLineKey, onLineKeyChange]);

  const currentSheet = useMemo(() => {
    if (!currentKey) return null;
    return sheets.find(s => sheetKey(s.document_id, s.page_index) === currentKey) ?? null;
  }, [sheets, currentKey]);

  // ── Markups: fetch once for the whole bid, edit as an in-memory history,
  // autosave the diff. ────────────────────────────────────────────────────
  const { data: markupsData } = useApi<{ markups: MarkupWire[] }>(`/estimating/${bidId}/markups`);
  const [history, setHistory] = useState(() => initHistory<MarkupDraft[]>([]));
  const hydratedMarkupsRef = useRef(false);
  useEffect(() => {
    if (!markupsData || hydratedMarkupsRef.current) return;
    hydratedMarkupsRef.current = true;
    setHistory(initHistory(markupsData.markups.map(wireToDraft)));
  }, [markupsData]);

  const onSynced = useCallback((synced: MarkupDraft[]) => {
    // The server confirmed exactly this snapshot — nothing to reconcile
    // into `history.present` (it was already this value when the batch was
    // built); this callback exists for a caller that wants to observe the
    // confirmed state, not to mutate the draft here.
    void synced;
  }, []);
  const autosave = useMarkupAutosave(bidId, history.present, onSynced);

  const [rollup, setRollup] = useState<RollupEntry[]>([]);
  const reloadRollup = useCallback(async () => {
    try {
      const { data } = await api.get<{ rollup: RollupEntry[] }>(`/estimating/${bidId}/markups/rollup`);
      setRollup(data.rollup);
    } catch { /* best-effort — the items panel just shows stale numbers until the next successful reload */ }
  }, [bidId]);
  useEffect(() => { void reloadRollup(); }, [reloadRollup]);
  // Refresh the rollup once a batch actually lands (status flips to saved).
  const prevStatusRef = useRef(autosave.status);
  useEffect(() => {
    if (prevStatusRef.current !== 'saved' && autosave.status === 'saved') void reloadRollup();
    prevStatusRef.current = autosave.status;
  }, [autosave.status, reloadRollup]);

  // ── Tool state + undo/redo ──────────────────────────────────────────────
  const [toolState, setToolState] = useState(initToolState);

  const mutate = useCallback((next: MarkupDraft[]) => {
    setHistory(h => commit(h, next));
  }, []);

  const dispatch = useCallback((event: ToolEvent) => {
    setToolState(prev => {
      const { state, effect } = reduceTool(prev, event);
      if (effect.type === 'commitCount') {
        const draft: MarkupDraft = {
          id: crypto.randomUUID(), documentId: currentSheet?.document_id ?? '', pageIndex: currentSheet?.page_index ?? 0,
          lineKey: activeLineKey, kind: 'count', points: [effect.point], drops: 0, dropFt: null, slackPct: null,
          status: 'confirmed', label: null,
        };
        mutate(createMarkup(history.present, draft));
      } else if (effect.type === 'commitLinear') {
        const draft: MarkupDraft = {
          id: crypto.randomUUID(), documentId: currentSheet?.document_id ?? '', pageIndex: currentSheet?.page_index ?? 0,
          lineKey: activeLineKey, kind: 'linear', points: effect.points, drops: 0, dropFt: null, slackPct: null,
          status: 'confirmed', label: null,
        };
        mutate(createMarkup(history.present, draft));
      } else if (effect.type === 'commitScalePoints') {
        setPendingScalePoints(effect.points);
      }
      return state;
    });
  }, [currentSheet, activeLineKey, mutate, history.present]);

  const onSelectMarker = useCallback((id: string, additive: boolean) => {
    dispatch({ type: 'SELECT_MARKERS', ids: [id], additive });
  }, [dispatch]);
  const onMoveMarker = useCallback((id: string, points: PdfPoint[]) => {
    mutate(moveMarkup(history.present, id, points));
  }, [mutate, history.present]);
  const onDeleteSelected = useCallback(() => {
    if (toolState.selectedIds.length === 0) return;
    mutate(deleteMarkups(history.present, toolState.selectedIds));
    setToolState(s => ({ ...s, selectedIds: [] }));
  }, [toolState.selectedIds, mutate, history.present]);
  const onUndo = useCallback(() => setHistory(h => undo(h)), []);
  const onRedo = useCallback(() => setHistory(h => redo(h)), []);

  // ── Scale calibration ────────────────────────────────────────────────────
  const [pendingScalePoints, setPendingScalePoints] = useState<[PdfPoint, PdfPoint] | null>(null);
  const commitScale = useCallback(async (ftPerPt: number, label: string) => {
    if (!currentSheet) return;
    try {
      await api.put(`/estimating/${bidId}/sheets/${currentSheet.document_id}/${currentSheet.page_index}/scale`, {
        ft_per_pt: ftPerPt, source: 'calibrated', label,
      });
      await reloadSheets();
      showToast?.({ title: 'Scale set', sub: label });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not set the scale', sub: 'Try again' });
    } finally {
      setPendingScalePoints(null);
    }
  }, [bidId, currentSheet, reloadSheets, showToast]);

  // ── Apply markups ────────────────────────────────────────────────────────
  const applyLines = useCallback(async (lineKeys: string[]) => {
    try {
      const { data } = await api.post<ApplyMarkupsResponse>(`/estimating/${bidId}/apply-markups`, { line_keys: lineKeys });
      if (data.skipped.length > 0) {
        showToast?.({ variant: 'error', title: 'Some lines could not be applied', sub: data.skipped.map(s => s.reason).join('; ') });
      } else {
        showToast?.({ title: `Applied ${data.applied.length} line${data.applied.length === 1 ? '' : 's'}` });
      }
      onApplied?.();
      await reloadRollup();
    } catch {
      showToast?.({ variant: 'error', title: 'Apply failed', sub: 'Try again' });
    }
  }, [bidId, onApplied, reloadRollup, showToast]);

  const previewPriceImpact = useCallback(async (lineKeys: string[]): Promise<number> => {
    const keySet = new Set(lineKeys);
    const rollupByKey = new Map(rollup.map(r => [r.lineKey, r]));
    const patched = lines.map(l => {
      if (!l.line_key || !keySet.has(l.line_key)) return l;
      const r = rollupByKey.get(l.line_key);
      return r?.markedQty != null ? { ...l, qty: r.markedQty } : l;
    });
    const [before, after] = await Promise.all([
      api.post<{ recap: { totals: { grandTotal: number } } }>(`/estimating/${bidId}/price`, { lines, settings }),
      api.post<{ recap: { totals: { grandTotal: number } } }>(`/estimating/${bidId}/price`, { lines: patched, settings }),
    ]);
    return after.data.recap.totals.grandTotal - before.data.recap.totals.grandTotal;
  }, [bidId, lines, rollup, settings]);

  const currentPageMarkups = useMemo(
    () => currentSheet ? history.present.filter(m => m.documentId === currentSheet.document_id && m.pageIndex === currentSheet.page_index) : [],
    [history.present, currentSheet]
  );

  const markerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of history.present) {
      if (m.status !== 'confirmed') continue;
      const key = sheetKey(m.documentId, m.pageIndex);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [history.present]);

  if (viewOnly) {
    return (
      <div className="plan-view">
        {currentSheet ? (
          <PlanViewer
            bidId={bidId} documentId={currentSheet.document_id} pageIndex={currentSheet.page_index} sheet={currentSheet}
            toolState={initToolState()} dispatchTool={() => ({ type: 'none' })} markups={currentPageMarkups}
            colorForLine={colorForLineKey} onSelectMarker={() => {}} onMoveMarker={() => {}} viewOnly
          />
        ) : <div className="plan-viewer-loading">Loading…</div>}
      </div>
    );
  }

  return (
    <div className="plan-view">
      <SheetNavigator
        sheets={sheets}
        currentKey={currentKey}
        onSelect={(doc, page) => setCurrentKey(sheetKey(doc, page))}
        markerCounts={markerCounts}
        disciplineFilter={disciplineFilter}
        onDisciplineFilterChange={setDisciplineFilter}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Toolbar
          toolState={toolState}
          dispatch={dispatch}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          onDeleteSelected={onDeleteSelected}
          hasSelection={toolState.selectedIds.length > 0}
          scaleDisabledReason={currentSheet ? null : 'Select a sheet first'}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', padding: '2px 10px' }}>
          {autosave.status === 'saving' && 'Saving…'}
          {autosave.status === 'pending' && 'Unsaved changes'}
          {autosave.status === 'saved' && 'Saved'}
          {autosave.status === 'error' && (
            <span>
              Could not save — <button className="btn ghost sm" onClick={autosave.retryNow}>Retry</button>
            </span>
          )}
        </div>
        {sheetsLoading && sheets.length === 0 ? (
          <div className="plan-viewer-loading">Loading sheets…</div>
        ) : currentSheet ? (
          <PlanViewer
            bidId={bidId}
            documentId={currentSheet.document_id}
            pageIndex={currentSheet.page_index}
            sheet={currentSheet}
            toolState={toolState}
            dispatchTool={dispatch}
            markups={currentPageMarkups}
            colorForLine={colorForLineKey}
            onSelectMarker={onSelectMarker}
            onMoveMarker={onMoveMarker}
          />
        ) : (
          <div className="plan-viewer-loading">No plan sheets found for this bid yet.</div>
        )}
        {pendingScalePoints && (
          <ScaleCalibrationPopover
            points={pendingScalePoints}
            titleBlockLabel={currentSheet?.scale_source === 'titleblock' ? currentSheet.scale_label : null}
            onCommit={commitScale}
            onCancel={() => setPendingScalePoints(null)}
          />
        )}
      </div>
      <ItemsPanel
        lines={lines}
        rollup={rollup}
        activeLineKey={activeLineKey}
        onSelectLine={setActiveLineKey}
        onApplyLines={applyLines}
        showOnlyActiveLine={showOnlyActiveLine}
        onToggleShowOnlyActiveLine={() => setShowOnlyActiveLine(v => !v)}
        previewPriceImpact={previewPriceImpact}
      />
    </div>
  );
}
