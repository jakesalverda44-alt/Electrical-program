import React, { useState, useRef, useEffect, useCallback, useMemo, useReducer, Suspense } from 'react';
import { Bid, Toast, BidEstimate } from '../../../types';
import { PcWorkspace, PcTabKey, ConfirmedService } from '../constants';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import { useMutation } from '../../../hooks/useMutation';
import { useConfirm } from '../../../components/ConfirmDialog';
import { AppSettings } from '../../../hooks/useAppSettings';
import FilePreviewModal from '../../../components/FilePreviewModal';
import { useDocPreview } from '../../../components/useDocPreview';
import { PrebidSection } from '../prebidScope';
import { overridesFromEstimate } from '../estimateHydrate';
import PreBidTab from '../PreBidTab';
import { BidDataPreview, VerifyFailure } from '../bidDataPreview';
import Icon from '../../../components/Icon';

// Task 9 (audit code #10) — this file was 3,175 lines and one component. The
// tabs are their own memoized modules now; this parent keeps the workspace
// state, the autosave and the data fetches, and hands each tab the slice it
// renders. Nothing about what is rendered changed.
import { ProjectDoc, SetWorkspace, STEP_ORDER, TakeoffOnFile } from './shared';
import { historicalCostsCache, unitCostLibCache, useGlobalPcCache } from './globalCache';
import { isElecSheet, parseAgent1Service, parseAgentJson, scopeSectionsFrom } from './parsing';
import { POLL_TIMEOUT_MESSAGE, useAiPoller } from './useAiPoller';
import { useStableFn } from './useStableFn';
import { importReducer, initialImportState } from './importReducer';
import FilesTab from './FilesTab';
import BidTab from './BidTab';
import TakeoffTab from './TakeoffTab';
import ScopeTab from './ScopeTab';
import RfisTab from './RfisTab';
import ProposalTab from './ProposalTab';
import CostsTab from './CostsTab';
import IntelTab from './IntelTab';
import ImportPanel, { ImportPanelProps } from './ImportPanel';
// Task 7/8/9 (estimating redesign) — the new shell replaces StepTracker+
// TabStrip's chrome; LaborPricingStep+useEstimatingBid replace PricingTab
// (still present, unrendered — see the estimating report for why it wasn't
// deleted outright); BidSummary takes CostsTab/IntelTab as its Insights slot.
import { useEstimateStepParam } from '../../estimating/useEstimateStepParam';
import { useEstimatingBid } from '../../estimating/useEstimatingBid';
// Task 12 — EstimateShell/BidSummary/LaborPricingStep (the presentational,
// bundle-heavy part) load as their own chunk; useEstimateStepParam/
// useEstimatingBid above are hooks and must stay a static import.
const EstimatingWorkspace = React.lazy(() => import('../../estimating/EstimatingWorkspace'));
import { EstimateStepKey, mapLegacyTabToStep, stepToLegacyTab, deriveStepStatus, legacyTabWantsInsights, ESTIMATE_STEPS } from '../../estimating/steps';

const ESTIMATE_STEP_ORDER = ESTIMATE_STEPS.map(s => s.key);
const ESTIMATE_STEP_LABELS = Object.fromEntries(ESTIMATE_STEPS.map(s => [s.key, s.label])) as Record<EstimateStepKey, string>;

// Stable empty values, so `?? []` does not hand a fresh object to a useMemo
// dependency list on every render.
const EMPTY_COSTS: Array<Record<string, unknown>> = [];
const EMPTY_UNIT_COST_LIB = { global: {} as Record<string, number>, by_project_type: {} as Record<string, Record<string, number>> };

interface Props {
  ws: PcWorkspace;
  bid: Bid;
  onUpdate: (ws: PcWorkspace) => void;
  onBack: () => void;
  onConverted: (bid: Bid) => void;
  onBidUpdated: (bid: Bid) => void;
  showToast: (t: Toast) => void;
  userRole?: string;
  settings?: AppSettings;
  embedded?: boolean;
  /** When set (embedded in BidHubPage), renders a link in the Files panel that
   *  navigates to the hub's Files tab — the place to view/download every project
   *  file, not just the PDFs/images this panel offers to the AI pipeline. */
  onGoFiles?: () => void;
}

