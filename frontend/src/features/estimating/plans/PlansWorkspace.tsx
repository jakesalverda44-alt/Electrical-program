// Estimating Phase B, Task 4-8 — the Plans view's top-level component:
// wires SheetNavigator + PlanViewer + Toolbar + ItemsPanel + the markup
// draft/history/autosave/rollup pipeline together. This is the ONE module
// PcWorkspaceView.tsx's Takeoff step React.lazy()-imports (Task 9) — see
// index.ts's default export.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { Toast } from '../../../types';
import { EstimateLine, EstimateSettings, SheetRow, SheetDiscipline, MarkupWire, RollupEntry, ApplyMarkupsResponse, Library, SaveBidResponse, SheetsResponse, IndexStatus } from '../types';
import { useConfirm } from '../../../components/ConfirmDialog';
import SheetNavigator, { sheetKey } from './SheetNavigator';
import PlanViewer from './PlanViewer';
import Toolbar from './Toolbar';
import ItemsPanel from './ItemsPanel';
import ScaleCalibrationPopover from './ScaleCalibrationPopover';
import DropsSlackPopover from './DropsSlackPopover';
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
  /** Fix round 1 / B1 — called after a successful apply-markups with the
   *  save-transaction's own {lines, recap} (already returned by the
   *  apply-markups endpoint — see routes/estimating.ts's ApplyMarkupsResult).
   *  The caller (PcWorkspaceView) is expected to install these DIRECTLY
   *  into useEstimatingBid (installSaved), not merely refetch-and-hope —
   *  useEstimatingBid.reload() alone never actually re-hydrated past its
   *  own first-load guard, which is exactly what silently reverted every
   *  applied quantity on the estimator's next Labor & Pricing save. */
  onApplied?: (saved: SaveBidResponse) => void;
  /** Fix round 1 / B1 — true when Labor & Pricing has unsaved edits
   *  (useEstimatingBid.dirty). Apply and "New line from markup" both check
   *  this FIRST (see ensureLinesSavedFirst) and prompt to save before
   *  proceeding — neither is allowed to silently overwrite unsaved work in
   *  either direction. */
  dirty?: boolean;
  /** Fix round 1 / B1 — estimatingBid.save(), used by
   *  ensureLinesSavedFirst's "save first" prompt AND (Fix round 1 / B2)
   *  the proposed-mapping banner's one-click save. */
  onSaveDirtyLinesFirst?: () => Promise<void>;
  /** Fix round 1 / B2 — true when the estimate has never been saved
   *  (useEstimatingBid.proposed): its lines carry "proposed-N" placeholder
   *  line_keys, not real UUIDs. A marker drawn against one can never
   *  survive past this session, so Count/Linear are disabled and a banner
   *  offers to save the estimate (via onSaveDirtyLinesFirst) first. */
  proposed?: boolean;
  /** Fix round 1 / B1 — replaces PlansWorkspace's own direct `api.put` of a
   *  `[...lines, newLine]` snapshot (built from the `lines` PROP, which
   *  useEstimatingBid.reload() never actually refreshed — B1's other
   *  failure mode: the new line vanished on the next Labor & Pricing save
   *  because it was never in the SHARED lines state to begin with). The
   *  caller is expected to add `newLine` through its own live
   *  estimatingBid.setLines + save(nextLines), so there is exactly ONE
   *  owner of `lines` and no snapshot can ever go stale. Returns whether
   *  the line was actually created. */
  onCreateLine?: (newLine: EstimateLine) => Promise<boolean>;
  /** Fix round 1 / B8 — Decision 7's own defaults (Settings > Labor
   *  Library > Defaults, app_settings.est_default_drop_ft/
   *  est_default_slack_pct), stamped onto every new linear run at
   *  creation time. Falls back to 10/10 (the migration's own seeded
   *  values) when omitted, e.g. a test harness with no app settings wired
   *  up. */
  defaultDropFt?: number;
  defaultSlackPct?: number;
  viewOnly?: boolean;
  /** Matches the rest of the estimating feature's convention (see
   *  LaborPricingStep.tsx) of taking showToast as a prop rather than
   *  reading it via context — keeps this component testable without an
   *  <AppProviders> wrapper. Toasts are simply skipped when omitted. */
  showToast?: (t: Toast) => void;
}

