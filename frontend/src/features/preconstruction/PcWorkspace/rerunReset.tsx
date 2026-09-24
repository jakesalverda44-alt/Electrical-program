// Re-run reset — what "Re-run Analysis" clears and keeps, shown in the
// confirm before anything happens. The server does the reset itself
// (backend services/rerunReset.ts, atomically with the new run id); this
// mirrors its rules only to tell the estimator what is about to happen.
import type { EstimateLine } from '../../estimating/types';
import type { PcWorkspace } from '../constants';

export type StopKind = 'analysis' | 'agent4' | 'draft';

/** POST /preconstruction/analyze's response. */
export interface AnalyzeStartResponse {
  status: string;
  totalFiles: number;
  runId?: string;
  excludedInputs?: Array<{ name: string; documentId?: string; reason: 'crm_generated' | 'duplicate'; detail: string }>;
  reset?: RerunResetSummary;
}

export interface RerunResetSummary {
  runId: string;
  previousRunId: string | null;
  cleared: {
    takeoffLines: number; suggestedMarkers: number; aiRfis: number; supersededDocuments: number;
    reviewItems: number; savedEstimate: boolean; bidAmount: boolean;
  };
  kept: { manualLines: number; recheckLines: number; confirmedMarkers: number; unassignedMarkers: number; rfis: number };
  rfis: PcWorkspace['rfis'];
}

type Rfi = PcWorkspace['rfis'][number];

/** Same rule as the server: tagged 'ai', or (pre-migration) the import's
 *  id shape — Date.now() + Math.random() is the only id with a '.'. */
export function isAiRfi(r: Rfi): boolean {
  if (r.origin) return r.origin === 'ai';
  return String(r.id ?? '').includes('.');
}

/** An estimator-touched takeoff line: kept and flagged, never cleared. */
export function isTouchedTakeoffLine(l: EstimateLine): boolean {
  return l.source === 'takeoff' && (
    !!l.qty_overridden || l.material_unit_override != null || l.labor_hours_override != null
    || l.qty_source === 'markup' || l.qty_source === 'manual' || l.match_source === 'manual'
    || (!!l.excluded && !l.sync_excluded)
  );
}

export interface RerunPlan {
  aiRfis: number;
  keptRfis: number;
  clearedLines: number;
  keptTouchedLines: number;
  manualLines: number;
  amount: number | null;
  pricingDirty: boolean;
}

export function rerunPlan(input: {
  rfis: PcWorkspace['rfis'];
  lines: EstimateLine[];
  savedGrandTotal: number | null;
  bidAmount: number | null;
  pricingDirty: boolean;
}): RerunPlan {
  const clearedRfi = (r: Rfi) => isAiRfi(r) && !r.submitted && !String(r.answer ?? '').trim();
  const takeoff = input.lines.filter(l => l.source === 'takeoff');
  return {
    aiRfis: input.rfis.filter(clearedRfi).length,
    keptRfis: input.rfis.filter(r => !clearedRfi(r)).length,
    clearedLines: takeoff.filter(l => !isTouchedTakeoffLine(l)).length,
    keptTouchedLines: takeoff.filter(isTouchedTakeoffLine).length,
    manualLines: input.lines.filter(l => l.source === 'manual').length,
    amount: input.savedGrandTotal ?? input.bidAmount,
    pricingDirty: input.pricingDirty,
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RerunConfirmBody({ plan }: { plan: RerunPlan }) {
  return (
    <div data-testid="rerun-confirm-body" style={{ display: 'grid', gap: 10 }}>
      <div>
        <strong>Cleared</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="rerun-clears">
          <li>The previous takeoff results, counts, review answers and Scope of Work</li>
          <li>The Agent 4 proposal and the pre-bid draft</li>
          <li>AI-suggested markers on the plans that were never confirmed</li>
          <li>{plural(plan.aiRfis, 'AI-imported RFI')} not yet sent or answered</li>
          <li>{plural(plan.clearedLines, 'takeoff line')} in Labor &amp; Pricing you haven&apos;t edited</li>
          <li>The saved estimate and the bid amount{plan.amount != null && plan.amount > 0 ? ` (${money(plan.amount)})` : ''}</li>
          <li>Filed proposal and pre-bid package files are marked superseded (never deleted) and can&apos;t be sent</li>
        </ul>
      </div>
      <div>
        <strong>Kept</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} data-testid="rerun-keeps">
          <li>Uploaded plans, specs and other files</li>
          <li>Plan markers you confirmed</li>
          <li>
            {plural(plan.manualLines, 'manual line')}
            {plan.keptTouchedLines > 0 && <> and {plural(plan.keptTouchedLines, 'takeoff line')} you edited — flagged &ldquo;From previous run — re-check&rdquo;</>}
          </li>
          <li>Workspace notes and {plural(plan.keptRfis, 'RFI')} you typed, sent or answered</li>
          <li>The scope list (included / not included) and your overrides</li>
          <li>Account rules and pricing settings (labor rate, overhead, profit)</li>
        </ul>
      </div>
      {plan.pricingDirty && (
        <div style={{ color: 'var(--amber)', fontWeight: 700 }} data-testid="rerun-dirty-warning">
          Unsaved Labor &amp; Pricing edits will be discarded — save them first to keep them.
        </div>
      )}
    </div>
  );
}