export default function PcWorkspaceView({ ws, bid, onUpdate, onBack, onConverted, onBidUpdated, showToast, userRole, settings, embedded, onGoFiles }: Props) {
  const confirm = useConfirm();
  const [convertOpen, setConvertOpen] = useState(false);
  const [newRfi, setNewRfi] = useState('');
  const [rfiSubmitting, setRfiSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileObjectsRef = useRef<File[]>([]);
  const [aiResults, setAiResults] = useState<Record<string, unknown> | null>(null);
  const [analysisTab, setAnalysisTab] = useState<'agent1'|'agent2'|'agent3'|'raw'>('agent1');
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedCostRow, setExpandedCostRow] = useState<number | null>(null);
  const [costTypeFilter, setCostTypeFilter] = useState<string>('all');
  const [savedEstimate, setSavedEstimate] = useState<BidEstimate | null>(null);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  // Populated by the pre-bid package fetch (Task 7). Empty until then, so the
  // "Import from Pre-Bid" button simply stays hidden.
  const [prebidSections, setPrebidSections] = useState<PrebidSection[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [svcVoltage,  setSvcVoltage]  = useState(() => ws.confirmedService?.voltage  ?? '');
  const [svcAmpacity, setSvcAmpacity] = useState(() => ws.confirmedService?.ampacity ?? '');
  const [svcPanel,    setSvcPanel]    = useState(() => ws.confirmedService?.panel    ?? '');
  const [propPrice,  setPropPrice]  = useState('');
  // Fix round 1 / S3 — true once the estimator has typed into the proposal
  // price field themselves; blocks the auto-sync effect (below) from
  // clobbering a deliberate manual override, the same way qty_overridden
  // protects an estimator's hand-typed qty from a sync-takeoff refresh.
  const [propPriceEdited, setPropPriceEdited] = useState(false);
  const [propNotes,  setPropNotes]  = useState('');
  // A 400 from run-agent4 (e.g. an unparseable price) happens synchronously, before
  // agent4_status is ever touched — the polling-driven "Agent 4 Did Not Complete"
  // panel below (agent4Status === 'error') can't show it. Surfaced separately, inline.
  const [agent4StartError, setAgent4StartError] = useState<string | null>(null);
  const [agent4Running, setAgent4Running] = useState(false);
  // Task 7 — the composed BidData (same shape whether agent4_output is in
  // Agent 4's new data-only contract or the pre-Phase-3 legacy shape; the
  // backend's adapter normalizes either).
  const [proposalPreview, setProposalPreview] = useState<BidDataPreview | null>(null);
  // Phase 4 Task 1.4 — Send Proposal modal.
  const [sendProposalOpen, setSendProposalOpen] = useState(false);
  // Phase 4 Task 1.5 — Email to Chris (draft) button state.
  const [chrisDraftBusy, setChrisDraftBusy] = useState(false);
  const [chrisDraftLink, setChrisDraftLink] = useState<string | null>(null);
  // The 422 verify-gate's failures[] (Task 6/7) — a doctored/incomplete
  // proposal never downloads silently; this panel tells the estimator
  // exactly what to fix.
  const [verifyFailures, setVerifyFailures] = useState<VerifyFailure[] | null>(null);
  // FIX-12 — downloadDocx had no busy-state, unlike its xlsx/prebid
  // siblings, so a double-click could double-file the same generation.
  const [prebidBusy, setPrebidBusy] = useState(false);
  const [prebidResult, setPrebidResult] = useState<{ scopeDocumentId: string | null; takeoffDocumentId: string | null } | null>(null);

  // The Import-Finished-Bid panel's six useStates, collapsed into one reducer
  // (audit code #10). Still owned here rather than by the panel, so a
  // half-finished import survives a tab switch exactly as it used to.
  const [importState, importDispatch] = useReducer(importReducer, initialImportState);
  // Six independent reads. The two global ones (historical costs, unit-cost
  // library) are identical for every bid, so they go through the
  // session-cached useGlobalPcCache (globalCache.ts) instead of useApi — Task 7 (audit
  // data #16). The four bid-scoped ones stay on useApi, one hook each: each
  // cancels on its own key change, so switching bids can no longer land bid
  // A's takeoff on bid B's workspace.
  const historicalCostsData = useGlobalPcCache(historicalCostsCache, '/preconstruction/costs');
  const historicalCosts = useMemo(() => historicalCostsData ?? EMPTY_COSTS, [historicalCostsData]);
  const { data: takeoffOnFile, reload: reloadTakeoff } = useApi<TakeoffOnFile>(`/preconstruction/${bid.id}/takeoff`);
  const { data: bidIntel } = useApi<Record<string, unknown>>(`/preconstruction/intelligence/${bid.id}`);
  const unitCostLibData = useGlobalPcCache(unitCostLibCache, '/estimates/unit-costs');
  // Task 10 — Bid Summary's $/SF-vs-comparables bar reuses the same
  // /comparables data the Compare tab and Overview's SimilarBidsPanel read.
  const { data: comparablesData } = useApi<{ comparables?: { amount: string | null; sq_ft: number | null }[] }>(
    `/preconstruction/${bid.id}/comparables`
  );
  const comparablesForSummary = useMemo(
    () => (comparablesData?.comparables ?? []).map(c => ({
      amount: c.amount != null ? Number(c.amount) : null,
      sqFt: c.sq_ft != null ? Number(c.sq_ft) : null,
    })),
    [comparablesData]
  );
  const unitCostLib = useMemo(() => unitCostLibData ?? EMPTY_UNIT_COST_LIB, [unitCostLibData]);
  const [openTakeoffCat, setOpenTakeoffCat] = useState<string | null>(null);
  const saveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsRef = useRef(ws);
  wsRef.current = ws;

  // ── Autosave ──────────────────────────────────────────────────────────
  // This PUT is the only persistence for estimator notes, scope text and RFIs,
  // and it used to end in `.catch(() => {})` — a dropped connection lost an
  // afternoon of pre-construction work with zero indication (audit code #6).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(0);
  // Armed in the effect BODY, not just cleared in its cleanup: React.StrictMode
  // (main.tsx) mounts, unmounts and remounts every component in dev, and the
  // live app runs under Vite dev. A flag only ever set false by the cleanup
  // stayed false forever, so every `if (!aliveRef.current) return` below fired
  // and the chip stuck on "Saving…" with no retries — all of task 7 inert in
  // the one environment it was written for.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const workspacePayload = useCallback(() => {
    const w = wsRef.current;
    return {
      step: w.step,
      active_tab: w.activeTab,
      notes: w.notes,
      scope: w.scope,
      rfis: w.rfis,
      files: w.files,
      ai_done: w.aiDone,
      proposal_generated: w.proposalGenerated,
      confirmed_service: w.confirmedService ?? null,
      // Task 11 — struck from Batch 2: the continuous autosave now carries
      // these too, not only the deliberate "Save Estimate" action.
      overhead_pct: w.overheadPct,
      profit_pct: w.profitPct,
      estimate_overrides: w.estimateOverrides,
    };
  }, []);

  // Retries always send the CURRENT payload, not the one that failed, so an
  // edit made while a retry was pending is not silently dropped.
  const saveWorkspace = useCallback(async () => {
    setSaveState('saving');
    try {
      await api.put(`/preconstruction/${bid.id}/workspace`, workspacePayload());
      if (!aliveRef.current) return;
      backoffRef.current = 0;
      setSaveState('saved');
    } catch {
      if (!aliveRef.current) return;
      setSaveState('error');
      const next = Math.min(30_000, backoffRef.current === 0 ? 2_000 : backoffRef.current * 2);
      backoffRef.current = next;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { void saveWorkspace(); }, next);
    }
  }, [bid.id, workspacePayload]);

  // The mount guard is the payload we last acted on, not a "have we rendered
  // once" boolean: a boolean is consumed by StrictMode's first mount and lets
  // the remount write the no-op PUT it exists to prevent (audit data #16). A
  // snapshot is idempotent — the remount sees identical values and skips — and
  // it also drops the redundant PUT when this effect re-runs because
  // `saveWorkspace`'s identity changed but nothing the user typed did.
  const lastScheduledRef = useRef<string | null>(null);
  // Declared before the autosave effect so it runs first: effects fire in
  // declaration order, so a new bid resets the baseline before it is read.
  useEffect(() => { lastScheduledRef.current = null; }, [bid.id]);

  // Auto-save workspace to DB 800ms after last change (skip ephemeral fields)
  useEffect(() => {
    const snapshot = JSON.stringify(workspacePayload());
    if (lastScheduledRef.current === null) {
      // First render for this bid: what we are holding IS what the server sent.
      lastScheduledRef.current = snapshot;
      return;
    }
    if (lastScheduledRef.current === snapshot) return;
    lastScheduledRef.current = snapshot;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // A fresh edit supersedes any pending retry and resets the backoff.
      if (retryTimer.current) clearTimeout(retryTimer.current);
      backoffRef.current = 0;
      void saveWorkspace();
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [ws.step, ws.activeTab, ws.notes, ws.scope, ws.rfis, ws.files, ws.aiDone, ws.proposalGenerated, ws.confirmedService,
      ws.overheadPct, ws.profitPct, ws.estimateOverrides, saveWorkspace, workspacePayload]);


  // Stable identity, so the memoized tabs below do not re-render just because
  // this component's parent handed it a new `onUpdate` closure (BidHubPage
  // creates one every render). Behaviour is unchanged: the ref always holds the
  // latest onUpdate, and `set` still reads the current workspace off wsRef.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const set = useCallback<SetWorkspace>(patchOrFn => {
    const current = wsRef.current;
    if (typeof patchOrFn === 'function') {
      onUpdateRef.current({ ...current, ...patchOrFn(current) });
    } else {
      onUpdateRef.current({ ...current, ...patchOrFn });
    }
  }, []);
  const showToastStable = useStableFn(showToast);
  const onBidUpdatedStable = useStableFn(onBidUpdated);

  const advanceStep = () => {
    const idx = STEP_ORDER.indexOf(wsRef.current.step);
    if (idx < STEP_ORDER.length - 1) set({ step: STEP_ORDER[idx + 1] });
  };

  // Pricing lives in `ws` (overhead %, profit %, per-line overrides) and is only
  // persisted by the Pricing tab's explicit "Save Estimate", so leaving with
  // unsaved pricing threw it away. An autosave stuck in `error` counts as
  // unsaved too — that is the case task 7's retry chain cannot finish.
  // Post-review B4 — Number() both sides: bid_estimates.overhead_pct/
  // profit_pct are Postgres `numeric` columns, which pg serializes as
  // strings (e.g. "22.00"); ws.overheadPct/profitPct are always real numbers
  // (the hydration effect above now also normalizes with Number()). Without
  // this, `22 !== "22.00"` is always true and this was permanently dirty
  // whenever a saved estimate/workspace row had ever hydrated — a false
  // "unsaved changes" prompt on every hub tab of every bid with autosaved
  // pricing.
  const pricingDirty = savedEstimate
    ? (Number(ws.overheadPct) !== Number(savedEstimate.overhead_pct)
      || Number(ws.profitPct) !== Number(savedEstimate.profit_pct)
      || JSON.stringify(ws.estimateOverrides) !== JSON.stringify(overridesFromEstimate(savedEstimate.line_items)))
    : (ws.overheadPct !== 10 || ws.profitPct !== 15 || Object.keys(ws.estimateOverrides).length > 0);
  useUnsavedGuard(pricingDirty || saveState === 'error');


  // ── Polling ───────────────────────────────────────────────────────────
  // Both AI poll loops, their shared cancellation flag and the mount-time
  // reconnect moved to useAiPoller (audit code #10) unchanged.
  const { pollTimedOut, pollForResults, pollAgent4 } = useAiPoller({
    bidId: bid.id,
    set,
    setAiResults,
    setAgent4Running,
    showToast: showToastStable,
  });

  const { data: savedEstimateData, loading: savedEstimateLoading } = useApi<BidEstimate>(`/estimates/${bid.id}`);
  useEffect(() => { if (savedEstimateData) setSavedEstimate(savedEstimateData); }, [savedEstimateData]);

  // Unfiltered — the "From Project Files" panel shows every project document;
  // eligibility for AI analysis (PDF/image only) is enforced per-row via
  // isPdfOrImage() at render time, not by hiding files here.
  const { data: projectDocsData, reload: reloadProjectDocs } = useApi<ProjectDoc[]>('/documents', {
    params: { linked_id: bid.id },
  });
  useEffect(() => { if (projectDocsData) setProjectDocs(projectDocsData); }, [projectDocsData]);

  // Task 11 — struck from Batch 2: bid_workspaces also carries overhead_pct/
  // profit_pct/estimate_overrides now (via the continuous autosave), not
  // only bid_estimates (written only by the deliberate "Save Estimate"
  // action). GET /preconstruction/:bidId/workspace, added in Task 11.
  const { data: workspaceRow, loading: workspaceRowLoading } = useApi<{
    overhead_pct: number | string | null;
    profit_pct: number | string | null;
    estimate_overrides: Record<string, number> | null;
    updated_at: string | null;
  } | null>(`/preconstruction/${bid.id}/workspace`);

  // Post-review B4 — hydrate overhead/profit/overrides from whichever
  // pricing source is authoritative, deterministically rather than
  // "whichever of the two async fetches resolves first wins" (the previous
  // shape: two independent effects gated on the same pristine check). Rule:
  // the bid_estimates values apply first; the bid_workspaces row overrides
  // them only when it is strictly newer (compare updated_at) — the autosave
  // is only worth trusting over a completed Save when it captured an edit
  // made *after* that save. Both sides of every comparison go through
  // Number(): bid_estimates.overhead_pct/profit_pct and
  // bid_workspaces.overhead_pct/profit_pct are Postgres `numeric` columns,
  // which pg serializes as strings (e.g. "22.00") — comparing one of those
  // against a real number with !== is always true, which is exactly what
  // made pricingDirty (below) permanently true whenever the workspace GET
  // won the old race. Only ever applied while the workspace's local pricing
  // state is still pristine (untouched since restore): either source
  // resolving after the estimator has already started editing this session
  // must never clobber their edits.
  //
  // Re-review non-blocker (b) — the rule above ("estimate first, workspace
  // only if strictly newer") only actually holds when both requests have
  // landed before hydration ever runs: if workspaceRow resolved first (this
  // effect also re-runs on every `savedEstimateData`/`workspaceRow` change)
  // it would hydrate from workspaceRow alone, which flips `isPristine`
  // false — so when the estimate arrived a moment later, the effect would
  // already be permanently gated off, even though the estimate should have
  // won. Gating on both fetches' `loading` being false makes this
  // deterministic regardless of which one's network response happens to
  // arrive first — reading `savedEstimateData` (the raw useApi value)
  // rather than the `savedEstimate` state variable matters here too:
  // `savedEstimate` is only populated by a separate effect one render after
  // `savedEstimateData` (and independently updated after a Save Estimate,
  // its other purpose — see below), so the instant `savedEstimateLoading`
  // flips false, `savedEstimateData` already holds the fetched value in
  // this same render while `savedEstimate` would still be stale for one
  // more tick, which was enough for this effect to hydrate from workspaceRow
  // alone all over again and flip `isPristine` before the estimate ever got
  // a chance.
  useEffect(() => {
    if (savedEstimateLoading || workspaceRowLoading) return;
    const current = wsRef.current;
    const isPristine = current.overheadPct === 10 && current.profitPct === 15
      && Object.keys(current.estimateOverrides).length === 0;
    if (!isPristine) return;

    type Candidate = { overheadPct: number; profitPct: number; estimateOverrides: Record<string, number>; at: number };
    let candidate: Candidate | null = null;

    if (savedEstimateData) {
      const overrides = overridesFromEstimate(savedEstimateData.line_items);
      const overheadPct = Number(savedEstimateData.overhead_pct);
      const profitPct = Number(savedEstimateData.profit_pct);
      const hasRealValues = overheadPct !== 10 || profitPct !== 15 || Object.keys(overrides).length > 0;
      if (hasRealValues) {
        const at = savedEstimateData.updated_at ? new Date(savedEstimateData.updated_at).getTime() : 0;
        candidate = { overheadPct, profitPct, estimateOverrides: overrides, at };
      }
    }

    if (workspaceRow) {
      const overrides = workspaceRow.estimate_overrides || {};
      const overheadPct = workspaceRow.overhead_pct != null ? Number(workspaceRow.overhead_pct) : 10;
      const profitPct = workspaceRow.profit_pct != null ? Number(workspaceRow.profit_pct) : 15;
      const hasRealValues = (workspaceRow.overhead_pct != null && overheadPct !== 10)
        || (workspaceRow.profit_pct != null && profitPct !== 15)
        || Object.keys(overrides).length > 0;
      if (hasRealValues) {
        const at = workspaceRow.updated_at ? new Date(workspaceRow.updated_at).getTime() : 0;
        // Strictly newer only — a tie (e.g. neither row has a real
        // timestamp) keeps the estimate's value, the historically
        // authoritative source.
        if (!candidate || at > candidate.at) {
          candidate = { overheadPct, profitPct, estimateOverrides: overrides, at };
        }
      }
    }

    if (candidate) {
      set({ overheadPct: candidate.overheadPct, profitPct: candidate.profitPct, estimateOverrides: candidate.estimateOverrides });
    }
  }, [savedEstimateData, workspaceRow, savedEstimateLoading, workspaceRowLoading]);

  // Pre-fill service fields from Agent 1 output when it becomes available (skips already-filled fields)
  useEffect(() => {
    const agent1 = aiResults?.agent1_output as string | undefined;
    if (!agent1) return;
    const p = parseAgent1Service(agent1);
    setSvcVoltage(v => v || p.voltage);
    setSvcAmpacity(v => v || p.ampacity);
    setSvcPanel(v => v || p.panel);
  }, [aiResults?.agent1_output]);

  // Task 7 — load the composed BidData preview whenever a completed proposal
  // is on file (covers both a fresh Agent 4 run finishing via pollAgent4's
  // setAiResults, and reconnecting to an already-complete proposal on mount).
  const proposalReady = aiResults?.agent4_status === 'complete';
  const { data: proposalPreviewData, error: proposalPreviewError } = useApi<BidDataPreview>(
    `/preconstruction/${bid.id}/proposal-preview`,
    { enabled: proposalReady },
  );
  useEffect(() => {
    // The pre-migration code was `.catch(() => setProposalPreview(null))`. Without
    // the error branch a failed fetch left the PREVIOUS bid's preview on screen,
    // which on this page is a proposal document with a customer name on it.
    if (proposalPreviewError) { setProposalPreview(null); return; }
    setProposalPreview(proposalReady ? (proposalPreviewData ?? null) : null);
  }, [proposalReady, proposalPreviewData, proposalPreviewError]);

  // Fix round 1 / S3 — moved below (after `estimatingBid` exists): the
  // proposal price now syncs from the NEW engine's latest SAVED total, not
  // the legacy savedEstimate.grand_total, and keeps syncing (not just a
  // one-time pre-fill) until the estimator edits it by hand. See the effect
  // near `estimatingBid`'s declaration.

  const runAI = async (force = false) => {
    if (wsRef.current.aiRunning || (!force && wsRef.current.aiDone)) return;
    const elecUploaded = fileObjectsRef.current.filter(f => isElecSheet(f.name)).length;
    const elecSelected = projectDocs.filter(d => selectedDocIds.has(d.id) && isElecSheet(d.name)).length;
    const elecCount = elecUploaded + elecSelected;
    const hasUploaded = fileObjectsRef.current.length > 0;
    const hasSelected = selectedDocIds.size > 0;
    if (!hasUploaded && !hasSelected) {
      const msg = ws.files.length > 0
        ? '✗ Files from a previous session can\'t be re-sent automatically. Go to the Files tab and check the boxes under "From Project Files" to include them, or re-upload the plan files.'
        : '✗ Upload plan files or select from Project Files before running AI analysis.';
      set({ aiLog: [msg] });
      return;
    }
    const totalCount = fileObjectsRef.current.length + selectedDocIds.size;
    set({ aiRunning: true, aiLog: [`Sending ${totalCount} file(s) (${elecCount} electrical sheet${elecCount !== 1 ? 's' : ''} identified)…`] });
    try {
      const formData = new FormData();
      formData.append('bidId', bid.id);
      fileObjectsRef.current.forEach(f => formData.append('files', f));
      selectedDocIds.forEach(id => formData.append('document_ids', id));
      await api.post('/preconstruction/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 1 of 3: Reading plans & extracting drawing data (1–2 min)…'] }));
      pollForResults(Date.now());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start analysis';
      set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${msg}`] }));
    }
  };

  const resumeAI = async () => {
    if (wsRef.current.aiRunning || wsRef.current.aiDone) return;
    set({ aiRunning: true, aiLog: ['Resuming from Agent 2 — reusing saved plan analysis…'] });
    try {
      const formData = new FormData();
      formData.append('bidId', bid.id);
      formData.append('resume', 'true');
      const { data } = await api.post('/preconstruction/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const startMsg = data.resumed
        ? 'Agent 2 of 3: Building scope & estimate…'
        : 'Agent 1 of 3: Reading plans & extracting drawing data (1–2 min)…';
      set(prev => ({ aiLog: [...(prev.aiLog ?? []), startMsg] }));
      pollForResults(Date.now(), !!data.resumed, false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to resume analysis';
      set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${msg}`] }));
    }
  };

  const addRfi = () => {
    if (!newRfi.trim()) return;
    const rfi = { id: Date.now().toString(), question: newRfi.trim(), submitted: false, answer: '' };
    set({ rfis: [...ws.rfis, rfi] });
    setNewRfi('');
  };

  const rerunAI = async () => {
    if (!(await confirm({
      title: 'Re-run the AI analysis? This will permanently delete the previous takeoff results and clear the Scope of Work.',
      confirmLabel: 'Re-run',
      destructive: true,
    }))) return;
    setAiResults(null);
    set({ aiDone: false, aiRunning: false, aiLog: [], scope: {}, confirmedService: undefined });
    setSvcVoltage(''); setSvcAmpacity(''); setSvcPanel('');
    runAI(true);
  };

  const handleConfirmService = () => {
    const data: ConfirmedService = { voltage: svcVoltage.trim(), ampacity: svcAmpacity.trim(), panel: svcPanel.trim(), confirmed: true };
    set({ confirmedService: data });
    showToast({ title: 'Project data confirmed', sub: 'Pricing is now unlocked' });
  };

  // Phase 4 Task 5.2 — "Suggest RFIs" stops being fake: no more hardcoded
  // keyword table / setTimeout theater. Imports Agent 2's real rfis[] (each
  // {item, risk, question} — see takeoff_results.agent2_output, the same
  // JSON this tab's Agent 2 structured view already renders), deduping
  // against the existing workspace RFIs by question text (case/whitespace-
  // insensitive) and against duplicates within the imported batch itself.
  const importRfisFromAnalysis = () => {
    const parsed = parseAgentJson(aiResults?.agent2_output as string | undefined);
    const rawRfis = (parsed?.rfis as Array<Record<string, unknown>> | undefined) ?? [];
    if (!rawRfis.length) {
      showToast({ variant: 'info', title: 'No AI analysis available', sub: 'Run the 3-agent analysis first.' });
      return;
    }
    const norm = (s: string) => s.trim().toLowerCase();
    const existing = new Set(ws.rfis.map(r => norm(r.question)));
    const seen = new Set<string>();
    const toAdd = rawRfis
      .map(r => String(r.question ?? '').trim())
      .filter(q => {
        if (!q) return false;
        const key = norm(q);
        if (existing.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (!toAdd.length) {
      showToast({ variant: 'info', title: 'Nothing new to import', sub: 'Every AI-suggested RFI is already on this list.' });
      return;
    }
    const newRfis = toAdd.map(q => ({ id: Date.now().toString() + Math.random(), question: q, submitted: false, answer: '' }));
    set({ rfis: [...ws.rfis, ...newRfis] });
    showToast({ title: `Imported ${newRfis.length} RFI${newRfis.length === 1 ? '' : 's'}`, sub: 'From the AI analysis' });
  };

  // Phase 4 Task 5.1 — RFI submit becomes real: drafts (never sends) an
  // Outlook email to the bid contact listing every currently-open RFI, then
  // marks them submitted only once the draft actually succeeds. Replaces the
  // old per-row client-only "Submit" (fake "GC will be notified" toast).
  const submitOpenRfis = async () => {
    const openCount = ws.rfis.filter(r => !r.submitted).length;
    if (!openCount) return;
    setRfiSubmitting(true);
    try {
      const { data } = await api.post(`/preconstruction/${bid.id}/rfi-draft`);
      // FIX-11 (post-review) — mark ONLY the ids the server actually
      // submitted (data.submittedIds), not every currently-unsubmitted RFI.
      // A blank-question RFI is excluded server-side (rfi-draft only drafts
      // RFIs with real question text) and must stay unsubmitted client-side
      // too — marking it submitted here used to silently drift the UI from
      // the actual server state.
      const submittedIds = new Set<string>(data.submittedIds ?? []);
      set({ rfis: ws.rfis.map(r => (submittedIds.has(r.id) ? { ...r, submitted: true } : r)) });
      showToast({
        title: `${data.submittedCount} RFI${data.submittedCount === 1 ? '' : 's'} drafted`,
        sub: 'Review and send from Outlook.',
        ...(data.draftWebLink ? { action: { label: 'Open in Outlook', onClick: () => window.open(data.draftWebLink, '_blank') } } : {}),
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to draft the RFI email';
      showToast({ variant: 'error', title: 'Draft failed', sub: msg });
    } finally {
      setRfiSubmitting(false);
    }
  };


  // Fix round 1 / S2+S9 — the legacy "Save Estimate" flow (pricingLineItems,
  // saveEstimate, runSaveEstimate/savingEstimate, PUT /api/estimates/:bidId)
  // was deleted here. It only ever fed PricingTab.tsx (deleted — unrendered
  // since the estimating redesign) and an `onSaveEstimate` callback that was
  // built but never passed to anything. The new engine
  // (useEstimatingBid/LaborPricingStep, saveBidEstimate() ->
  // PUT /api/estimating/:bidId) is the one real save path now; the legacy
  // route returns 410 Gone (routes/estimates.ts).


  const generateProposal = () => {
    set({ proposalGenerated: true });
    showToast({ title: 'Proposal generated', sub: 'Ready to review and send' });
  };

  const runAgent4Proposal = async () => {
    if (!propPrice.trim()) {
      showToast({ variant: 'error', title: 'Price required', sub: 'Enter the total bid price before generating the proposal' });
      return;
    }
    setAgent4StartError(null);
    setAgent4Running(true);
    // A re-run invalidates whatever gate failures / pre-bid links were showing.
    setVerifyFailures(null);
    setPrebidResult(null);
    try {
      await api.post(`/preconstruction/${bid.id}/run-agent4`, {
        // Strip $/commas/whitespace before POSTing — the box keeps whatever the
        // estimator typed, the server only ever sees a clean numeric string.
        price: propPrice.replace(/[$,\s]/g, ''),
        internalNotes: propNotes,
      });
      // Backend returns immediately — poll for completion
      pollAgent4();
    } catch (err) {
      setAgent4Running(false);
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start Agent 4';
      setAgent4StartError(msg);
      showToast({ variant: 'error', title: 'Agent 4 error', sub: msg });
    }
  };

  // Reads the {error, failures[]} JSON off a failed blob-response request —
  // shared by downloadDocx/downloadTakeoffXlsx/generatePrebidPackage so a
  // gate failure or any other server error always surfaces a real message
  // instead of a generic "download failed" (Task 7.2 — the download button
  // never silently fails).
  async function readBlobError(err: unknown, fallback: string): Promise<{ sub: string; failures: VerifyFailure[] | null }> {
    let sub = fallback;
    let failures: VerifyFailure[] | null = null;
    try {
      const axiosErr = err as { response?: { data?: Blob } };
      if (axiosErr.response?.data instanceof Blob) {
        const text = await axiosErr.response.data.text();
        const json = JSON.parse(text) as { error?: string; failures?: VerifyFailure[] };
        if (json.error) sub = json.error;
        if (Array.isArray(json.failures)) failures = json.failures;
      }
    } catch { /* ignore parse failure — fallback message stands */ }
    return { sub, failures };
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[<>:"/\\|?*]/g, '-');
    a.click();
    URL.revokeObjectURL(url);
  }

  // These read the API but they are actions, not state that follows a key, so
  // they run through useMutation (busy flag + failure toast) rather than useApi.
  // Both keep their own error handling: the failure body arrives as a Blob and
  // has to be read before it can be shown.
  const { run: runDownloadDocx, saving: docxBusy } = useMutation(
    async () => {
      const response = await api.get(`/preconstruction/${bid.id}/generate-docx`, { responseType: 'blob' });
      triggerDownload(
        new Blob([response.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        `Proposal — ${bid.name}.docx`
      );
    },
    {
      showToast,
      errorToast: false,
      onError: async (err) => {
        const { sub, failures } = await readBlobError(err, 'Could not generate the proposal document');
        if (failures?.length) setVerifyFailures(failures);
        showToast({ variant: 'error', title: 'Download failed', sub });
      },
    },
  );

  const downloadDocx = () => { setVerifyFailures(null); runDownloadDocx(); };

  const { run: downloadTakeoffXlsx, saving: xlsxBusy } = useMutation(
    async () => {
      const response = await api.get(`/preconstruction/${bid.id}/generate-takeoff-xlsx`, { responseType: 'blob' });
      triggerDownload(
        new Blob([response.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Takeoff — ${bid.name}.xlsx`
      );
    },
    {
      showToast,
      errorToast: false,
      onError: async (err) => {
        const { sub } = await readBlobError(err, 'Could not generate the takeoff spreadsheet');
        showToast({ variant: 'error', title: 'Download failed', sub });
      },
    },
  );

  // Task 6.3's endpoint — internal pre-bid package (scope docx + confidence-
  // coded takeoff xlsx) for Chris. Links both filed documents on success via
  // the same /documents/:id/download route the Files panel uses.
  const generatePrebidPackage = async () => {
    setPrebidBusy(true);
    setPrebidResult(null);
    try {
      const { data } = await api.post(`/preconstruction/${bid.id}/generate-prebid-package`);
      setPrebidResult({ scopeDocumentId: data.scopeDocumentId ?? null, takeoffDocumentId: data.takeoffDocumentId ?? null });
      showToast({ title: 'Pre-bid package generated', sub: 'Scope + takeoff filed for Chris — download links below' });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; failures?: VerifyFailure[] } } };
      const body = axiosErr.response?.data;
      if (body?.failures?.length) setVerifyFailures(body.failures);
      showToast({ variant: 'error', title: 'Pre-bid package failed', sub: body?.error ?? 'Could not generate the pre-bid package' });
    } finally {
      setPrebidBusy(false);
    }
  };

  // Phase 4 Task 1.5 — internal draft to Chris (the same "Chris" the
  // pre-bid package template addresses) with the just-filed scope docx +
  // takeoff xlsx attached. Never sends — Jake reviews in Outlook.
  // FIX-11 (post-review) — the recipient no longer hardcoded here: the
  // server resolves it from the `prebid_chris_email` app_setting (falling
  // back to the previously-hardcoded address if that setting is unset).
  const emailPrebidToChris = async () => {
    setChrisDraftBusy(true);
    setChrisDraftLink(null);
    try {
      const { data } = await api.post(`/bids/${bid.id}/email-prebid-chris`, {});
      setChrisDraftLink(data.draftWebLink || null);
      showToast({ title: 'Draft created', sub: 'Review and send it from Outlook.' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create the draft';
      showToast({ variant: 'error', title: 'Draft failed', sub: msg });
    } finally {
      setChrisDraftBusy(false);
    }
  };

  const { run: downloadFiledDocument } = useMutation(
    async (docId: string, filename: string) => {
      const response = await api.get(`/documents/${docId}/download`, { responseType: 'blob' });
      triggerDownload(response.data as Blob, filename);
    },
    { showToast, errorToast: () => ({ title: 'Download failed', sub: 'Please try again from the Files tab.' }) },
  );

  const handleConvert = () => {
    setConvertOpen(false);
    onConverted({ ...bid, stage: 'awarded' });
    showToast({ title: 'Project created!', sub: `${bid.name} moved to Electrical Projects` });
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    fileObjectsRef.current = [...fileObjectsRef.current, ...files];
    const newFiles = files.map(f => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      type: f.name.split('.').pop()?.toUpperCase() ?? 'FILE',
      size: f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(f.size / 1024) + ' KB',
    }));
    set({ files: [...ws.files, ...newFiles] });

    // Persist to Documents so files survive page refresh
    runPersistFiles(files);
  };

  const { run: runPersistFiles } = useMutation(
    async (files: File[]) => {
      await Promise.all(files.map(f => {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('linked_id', bid.id);
        fd.append('linked_name', bid.name);
        fd.append('div', 'elec');
        fd.append('category', 'plans');
        fd.append('display_name', f.name);
        return api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }));
    },
    {
      showToast,
      onSuccess: () => reloadProjectDocs(),
      // These files are already listed in the workspace; the toast says they
      // will not survive a refresh, which is the part the estimator loses.
      errorToast: (message) => ({ title: 'Files not saved to the project', sub: message }),
    },
  );

  // Always goes through the backend (authenticated blob fetch), never anchors
  // doc.storage_url directly: the raw Cloudinary URL is unauthenticated and skips
  // access checks. Mirrors RecordFiles' download().
  const { run: downloadProjectDoc } = useMutation(
    async (doc: ProjectDoc) => {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = doc.display_name || doc.name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    { showToast, errorToast: () => ({ title: 'Download failed', sub: 'Please re-upload this file.' }) },
  );

  // Same view/preview routing as RecordFiles' "Documents" list, shared via
  // useDocPreview: pdf/image open inline in a new tab, xlsx/xls/csv/docx render
  // in-app via FilePreviewModal, everything else falls through to download.
  const { preview: docPreview, view: viewProjectDoc, closePreview: closeDocPreview } = useDocPreview<ProjectDoc>(
    downloadProjectDoc,
    message => showToast({ variant: 'error', title: 'Preview failed', sub: message }),
  );

  const removeFile = (id: string, name: string) => {
    let removed = false;
    fileObjectsRef.current = fileObjectsRef.current.filter(f => {
      if (!removed && f.name === name) {
        removed = true;
        return false;
      }
      return true;
    });
    set({ files: ws.files.filter(f => f.id !== id) });
  };

  const clearFiles = () => {
    fileObjectsRef.current = [];
    set({ files: [] });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // Import a finished bid doc (.docx/.pdf) + its takeoff spreadsheet (.xlsx), uploaded
  // together, without running the AI agents — label/regex extraction only. Shows an
  // editable preview; nothing is saved until confirmed.

  // Import a finished bid doc (.docx/.pdf) + its takeoff spreadsheet (.xlsx), uploaded
  // together, without running the AI agents — label/regex extraction only. Shows an
  // editable preview; nothing is saved until confirmed.
  const readImportFiles = async () => {
    const { bidFile, takeoffFile, breakdownFile } = importState;
    if (!bidFile) return;
    importDispatch({ type: 'readStart' });
    try {
      const formData = new FormData();
      formData.append('file', bidFile);
      if (takeoffFile) formData.append('takeoff', takeoffFile);
      if (breakdownFile) formData.append('breakdown', breakdownFile);
      const { data } = await api.post(`/preconstruction/${bid.id}/import-bid`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      importDispatch({ type: 'readSuccess', preview: {
        amount: data.amount != null ? String(data.amount) : (bid.amount ? String(bid.amount) : ''),
        projectType: bid.project_type ?? '',
        brand: bid.brand ?? '',
        sqFt: data.sqFt != null ? String(data.sqFt) : (bid.sq_ft ? String(bid.sq_ft) : ''),
        scopeText: data.scopeText || '',
        scopeOfWork: data.scopeOfWork,
        takeoff: data.takeoff ?? null,
      } });
      if (!data.amount) showToast({ variant: 'info', title: 'No amount found', sub: 'Couldn\'t find a total in that file — enter it manually below.' });
      if (takeoffFile && !data.sqFt) showToast({ variant: 'info', title: 'No sq ft found', sub: 'Couldn\'t find building area in the takeoff — enter it manually below.' });
      if (data.takeoff) {
        showToast({ title: 'Takeoff saved', sub: `${data.takeoff.itemCount} items across ${data.takeoff.categories.length} categories.` });
        reloadTakeoff();
      }
      if (data.breakdown?.laborHours) showToast({ title: 'Cost breakdown saved', sub: `${Number(data.breakdown.laborHours).toLocaleString()} labor hours on file.` });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to read those files';
      showToast({ variant: 'error', title: 'Import failed', sub: msg });
    } finally {
      importDispatch({ type: 'readSettled' });
    }
  };

  const saveImportedBid = async () => {
    const preview = importState.preview;
    if (!preview) return;
    importDispatch({ type: 'saveStart' });
    try {
      const { data } = await api.patch(`/bids/${bid.id}`, {
        amount: preview.amount === '' ? null : Number(preview.amount),
        project_type: preview.projectType || null,
        brand: preview.brand || null,
        sq_ft: preview.sqFt === '' ? null : Number(preview.sqFt),
      });
      if (data.bid) onBidUpdated(data.bid);

      // Put the extracted scope on the Scope of Work tab rather than leaving it as
      // loose text. Existing sections win — a hand-written scope is never overwritten.
      const sections = scopeSectionsFrom(preview.scopeOfWork);
      const filled = Object.entries(sections).filter(([k]) => !ws.scope?.[k]?.trim());
      if (filled.length) {
        set({ scope: { ...ws.scope, ...Object.fromEntries(filled) } });
      }

      showToast({
        title: 'Bid saved',
        sub: filled.length
          ? `Scope filled ${filled.length} section${filled.length === 1 ? '' : 's'} — see Scope of Work.`
          : 'Logged for this project — now available in Compare Bids.',
      });
      importDispatch({ type: 'clear' });
    } catch {
      showToast({ variant: 'error', title: 'Save failed', sub: 'Could not save the imported bid.' });
    } finally {
      importDispatch({ type: 'saveSettled' });
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  // ── Handlers handed to the memoized tabs ──────────────────────────────
  // useStableFn keeps each identity fixed for the life of the workspace while
  // still calling the latest closure, so a tab only re-renders when the data it
  // shows changes — not every time the autosave chip ticks over.
  const onAdvanceStep = useStableFn(advanceStep);
  const onRunAI = useStableFn(() => { void runAI(); });
  const onResumeAI = useStableFn(() => { void resumeAI(); });
  const onRerunAI = useStableFn(() => { void rerunAI(); });
  const onCopyToClipboard = useStableFn(copyToClipboard);
  const onConfirmService = useStableFn(handleConfirmService);
  const onAddRfi = useStableFn(addRfi);
  const onImportRfis = useStableFn(importRfisFromAnalysis);
  const onSubmitOpenRfis = useStableFn(() => { void submitOpenRfis(); });
  const onRemoveFile = useStableFn(removeFile);
  const onClearFiles = useStableFn(clearFiles);
  const onFileUpload = useStableFn(handleFileUpload);
  const onDrop = useStableFn(handleDrop);
  const onViewProjectDoc = useStableFn(viewProjectDoc);
  const onRunAgent4 = useStableFn(() => { void runAgent4Proposal(); });
  const onDownloadDocx = useStableFn(downloadDocx);
  const onDownloadTakeoffXlsx = useStableFn(() => { void downloadTakeoffXlsx(); });
  const onGeneratePrebidPackage = useStableFn(() => { void generatePrebidPackage(); });
  const onEmailPrebidToChris = useStableFn(() => { void emailPrebidToChris(); });
  const onDownloadFiledDocument = useStableFn((docId: string, filename: string) => { void downloadFiledDocument(docId, filename); });
  const onConvert = useStableFn(handleConvert);
  const onReadImportFiles = useStableFn(() => { void readImportFiles(); });
  const onSaveImportedBid = useStableFn(() => { void saveImportedBid(); });
  const onGoTakeoff = useStableFn(() => { set({ activeTab: 'takeoff' }); });
  const onUnitCostChange = useStableFn((key: string, value: number) => {
    set(prev => ({ estimateOverrides: { ...prev.estimateOverrides, [key]: value } }));
  });
  const onOverheadChange = useStableFn((value: number) => { set({ overheadPct: value }); });
  const onProfitChange = useStableFn((value: number) => { set({ profitPct: value }); });

  const importPanel: ImportPanelProps = useMemo(() => ({
    state: importState,
    dispatch: importDispatch,
    readImportFiles: onReadImportFiles,
    saveImportedBid: onSaveImportedBid,
  }), [importState, onReadImportFiles, onSaveImportedBid]);

  // Task 7's five-step shell: `currentStep` is its own URL-backed piece of
  // state (?step=<key>), initialized from the legacy persisted ws.activeTab
  // the first time this bid's URL has no step param. Selecting a step also
  // writes a representative legacy tab key back into ws.activeTab so
  // bid_workspaces.active_tab (still a real, autosaved DB column) stays
  // populated with something a stale reload/old build still understands.
  const [currentStep, setCurrentStepParam] = useEstimateStepParam(mapLegacyTabToStep(ws.activeTab));
  const onSelectStep = useStableFn((step: EstimateStepKey) => {
    setCurrentStepParam(step);
    set({ activeTab: stepToLegacyTab(step) });
  });

  const estimatingBid = useEstimatingBid(bid.id);
  // Task 9 — the new engine's own dirty check, independent of the legacy
  // pricingDirty registration above (both are real, harmless to register
  // twice — see useUnsavedGuard's per-call `id`).
  useUnsavedGuard(estimatingBid.dirty);

  // Fix round 1 / S3 — the Review step and Agent 4 (runAgent4Proposal, below)
  // must read the engine's LATEST SAVED total, not a stale one-time pre-fill.
  // Syncs propPrice from estimatingBid.recap whenever it reflects a saved
  // state (not dirty, not an unsaved proposal) — i.e. right after hydrating
  // an already-saved bid, and again every time a save/sync completes — and
  // never overwrites a value the estimator has since typed by hand
  // (propPriceEdited, set by setPropPriceManual below).
  useEffect(() => {
    if (propPriceEdited) return;
    if (estimatingBid.dirty || estimatingBid.proposed) return;
    const total = estimatingBid.recap.totals.grandTotal;
    if (total > 0) setPropPrice(String(Math.round(total)));
  }, [estimatingBid.dirty, estimatingBid.proposed, estimatingBid.recap.totals.grandTotal, propPriceEdited]);

  const setPropPriceManual = useStableFn((v: string) => { setPropPrice(v); setPropPriceEdited(true); });

  const doneByStep = deriveStepStatus({
    hasFiles: ws.files.length > 0,
    hasTakeoffOutput: !!aiResults?.agent1_output,
    takeoffConfirmed: !!ws.confirmedService?.confirmed,
    hasSavedPricingLines: !estimatingBid.proposed && estimatingBid.lines.length > 0,
    hasUnmatchedNonExcluded: estimatingBid.recap.warnings.unmatchedCount > 0,
    hasScopeText: Object.values(ws.scope).some(v => (v ?? '').trim().length > 0),
    proposalFiled: ws.proposalGenerated,
  });

  // Task 8 — re-homed step content: each step stacks the same existing tab
  // components on one screen rather than switching between them, with no
  // change to any of those components' own props/behavior.
  const renderStepContent = (step: EstimateStepKey) => {
    switch (step) {
      case 'documents':
        return (
          <>
            <FilesTab
              ws={ws}
              fileInputRef={fileInputRef}
              fileObjectsRef={fileObjectsRef}
              dragOver={dragOver}
              setDragOver={setDragOver}
              projectDocs={projectDocs}
              selectedDocIds={selectedDocIds}
              setSelectedDocIds={setSelectedDocIds}
              removeFile={onRemoveFile}
              clearFiles={onClearFiles}
              handleFileUpload={onFileUpload}
              handleDrop={onDrop}
              viewProjectDoc={onViewProjectDoc}
              onGoFiles={onGoFiles}
            />
            <PreBidTab bidId={bid.id} onSectionsLoaded={setPrebidSections}/>
            {/* Fix round 1 / S4 — Workspace Notes and Import Finished Bid
                (the Accubid breakdown upload calibration.ts depends on) lived
                on the old shell's Overview tab, which never got a home in
                the new step system during the redesign — importPanel (below)
                was being built every render and never rendered anywhere. */}
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-hdr"><span className="panel-title">Workspace Notes</span></div>
              <div style={{ padding: 16 }}>
                <textarea
                  style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 140, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                  value={ws.notes} onChange={e => set({ notes: e.target.value })}
                  placeholder="Add notes, reminders, or key info about this bid…"
                  data-testid="documents-workspace-notes"
                />
              </div>
            </div>
            <ImportPanel {...importPanel}/>
          </>
        );

      case 'takeoff':
        return (
          <>
            <BidTab
              ws={ws}
              set={set}
              aiResults={aiResults}
              runAI={onRunAI}
              resumeAI={onResumeAI}
              rerunAI={onRerunAI}
              settings={settings}
              userRole={userRole}
            />
            <TakeoffTab
              ws={ws}
              bid={bid}
              aiResults={aiResults}
              analysisTab={analysisTab}
              setAnalysisTab={setAnalysisTab}
              copied={copied}
              copyToClipboard={onCopyToClipboard}
              svcVoltage={svcVoltage}
              setSvcVoltage={setSvcVoltage}
              svcAmpacity={svcAmpacity}
              setSvcAmpacity={setSvcAmpacity}
              svcPanel={svcPanel}
              setSvcPanel={setSvcPanel}
              handleConfirmService={onConfirmService}
              settings={settings}
              userRole={userRole}
            />
          </>
        );

      case 'pricing':
        // Rendered by EstimatingWorkspace itself (the lazy chunk) — see the
        // Suspense boundary below. otherStepContent is never used for this step.
        return null;

      case 'scope':
        return (
          <>
            <ScopeTab
              ws={ws}
              set={set}
              aiResults={aiResults}
              prebidSections={prebidSections}
              showToast={showToastStable}
            />
            <RfisTab
              ws={ws}
              aiResults={aiResults}
              newRfi={newRfi}
              setNewRfi={setNewRfi}
              rfiSubmitting={rfiSubmitting}
              addRfi={onAddRfi}
              importRfisFromAnalysis={onImportRfis}
              submitOpenRfis={onSubmitOpenRfis}
            />
          </>
        );

      case 'review': {
        const w = estimatingBid.recap.warnings;
        const hasPreSendFlags = w.unmatchedCount > 0 || w.verifyCount > 0 || w.unverifiedMaterialShare > 0;
        return (
          <>
            {hasPreSendFlags && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 14px',
                background: 'var(--amber-soft)', borderRadius: 10, color: 'var(--amber)', fontSize: 12.5, fontWeight: 600,
              }} data-testid="review-presend-checklist">
                <strong>Before sending — check the estimate:</strong>
                {w.unmatchedCount > 0 && <span>{w.unmatchedCount} unmatched line{w.unmatchedCount === 1 ? '' : 's'} in Labor &amp; Pricing</span>}
                {w.verifyCount > 0 && <span>{w.verifyCount} VERIFY quantit{w.verifyCount === 1 ? 'y' : 'ies'} to confirm</span>}
                {w.unverifiedMaterialShare > 0 && <span>{Math.round(w.unverifiedMaterialShare * 100)}% of material pricing is unverified</span>}
              </div>
            )}
            <ProposalTab
              bid={bid}
              aiResults={aiResults}
              propPrice={propPrice}
              setPropPrice={setPropPriceManual}
              propNotes={propNotes}
              setPropNotes={setPropNotes}
              agent4StartError={agent4StartError}
              setAgent4StartError={setAgent4StartError}
              agent4Running={agent4Running}
              runAgent4Proposal={onRunAgent4}
              downloadDocx={onDownloadDocx}
              docxBusy={docxBusy}
              downloadTakeoffXlsx={onDownloadTakeoffXlsx}
              xlsxBusy={xlsxBusy}
              sendProposalOpen={sendProposalOpen}
              setSendProposalOpen={setSendProposalOpen}
              onBidUpdated={onBidUpdatedStable}
              showToast={showToastStable}
              generatePrebidPackage={onGeneratePrebidPackage}
              prebidBusy={prebidBusy}
              prebidResult={prebidResult}
              downloadFiledDocument={onDownloadFiledDocument}
              emailPrebidToChris={onEmailPrebidToChris}
              chrisDraftBusy={chrisDraftBusy}
              chrisDraftLink={chrisDraftLink}
              verifyFailures={verifyFailures}
              proposalPreview={proposalPreview}
              convertOpen={convertOpen}
              setConvertOpen={setConvertOpen}
              handleConvert={onConvert}
            />
          </>
        );
      }

      default:
        return null;
    }
  };

  const nextStepIdx = ESTIMATE_STEP_ORDER.indexOf(currentStep) + 1;
  const nextStep = ESTIMATE_STEP_ORDER[nextStepIdx];

  return (
    <>
    <div className="scroll view-enter">
      {/* Back bar */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          <button className="btn ghost" onClick={onBack} style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
            ← All Bids
          </button>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', flex: 1 }}>{bid.name}</span>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{bid.gc}</span>
        </div>
      )}

      {pollTimedOut && (
        <div data-testid="pc-poll-timeout" style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px',
          background: 'var(--amber-soft)', borderBottom: '1px solid rgba(224,165,59,.3)',
          color: 'var(--amber)', fontSize: 12.5, fontWeight: 700,
        }}>
          <Icon name="alert" size={14} stroke={2}/>
          {pollTimedOut === 'analysis'
            ? POLL_TIMEOUT_MESSAGE
            : 'Proposal generation timed out — check status in the Proposal tab.'}
        </div>
      )}

      <Suspense fallback={<div style={{ padding: 32, color: 'var(--text3)' }}>Loading…</div>}>
        <EstimatingWorkspace
          currentStep={currentStep}
          onSelectStep={onSelectStep}
          doneByStep={doneByStep}
          saveState={saveState}
          nextAction={nextStep ? { label: ESTIMATE_STEP_LABELS[nextStep], onClick: () => onSelectStep(nextStep) } : null}
          lines={estimatingBid.lines}
          settings={estimatingBid.settings}
          recap={estimatingBid.recap}
          proposed={estimatingBid.proposed}
          dirty={estimatingBid.dirty}
          saving={estimatingBid.saving}
          syncing={estimatingBid.syncing}
          saveError={estimatingBid.saveError}
          setLines={estimatingBid.setLines}
          setSettings={estimatingBid.setSettings}
          save={estimatingBid.save}
          syncTakeoff={estimatingBid.syncTakeoff}
          showToast={showToastStable}
          initialInsightsOpen={legacyTabWantsInsights(ws.activeTab)}
          comparables={comparablesForSummary}
          insights={
            <>
              <CostsTab
                historicalCosts={historicalCosts}
                costTypeFilter={costTypeFilter}
                setCostTypeFilter={setCostTypeFilter}
                expandedCostRow={expandedCostRow}
                setExpandedCostRow={setExpandedCostRow}
              />
              <IntelTab bidIntel={bidIntel}/>
            </>
          }
          otherStepContent={renderStepContent(currentStep)}
        />
      </Suspense>
    </div>
    {docPreview && (
      <FilePreviewModal
        title={docPreview.title}
        kind={docPreview.kind}
        buf={docPreview.buf}
        onClose={closeDocPreview}
        onDownload={() => downloadProjectDoc(docPreview.doc)}
      />
    )}
    </>
  );
}