export default function PlansWorkspace({
  bidId, lines, settings, initialSheetKey, initialLineKey, onSheetKeyChange, onLineKeyChange, onApplied,
  dirty, onSaveDirtyLinesFirst, onCreateLine, proposed, defaultDropFt = 10, defaultSlackPct = 10,
  viewOnly: viewOnlyProp, showToast,
}: PlansWorkspaceProps) {
  const confirm = useConfirm();
  // Fix round 1 / B1 — shared by Apply and "New line from markup": if
  // Labor & Pricing has unsaved edits, ask before either proceeds (never
  // silently overwrite in either direction — installSaved/save(nextLines)
  // both replace the ENTIRE lines array, which would otherwise discard
  // whatever the estimator was mid-typing on the Pricing screen).
  const ensureLinesSavedFirst = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    const ok = await confirm({
      title: 'Save Labor & Pricing changes first?',
      body: 'You have unsaved changes in Labor & Pricing. They need to be saved before this action can continue.',
      confirmLabel: 'Save and continue',
    });
    if (!ok) return false;
    if (!onSaveDirtyLinesFirst) return true; // no save hook wired (e.g. a test harness) — proceed, matching the pre-fix behavior for that case
    try {
      await onSaveDirtyLinesFirst();
      return true;
    } catch {
      showToast?.({ variant: 'error', title: 'Could not save your Labor & Pricing changes', sub: 'Try again' });
      return false;
    }
  }, [dirty, confirm, onSaveDirtyLinesFirst, showToast]);

  // Fix round 1 / B2 — one-click "save the proposed mapping" for the
  // Count/Linear-disabled banner (below). This is the SAME action as
  // onSaveDirtyLinesFirst (estimatingBid.save()) — a proposed mapping's
  // lines are exactly what gets PUT, minting real UUIDs for every
  // "proposed-N" placeholder line_key in the same transaction.
  const [savingProposed, setSavingProposed] = useState(false);
  const onSaveProposedMapping = useCallback(async () => {
    if (!onSaveDirtyLinesFirst) return;
    setSavingProposed(true);
    try {
      await onSaveDirtyLinesFirst();
      showToast?.({ title: 'Estimate saved', sub: 'You can now mark up the plans.' });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not save the estimate', sub: 'Try again' });
    } finally {
      setSavingProposed(false);
    }
  }, [onSaveDirtyLinesFirst, showToast]);

  // Decision 2 — below 900px, view-only regardless of the caller's own prop
  // (a caller can still force it on above 900px, e.g. a read-only role —
  // that's what the prop is for; the viewport check only ever ADDS the
  // restriction, never removes one the caller asked for).
  const isNarrow = useIsNarrowViewport();
  const viewOnly = !!viewOnlyProp || isNarrow;
  const { data: sheetsData, loading: sheetsLoading, reload: reloadSheets } = useApi<SheetsResponse>(`/estimating/${bidId}/sheets`);
  const sheets = useMemo(() => sheetsData?.sheets ?? [], [sheetsData]);
  // Fix round 1 / B9 — indexing runs as a background job now; this poll
  // loop is what actually surfaces "done" once it finishes, the same way
  // a real client is expected to (see sheets.ts's listSheets doc comment).
  // Stops polling the instant every known document reaches a terminal
  // status ('done' or 'failed') — never runs forever once there's nothing
  // left to wait on, and restarts automatically if a NEW document shows up
  // (e.g. a plan file uploaded from another tab) with a non-terminal
  // status the next time sheetsData refreshes.
  const indexStatuses = useMemo(() => sheetsData?.statuses ?? {}, [sheetsData]);
  const sheetsIndexing = useMemo(
    () => Object.values(indexStatuses).some(s => s === 'pending' || s === 'indexing'),
    [indexStatuses]
  );
  useEffect(() => {
    if (!sheetsIndexing) return;
    const id = setInterval(() => reloadSheets(), 2000);
    return () => clearInterval(id);
  }, [sheetsIndexing, reloadSheets]);
  // "Refresh sheets" (S12/B9 — never built before this round): a single
  // explicit `?refresh=1` request (never sent on every poll tick — that
  // would keep resetting an already-'done' document back to 'pending' the
  // instant this loop next observed it, chasing a moving target forever),
  // then handed off to the normal (unrefreshed) poll above to watch it
  // through to 'done'/'failed'.
  const [refreshingSheets, setRefreshingSheets] = useState(false);
  const onRefreshSheets = useCallback(async () => {
    setRefreshingSheets(true);
    try {
      await api.get(`/estimating/${bidId}/sheets`, { params: { refresh: 1 } });
    } catch {
      // best-effort kickoff — the poll loop above will keep reading
      // whatever state actually landed either way.
    } finally {
      setRefreshingSheets(false);
    }
    reloadSheets();
  }, [bidId, reloadSheets]);
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

  // Fix round 1 / B8 — the marker id the DropsSlackPopover is currently
  // open for: set the instant a linear run finishes (dispatch's
  // 'commitLinear' branch below), or by the toolbar's "Edit drops/slack"
  // button for an already-selected linear marker. null means closed.
  const [dropsSlackTargetId, setDropsSlackTargetId] = useState<string | null>(null);

  // Fix round 1 / N1 — the previous version called setToolState(prev =>
  // {...; mutate(...); crypto.randomUUID(); ...; return state;}) — side
  // effects (another state setter, AND a fresh random id) INSIDE a
  // setState updater. Under <React.StrictMode> (main.tsx), React invokes
  // an updater function twice in dev to surface exactly this class of
  // impurity — crypto.randomUUID() would mint a DIFFERENT id on the
  // second (discarded) invocation than what actually got used, and a
  // phantom undo step could appear whose marker id doesn't match anything
  // real. `dispatch` is only ever called from a single discrete user
  // action (a click, a keypress) — reading `toolState` via this
  // callback's own closure (recreated whenever toolState itself changes)
  // is exactly as fresh as the old `prev` was for that use, without
  // needing a functional update at all.
  const dispatch = useCallback((event: ToolEvent) => {
    const { state, effect } = reduceTool(toolState, event);
    setToolState(state);
    if (effect.type === 'commitCount') {
      const draft: MarkupDraft = {
        id: crypto.randomUUID(), documentId: currentSheet?.document_id ?? '', pageIndex: currentSheet?.page_index ?? 0,
        lineKey: activeLineKey, kind: 'count', points: [effect.point], drops: 0, dropFt: null, slackPct: null,
        status: 'confirmed', label: null,
      };
      mutate(createMarkup(history.present, draft));
    } else if (effect.type === 'commitLinear') {
      // Fix round 1 / B8 — stamp the app-wide drops/slack defaults onto
      // every new run at creation time (Decision 7's own fallback, in
      // case the popover this opens is dismissed without editing
      // anything), then open the popover so the estimator can adjust
      // them for THIS run immediately.
      const draft: MarkupDraft = {
        id: crypto.randomUUID(), documentId: currentSheet?.document_id ?? '', pageIndex: currentSheet?.page_index ?? 0,
        lineKey: activeLineKey, kind: 'linear', points: effect.points,
        drops: 0, dropFt: defaultDropFt, slackPct: defaultSlackPct,
        status: 'confirmed', label: null,
      };
      mutate(createMarkup(history.present, draft));
      setDropsSlackTargetId(draft.id);
    } else if (effect.type === 'commitScalePoints') {
      setPendingScalePoints(effect.points);
    }
  }, [toolState, currentSheet, activeLineKey, mutate, history.present, defaultDropFt, defaultSlackPct]);

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

  // Fix round 1 / B8 — the popover's actual target marker (or null once
  // it's been deleted/undone out from under an open popover — the
  // popover just closes itself rather than rendering against nothing).
  const dropsSlackTarget = useMemo(
    () => (dropsSlackTargetId ? history.present.find(m => m.id === dropsSlackTargetId) ?? null : null),
    [dropsSlackTargetId, history.present]
  );
  useEffect(() => {
    if (dropsSlackTargetId && !dropsSlackTarget) setDropsSlackTargetId(null);
  }, [dropsSlackTargetId, dropsSlackTarget]);
  const onDropsSlackChange = useCallback((patch: { drops?: number; dropFt?: number | null; slackPct?: number | null }) => {
    if (!dropsSlackTargetId) return;
    mutate(updateMarkup(history.present, dropsSlackTargetId, patch));
  }, [dropsSlackTargetId, mutate, history.present]);
  const onCloseDropsSlack = useCallback(() => setDropsSlackTargetId(null), []);
  // Toolbar's "Edit drops/slack" — enabled only when exactly one linear
  // marker is selected (editing drops/slack on a count marker is
  // meaningless; editing several runs' drops/slack at once is ambiguous,
  // same reasoning as Reassign's own single-vs-multi affordances).
  const selectedLinearMarker = useMemo(() => {
    if (toolState.selectedIds.length !== 1) return null;
    const m = history.present.find(x => x.id === toolState.selectedIds[0]);
    return m && m.kind === 'linear' ? m : null;
  }, [toolState.selectedIds, history.present]);
  const onEditDropsSlack = useCallback(() => {
    if (selectedLinearMarker) setDropsSlackTargetId(selectedLinearMarker.id);
  }, [selectedLinearMarker]);

  // ── Scale calibration ────────────────────────────────────────────────────
  const [pendingScalePoints, setPendingScalePoints] = useState<[PdfPoint, PdfPoint] | null>(null);
  // Fix round 1 / B7 — `source` distinguishes an estimator's own two-point
  // measurement ('calibrated', the default — every EXISTING caller of
  // this) from a one-click CONFIRM of the title-block suggestion
  // ('titleblock', used only by onConfirmSuggestedScale below). Both are
  // equally "confirmed" for gating purposes (Linear only cares that
  // ft_per_pt IS set) — the distinction is purely informational display.
  const commitScale = useCallback(async (ftPerPt: number, label: string, source: 'calibrated' | 'titleblock' = 'calibrated') => {
    if (!currentSheet) return;
    try {
      await api.put(`/estimating/${bidId}/sheets/${currentSheet.document_id}/${currentSheet.page_index}/scale`, {
        ft_per_pt: ftPerPt, source, label,
      });
      await reloadSheets();
      showToast?.({ title: 'Scale set', sub: label });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not set the scale', sub: 'Try again' });
    } finally {
      setPendingScalePoints(null);
    }
  }, [bidId, currentSheet, reloadSheets, showToast]);

  // Fix round 1 / B7 — the ONE-CLICK confirm for the title-block
  // suggestion, with no calibration line drawn at all (Decision 6 always
  // required drawing two points first; the suggestion banner below is the
  // "one click to confirm" the fix asks for).
  const [confirmingScale, setConfirmingScale] = useState(false);
  const onConfirmSuggestedScale = useCallback(async () => {
    if (!currentSheet || currentSheet.suggested_ft_per_pt == null || !currentSheet.suggested_label) return;
    setConfirmingScale(true);
    try {
      await commitScale(currentSheet.suggested_ft_per_pt, currentSheet.suggested_label, 'titleblock');
    } finally {
      setConfirmingScale(false);
    }
  }, [currentSheet, commitScale]);

  // Fix round 1 / B7 — the "Half-size set?" toggle, per document.
  const [settingHalfSize, setSettingHalfSize] = useState(false);
  const onToggleHalfSize = useCallback(async () => {
    if (!currentSheet) return;
    setSettingHalfSize(true);
    try {
      await api.put(`/estimating/${bidId}/sheets/${currentSheet.document_id}/half-size`, {
        half_size: !currentSheet.half_size,
      });
      await reloadSheets();
    } catch {
      showToast?.({ variant: 'error', title: 'Could not update half-size', sub: 'Try again' });
    } finally {
      setSettingHalfSize(false);
    }
  }, [bidId, currentSheet, reloadSheets, showToast]);

  // ── Apply markups ────────────────────────────────────────────────────────
  const applyLines = useCallback(async (lineKeys: string[]) => {
    // Fix round 1 / B1 — never silently overwrite unsaved Labor & Pricing
    // work: apply-markups' own response REPLACES the entire lines array
    // (via installSaved) once it lands, which would otherwise discard
    // whatever the estimator was mid-editing there.
    if (!(await ensureLinesSavedFirst())) return;
    try {
      const { data } = await api.post<ApplyMarkupsResponse>(`/estimating/${bidId}/apply-markups`, { line_keys: lineKeys });
      if (data.skipped.length > 0) {
        showToast?.({ variant: 'error', title: 'Some lines could not be applied', sub: data.skipped.map(s => s.reason).join('; ') });
      } else {
        showToast?.({ title: `Applied ${data.applied.length} line${data.applied.length === 1 ? '' : 's'}` });
      }
      // Fix round 1 / B1 — install the save transaction's own {lines,
      // recap} directly; this IS the fix for "apply, then any later Labor
      // & Pricing save silently reverts the applied quantity" (the caller
      // no longer relies on a reload() that never actually re-hydrated).
      onApplied?.(data.save);
      await reloadRollup();
    } catch {
      showToast?.({ variant: 'error', title: 'Apply failed', sub: 'Try again' });
    }
  }, [bidId, ensureLinesSavedFirst, onApplied, reloadRollup, showToast]);

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
    // Fix round 1 / B1 — same "never silently overwrite" rule as Apply.
    if (!(await ensureLinesSavedFirst())) return;
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
      // Fix round 1 / B1 — PlansWorkspace no longer PUTs a `[...lines,
      // newLine]` snapshot itself: `lines` is a PROP, and the caller's own
      // useEstimatingBid.reload() never actually re-hydrated past its
      // first-load guard, so the new line was never in the SHARED lines
      // state — the estimator's very next Labor & Pricing save silently
      // dropped it (and reverted every earlier apply besides, since that
      // save PUT the same stale snapshot). onCreateLine is expected to add
      // it through the caller's own LIVE setLines + save(nextLines) — see
      // PcWorkspaceView.tsx's implementation.
      const ok = onCreateLine ? await onCreateLine(newLine) : false;
      if (!ok) {
        showToast?.({ variant: 'error', title: 'Could not create the line', sub: 'Try again' });
        return;
      }
      // Fix round 1 / B3(b) — same pattern: reassign against whatever
      // `current` truly is at commit time, not the `history.present` this
      // callback's closure captured before the (now-awaited) create ever
      // started.
      mutate(current => reassignMarkups(current, selectedIds, newKey));
      setToolState(s => ({ ...s, selectedIds: [] }));
      setNewLineOpen(false);
      showToast?.({ title: 'Line created', sub: `${selectedIds.length} marker${selectedIds.length === 1 ? '' : 's'} attached` });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not create the line', sub: 'Try again' });
    } finally {
      setCreatingLine(false);
    }
  }, [ensureLinesSavedFirst, onCreateLine, mutate, toolState.selectedIds, showToast]);

  const onReassignConfirm = useCallback((lineKeyToAssign: string | null) => {
    mutate(reassignMarkups(history.present, toolState.selectedIds, lineKeyToAssign));
    setToolState(s => ({ ...s, selectedIds: [] }));
    setReassignOpen(false);
  }, [mutate, history.present, toolState.selectedIds]);

  // Fix round 1 / S6 — a marker's lineKey can go "dead" without ever being
  // cleared: the line it pointed at gets excluded in Labor & Pricing, a
  // sync-takeoff re-keys or drops the takeoff line entirely, or (B1's own
  // now-closed gap) a "New line from markup" line silently failed to
  // persist. Before this fix such a marker was invisible forever — not in
  // the unassigned bucket (it still HAS a lineKey), and not counted
  // anywhere live (the line it points at is gone or excluded from the
  // rollup) — drawn on the sheet, contributing to nothing, with no hint
  // anything was wrong. `liveLineKeys` is every NON-excluded line's own
  // line_key — a marker whose lineKey isn't in this set is, functionally,
  // exactly as lost as one with no lineKey at all.
  const liveLineKeys = useMemo(
    () => new Set(lines.filter(l => !l.excluded && l.line_key).map(l => l.line_key as string)),
    [lines]
  );

  // The unassigned-markers bucket (Task 6, deferral closed) — CONFIRMED
  // markers with no line_key (or, per S6 above, a DEAD line_key), grouped
  // by sheet, across the whole bid (not just the current sheet — a marker
  // on another sheet is just as "lost" and needs the same visibility).
  // Suggested-but-unconfirmed markers are already visible via
  // SuggestMarkersBar's own "N suggested" indicator on whatever sheet
  // they're on; this bucket is specifically for CONFIRMED markers that
  // rolled up into nothing because nobody (live) claims them.
  const unassignedMarkers = useMemo(() => {
    const bySheet = new Map<string, { sheetKey: string; documentId: string; pageIndex: number; count: number }>();
    for (const m of history.present) {
      if (m.status !== 'confirmed') continue;
      if (m.lineKey && liveLineKeys.has(m.lineKey)) continue; // assigned to a real, live line
      const key = sheetKey(m.documentId, m.pageIndex);
      const existing = bySheet.get(key);
      if (existing) existing.count += 1;
      else bySheet.set(key, { sheetKey: key, documentId: m.documentId, pageIndex: m.pageIndex, count: 1 });
    }
    return Array.from(bySheet.values()).map(entry => {
      const s = sheets.find(x => x.document_id === entry.documentId && x.page_index === entry.pageIndex);
      return { sheetKey: entry.sheetKey, label: s ? `${s.sheet_no} ${s.title}`.trim() : entry.sheetKey, count: entry.count };
    });
  }, [history.present, sheets, liveLineKeys]);

  // Fix round 1 / S12 — ItemsPanel's own "jump to source sheet" button
  // (onJumpToSource) was already fully built there but never actually
  // wired up from this side, so it silently never rendered. Jumps to the
  // sheet of the line's FIRST confirmed marker (a line can have runs on
  // more than one sheet; "jump to source" is inherently a single
  // destination, same as onJumpToUnassigned's own one-sheet-at-a-time
  // convention just below).
  const onJumpToSource = useCallback((line: EstimateLine) => {
    if (!line.line_key) return;
    const m = history.present.find(x => x.status === 'confirmed' && x.lineKey === line.line_key);
    if (!m) {
      showToast?.({ variant: 'error', title: 'No markup found for this line', sub: 'Nothing has been marked on the plans for it yet.' });
      return;
    }
    setCurrentKey(sheetKey(m.documentId, m.pageIndex));
    setActiveLineKey(line.line_key);
  }, [history.present, showToast]);

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
              countLinearDisabledReason={proposed ? 'Save the estimate first to start marking up plans' : null}
              linearDisabledReason={currentSheet && currentSheet.ft_per_pt == null ? 'This sheet has no confirmed scale yet — calibrate, or confirm the suggested scale below' : null}
              onNewLineFromMarkup={onNewLineFromMarkup}
              onReassignSelected={onReassignSelected}
              onEditDropsSlack={onEditDropsSlack}
              editDropsSlackDisabled={!selectedLinearMarker}
            />
          </div>
          {currentSheet && (
            <label className="plan-half-size-toggle" title="Every sheet of this document was printed at half its designed physical size — doubles the measured scale.">
              <input
                type="checkbox"
                checked={currentSheet.half_size}
                disabled={settingHalfSize}
                onChange={() => void onToggleHalfSize()}
              />
              Half-size set?
            </label>
          )}
          {/* Fix round 1 / B9 — S12 also flagged this as "never built".
              Re-claims every document (including already-'done' ones,
              e.g. a newer revision was uploaded to Drive under the same
              document_id) and re-indexes it in the background; also the
              only way to retry a 'failed' document (see sheets.ts's
              claimDocumentsForIndexing — a plain poll never silently
              retries one on its own). */}
          <button
            type="button"
            className="plan-toolbar-btn"
            style={{ marginRight: 10 }}
            title="Re-index every plan document — also retries any that failed"
            disabled={refreshingSheets}
            onClick={() => void onRefreshSheets()}
          >
            {refreshingSheets ? 'Refreshing…' : 'Refresh sheets'}
          </button>
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
        {sheetsIndexing && (
          <div className="plan-scale-banner" data-testid="plan-sheets-indexing-banner">
            Indexing plan sheets… newly-indexed sheets will appear here as they finish.
          </div>
        )}
        {Object.values(indexStatuses).some(s => s === 'failed') && (
          <div className="plan-scale-banner plan-scale-banner-warn" data-testid="plan-sheets-failed-banner">
            One or more plan documents failed to index. Click &quot;Refresh sheets&quot; to retry.
          </div>
        )}
        {proposed && (
          <div className="plan-proposed-banner" data-testid="plan-proposed-banner">
            <span>This estimate hasn&apos;t been saved yet — save it to start marking up plans.</span>
            <button type="button" className="btn primary sm" disabled={savingProposed} onClick={() => void onSaveProposedMapping()}>
              {savingProposed ? 'Saving…' : 'Save the estimate'}
            </button>
          </div>
        )}
        {/* Fix round 1 / B7 — the title-block scale is a suggestion that
            needs one click to confirm; it's never auto-applied to
            ft_per_pt. A page with more than one distinct scale value
            offers no suggestion at all — calibration is the only path. */}
        {currentSheet && currentSheet.ft_per_pt == null && currentSheet.scale_ambiguous && (
          <div className="plan-scale-banner plan-scale-banner-warn" data-testid="plan-scale-ambiguous-banner">
            Multiple scales on this sheet — calibrate.
          </div>
        )}
        {currentSheet && currentSheet.ft_per_pt == null && !currentSheet.scale_ambiguous
          && currentSheet.suggested_ft_per_pt != null && currentSheet.suggested_label && (
          <div className="plan-scale-banner" data-testid="plan-scale-suggestion-banner">
            <span>Suggested scale (from the title block): {currentSheet.suggested_label}</span>
            <button type="button" className="btn primary sm" disabled={confirmingScale} onClick={() => void onConfirmSuggestedScale()}>
              {confirmingScale ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        )}
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
            // Fix round 1 / B7 — the raw SUGGESTION (never gated on it
            // having been confirmed yet — that's exactly the one-click
            // "Use X" path this popover already offers, independent of
            // the standalone banner above), and never offered at all when
            // the sheet has more than one distinct scale (nothing here
            // can safely say which one the estimator meant).
            titleBlockLabel={currentSheet && !currentSheet.scale_ambiguous ? currentSheet.suggested_label : null}
            onCommit={commitScale}
            onCancel={() => setPendingScalePoints(null)}
          />
        )}
        {dropsSlackTarget && (
          <DropsSlackPopover
            drops={dropsSlackTarget.drops}
            dropFt={dropsSlackTarget.dropFt}
            slackPct={dropsSlackTarget.slackPct}
            onChange={onDropsSlackChange}
            onClose={onCloseDropsSlack}
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
        onJumpToSource={onJumpToSource}
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
