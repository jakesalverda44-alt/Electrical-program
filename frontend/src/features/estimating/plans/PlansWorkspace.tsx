// Estimating Phase B, Task 4-8 — the Plans view's top-level component:
// wires SheetNavigator + PlanViewer + Toolbar + ItemsPanel + the markup
// draft/history/autosave/rollup pipeline together. This is the ONE module
// PcWorkspaceView.tsx's Takeoff step React.lazy()-imports (Task 9) — see
// index.ts's default export.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { Toast } from '../../../types';
import { EstimateLine, EstimateSettings, SheetRow, SheetDiscipline, MarkupWire, RollupEntry, ApplyMarkupsResponse, Library } from '../types';
import SheetNavigator, { sheetKey } from './SheetNavigator';
import PlanViewer from './PlanViewer';
import Toolbar from './Toolbar';
import ItemsPanel from './ItemsPanel';
import ScaleCalibrationPopover from './ScaleCalibrationPopover';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';
import SuggestMarkersBar, { FindTagResult } from './SuggestMarkersBar';
import NewLineFromMarkupModal, { NewLineFromMarkupInput } from './NewLineFromMarkupModal';
import ReassignMarkersModal from './ReassignMarkersModal';
import { reduceTool, initToolState, ToolEvent, PdfPoint } from './toolMachine';
import {
  initHistory, commit, undo, redo, canUndo, canRedo,
  createMarkup, updateMarkup, deleteMarkups, moveMarkup, reassignMarkups, MarkupDraft,
  // replacePresent is exported and tested (markupHistory.test.ts) but not
  // yet needed here — every mutation this component makes already goes
  // through commit() via mutate(), which is what replacePresent exists to
  // bypass (syncing a server-confirmed value without a spurious undo step).
} from './markupHistory';
import { useMarkupAutosave } from './useMarkupAutosave';
import { PageGeometry } from './overlay';
import { suggestTagMarkers, candidateTagsFromDescription, buildLineTagIndex } from './tagSuggest';
import { draftsFromTagCandidates } from './suggestedMarkerFlow';
import { getSheetTextItems } from './sheetTextCache';
import { TAKEOFF_CATEGORIES } from '../categories';
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
  // Task 6 (deferral closed) — "New line from markup" reuses the Phase A
  // resolver's own library search (LaborPricingStep.tsx's pattern).
  const { data: library } = useApi<Library>('/estimating/library');

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

  const onSynced = useCallback((synced: MarkupDraft[]) => {
    // The server confirmed exactly this snapshot — nothing to reconcile
    // into `history.present` (it was already this value when the batch was
    // built); this callback exists for a caller that wants to observe the
    // confirmed state, not to mutate the draft here.
    void synced;
  }, []);
  const autosave = useMarkupAutosave(bidId, history.present, onSynced);
  const autosaveResetRef = useRef(autosave.reset);
  autosaveResetRef.current = autosave.reset;

  const hydratedMarkupsRef = useRef(false);
  useEffect(() => {
    if (!markupsData || hydratedMarkupsRef.current) return;
    hydratedMarkupsRef.current = true;
    const drafts = markupsData.markups.map(wireToDraft);
    setHistory(initHistory(drafts));
    // Fix round 1 / B3(d) — install the REAL hydrated list as the
    // autosave hook's own confirmed-synced baseline, in the SAME effect
    // that first populates it. Without this, useMarkupAutosave's own
    // "first render establishes the baseline" heuristic already locked in
    // `[]` (this component's own first render, before this GET resolved)
    // — so hydrating N existing markups moments later would diff as N
    // brand-new creates and re-POST the whole bid's markup list on every
    // Plans open.
    autosaveResetRef.current(drafts);
  }, [markupsData]);

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

  // Task 9 — "?" opens keyboard shortcut help. Same "ignore while typing"
  // guard as Toolbar.tsx's own shortcuts.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (viewOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      if (e.key === '?') setHelpOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewOnly]);

  // Fix round 1 / B3(b) — `next` may be a plain value (every SYNCHRONOUS
  // call site — a click always mutates against the current render's own
  // `history.present`, no staleness possible) or a function of the
  // CURRENT present (every call site that follows an `await` — see
  // suggestTagsOnSheet/createLineFromMarkup below). The function form is
  // what fixes F2: `setHistory`'s own updater always receives whatever
  // `history.present` truly is at COMMIT time, never a value captured in
  // an async closure before the await, which could already be stale by
  // the time the await resolves (a marker the user drew while a
  // suggestion search was loading used to simply vanish, overwritten by
  // the stale pre-await snapshot).
  const mutate = useCallback((next: MarkupDraft[] | ((current: MarkupDraft[]) => MarkupDraft[])) => {
    setHistory(h => commit(h, typeof next === 'function' ? (next as (current: MarkupDraft[]) => MarkupDraft[])(h.present) : next));
  }, []);
  // Fix round 1 / B3(b) — kept in sync every render (not in an effect) so
  // an async continuation can read the FRESHEST available snapshot the
  // instant its `await` resolves, same pattern useMarkupAutosave.ts
  // already uses for markupsRef/bidIdRef. Used only to decide what NEW
  // drafts/reassignments to compute (e.g. dedup, which markers exist to
  // reassign) — the actual commit into state always goes through
  // `mutate`'s functional form above, which is correct even if this ref
  // is a render behind by the time the commit itself runs.
  const historyPresentRef = useRef(history.present);
  historyPresentRef.current = history.present;

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

  // ── Suggested markers (Task 7, deferral closed) ─────────────────────────
  // Trace: Agent 1's raw analysis JSON has equipment[].tag, but nothing in
  // the mapper/composeBidData pipeline carries it onto EstimateLine — see
  // tagSuggest.ts's header comment for the full trace. candidateTagsFrom
  // Description (the best available real signal: the line's own
  // Agent-1/2-authored description text) is what "wires the tags" here.
  const lineTagIndex = useMemo(() => buildLineTagIndex(lines), [lines]);

  const onConfirmMarker = useCallback((id: string) => {
    mutate(updateMarkup(history.present, id, { status: 'confirmed' }));
  }, [mutate, history.present]);

  const onConfirmAllOnSheet = useCallback(() => {
    if (!currentSheet) return;
    mutate(history.present.map(m => (
      m.documentId === currentSheet.document_id && m.pageIndex === currentSheet.page_index && m.status === 'suggested'
        ? { ...m, status: 'confirmed' as const }
        : m
    )));
  }, [currentSheet, mutate, history.present]);

  const onRejectAllOnSheet = useCallback(() => {
    if (!currentSheet) return;
    mutate(history.present.filter(m => !(
      m.documentId === currentSheet.document_id && m.pageIndex === currentSheet.page_index && m.status === 'suggested'
    )));
  }, [currentSheet, mutate, history.present]);

  const [suggestBusy, setSuggestBusy] = useState(false);

  /** Shared by "Suggest markers for this sheet", "Suggest markers" (per
   *  line, from ItemsPanel), and jumping to a "Find tag on sheets…"
   *  result — only `tags` and `lineKeyForTag` (the assignment policy)
   *  differ between callers. */
  const suggestTagsOnSheet = useCallback(async (
    tags: string[], targetSheet: SheetRow, lineKeyForTag: (tag: string) => string | null
  ) => {
    if (!targetSheet.has_text_layer) {
      // Nothing actually FAILED here — this sheet just has no text layer
      // to search. 'info', not 'error' (toastVariants.test.ts's own
      // guardrail: "Nothing ..." copy defaults to reading as a failure
      // unless the variant says otherwise).
      showToast?.({ variant: 'info', title: 'No text on this sheet', sub: 'Nothing to search for tags here.' });
      return;
    }
    if (tags.length === 0) {
      showToast?.({ variant: 'info', title: 'No tag-like text found', sub: 'Nothing to search for on this sheet.' });
      return;
    }
    setSuggestBusy(true);
    try {
      const items = await getSheetTextItems(bidId, targetSheet.document_id, targetSheet.page_index);
      const geom: PageGeometry = { widthPt: targetSheet.width_pt, heightPt: targetSheet.height_pt, rotation: targetSheet.rotation as never };
      const candidates = suggestTagMarkers(items, tags, { geom, sheetKind: targetSheet.kind });
      // Fix round 1 / B3(b) — dedup against the FRESHEST snapshot available
      // right now (post-await), not the `history.present` this callback's
      // closure captured before `getSheetTextItems` ever started (the
      // estimator may well have kept drawing while the text loaded).
      const drafts = draftsFromTagCandidates(
        candidates, targetSheet.document_id, targetSheet.page_index, lineKeyForTag,
        historyPresentRef.current, () => crypto.randomUUID()
      );
      if (drafts.length === 0) {
        showToast?.({ variant: 'info', title: 'No new suggestions', sub: 'Nothing new matched on this sheet.' });
        return;
      }
      // The actual commit spreads onto whatever `current` truly is at
      // commit time (mutate's functional form) — even if something ELSE
      // changed in the narrow window between the dedup above and this
      // call, nothing already in state is ever discarded.
      mutate(current => [...current, ...drafts]);
      showToast?.({ title: `${drafts.length} suggested marker${drafts.length === 1 ? '' : 's'} added` });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not search this sheet', sub: 'Try again' });
    } finally {
      setSuggestBusy(false);
    }
  }, [bidId, history.present, mutate, showToast]);

  const onSuggestForSheet = useCallback(() => {
    if (!currentSheet) return;
    const idx = lineTagIndex;
    void suggestTagsOnSheet(Array.from(idx.keys()), currentSheet, tag => {
      const keys = idx.get(tag);
      return keys && keys.length === 1 ? keys[0] : null; // ambiguous/unknown -> unassigned, left for the Task 6 reassign UI
    });
  }, [currentSheet, lineTagIndex, suggestTagsOnSheet]);

  const onSuggestForLine = useCallback((line: EstimateLine) => {
    if (!currentSheet || !line.line_key) return;
    const fixedKey = line.line_key;
    const tags = candidateTagsFromDescription(line.description);
    if (tags.length === 0) {
      showToast?.({ title: 'No tag-like text', sub: "This line's description has nothing that looks like a plan tag." });
      return;
    }
    void suggestTagsOnSheet(tags, currentSheet, () => fixedKey); // explicit — this line, not the ambiguity index
  }, [currentSheet, suggestTagsOnSheet, showToast]);

  const [findTagResults, setFindTagResults] = useState<FindTagResult[] | null>(null);
  const [findTagBusy, setFindTagBusy] = useState(false);
  const lastFindTagRef = useRef<string | null>(null);

  const onFindTag = useCallback(async (tag: string) => {
    lastFindTagRef.current = tag;
    setFindTagBusy(true);
    setFindTagResults(null);
    try {
      const searchable = sheets.filter(s => s.has_text_layer);
      const results: FindTagResult[] = [];
      for (const s of searchable) {
        try {
          const items = await getSheetTextItems(bidId, s.document_id, s.page_index);
          const geom: PageGeometry = { widthPt: s.width_pt, heightPt: s.height_pt, rotation: s.rotation as never };
          const candidates = suggestTagMarkers(items, [tag], { geom, sheetKind: s.kind });
          if (candidates.length > 0) {
            results.push({ sheetKey: sheetKey(s.document_id, s.page_index), label: `${s.sheet_no} ${s.title}`.trim(), count: candidates.length });
          }
        } catch { /* one sheet failing to load must never abort the rest of the search */ }
      }
      setFindTagResults(results);
    } finally {
      setFindTagBusy(false);
    }
  }, [bidId, sheets]);

  const onJumpToFindTagResult = useCallback((key: string) => {
    setCurrentKey(key);
    const targetSheet = sheets.find(s => sheetKey(s.document_id, s.page_index) === key);
    const tag = lastFindTagRef.current;
    if (targetSheet && tag) void suggestTagsOnSheet([tag], targetSheet, () => null); // unassigned — the estimator picks the line
  }, [sheets, suggestTagsOnSheet]);

  const suggestedCountOnSheet = useMemo(() => currentPageMarkups.filter(m => m.status === 'suggested').length, [currentPageMarkups]);

  // ── "New line from markup" + reassign selected markers (Task 6, deferral
  // closed) ─────────────────────────────────────────────────────────────
  const [newLineOpen, setNewLineOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [creatingLine, setCreatingLine] = useState(false);

  const selectedMarkups = useMemo(
    () => history.present.filter(m => toolState.selectedIds.includes(m.id)),
    [history.present, toolState.selectedIds]
  );
  // A "New line from markup" selection is expected to be homogeneous (an
  // estimator wouldn't usually multi-select a mix of counts and linear
  // runs to attach to one line) — default to whichever kind is actually
  // present; count (EA) wins a tie/empty selection since Count is this
  // feature's more common case.
  const newLineUnit: EstimateLine['unit'] = selectedMarkups.some(m => m.kind === 'linear') && !selectedMarkups.some(m => m.kind === 'count')
    ? 'LF' : 'EA';

  const onNewLineFromMarkup = useCallback(() => {
    if (toolState.selectedIds.length === 0) return;
    setNewLineOpen(true);
  }, [toolState.selectedIds]);

  const onReassignSelected = useCallback(() => {
    if (toolState.selectedIds.length === 0) return;
    setReassignOpen(true);
  }, [toolState.selectedIds]);

  const createLineFromMarkup = useCallback(async (input: NewLineFromMarkupInput) => {
    const newKey = crypto.randomUUID();
    const newLine: EstimateLine = {
      id: newKey, line_key: newKey, category: input.category, description: input.description,
      qty: input.qty, unit: input.unit, source: 'manual',
      item_id: input.itemId, assembly_id: input.assemblyId,
      material_unit_override: input.materialUnitOverride, labor_hours_override: input.laborHoursOverride,
    };
    const selectedIds = toolState.selectedIds;
    setCreatingLine(true);
    try {
      // Same self-contained "call the bid save endpoint directly, then let
      // the caller refresh" shape as applyLines (below) — PlansWorkspace
      // doesn't own the shared `lines` state (useEstimatingBid does), so a
      // new line is persisted with a full save of the current lines plus
      // this one, exactly like previewPriceImpact already sends `lines`
      // wholesale to the /price endpoint.
      await api.put(`/estimating/${bidId}`, { lines: [...lines, newLine], settings });
      // Fix round 1 / B3(b) — same pattern: reassign against whatever
      // `current` truly is at commit time, not the `history.present` this
      // callback's closure captured before `api.put` ever started.
      mutate(current => reassignMarkups(current, selectedIds, newKey));
      setToolState(s => ({ ...s, selectedIds: [] }));
      setNewLineOpen(false);
      onApplied?.();
      showToast?.({ title: 'Line created', sub: `${selectedIds.length} marker${selectedIds.length === 1 ? '' : 's'} attached` });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not create the line', sub: 'Try again' });
    } finally {
      setCreatingLine(false);
    }
  }, [bidId, lines, settings, mutate, history.present, toolState.selectedIds, onApplied, showToast]);

  const onReassignConfirm = useCallback((lineKeyToAssign: string | null) => {
    mutate(reassignMarkups(history.present, toolState.selectedIds, lineKeyToAssign));
    setToolState(s => ({ ...s, selectedIds: [] }));
    setReassignOpen(false);
  }, [mutate, history.present, toolState.selectedIds]);

  // The unassigned-markers bucket (Task 6, deferral closed) — CONFIRMED
  // markers with no line_key, grouped by sheet, across the whole bid (not
  // just the current sheet — a marker on another sheet is just as "lost"
  // and needs the same visibility). Suggested-but-unconfirmed markers are
  // already visible via SuggestMarkersBar's own "N suggested" indicator on
  // whatever sheet they're on; this bucket is specifically for CONFIRMED
  // markers that rolled up into nothing because nobody assigned them yet.
  const unassignedMarkers = useMemo(() => {
    const bySheet = new Map<string, { sheetKey: string; documentId: string; pageIndex: number; count: number }>();
    for (const m of history.present) {
      if (m.status !== 'confirmed' || m.lineKey) continue;
      const key = sheetKey(m.documentId, m.pageIndex);
      const existing = bySheet.get(key);
      if (existing) existing.count += 1;
      else bySheet.set(key, { sheetKey: key, documentId: m.documentId, pageIndex: m.pageIndex, count: 1 });
    }
    return Array.from(bySheet.values()).map(entry => {
      const s = sheets.find(x => x.document_id === entry.documentId && x.page_index === entry.pageIndex);
      return { sheetKey: entry.sheetKey, label: s ? `${s.sheet_no} ${s.title}`.trim() : entry.sheetKey, count: entry.count };
    });
  }, [history.present, sheets]);

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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
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
              onNewLineFromMarkup={onNewLineFromMarkup}
              onReassignSelected={onReassignSelected}
            />
          </div>
          <button
            type="button"
            className="plan-toolbar-btn"
            style={{ marginRight: 10 }}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </div>
        <KeyboardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        {currentSheet && (
          <SuggestMarkersBar
            hasTextLayer={currentSheet.has_text_layer}
            busy={suggestBusy}
            suggestedCountOnSheet={suggestedCountOnSheet}
            onSuggestForSheet={onSuggestForSheet}
            onConfirmAllOnSheet={onConfirmAllOnSheet}
            onRejectAllOnSheet={onRejectAllOnSheet}
            onFindTag={onFindTag}
            findTagResults={findTagResults}
            findTagBusy={findTagBusy}
            onJumpToFindTagResult={onJumpToFindTagResult}
          />
        )}
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
            onConfirmMarker={onConfirmMarker}
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
        <NewLineFromMarkupModal
          open={newLineOpen}
          selectedCount={toolState.selectedIds.length}
          unit={newLineUnit}
          categories={TAKEOFF_CATEGORIES}
          library={library ?? null}
          busy={creatingLine}
          onCancel={() => setNewLineOpen(false)}
          onCreate={createLineFromMarkup}
        />
        <ReassignMarkersModal
          open={reassignOpen}
          selectedCount={toolState.selectedIds.length}
          lines={lines}
          onCancel={() => setReassignOpen(false)}
          onReassign={onReassignConfirm}
        />
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
        onSuggestMarkersForLine={onSuggestForLine}
        unassignedMarkers={unassignedMarkers}
        onJumpToUnassigned={key => setCurrentKey(key)}
      />
    </div>
  );
}
