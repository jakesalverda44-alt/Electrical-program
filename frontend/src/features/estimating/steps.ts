// Pure step logic for the Estimating shell (Task 7): the five steps, mapping
// a legacy persisted PcTabKey onto one of them, and deriving each step's
// "done" status from data rather than stored state.
import { PcTabKey } from '../preconstruction/constants';

export type EstimateStepKey = 'documents' | 'takeoff' | 'pricing' | 'scope' | 'review';

export interface EstimateStepDef {
  key: EstimateStepKey;
  label: string;
}

export const ESTIMATE_STEPS: EstimateStepDef[] = [
  { key: 'documents', label: 'Documents' },
  { key: 'takeoff', label: 'Takeoff' },
  { key: 'pricing', label: 'Labor & Pricing' },
  { key: 'scope', label: 'Scope & RFIs' },
  { key: 'review', label: 'Review & Proposal' },
];

/** Maps a persisted legacy active_tab value onto one of the five steps.
 *  Exact mapping from the plan: overview/prebid/files -> documents;
 *  bid/takeoff -> takeoff; pricing -> pricing; scope/rfis -> scope;
 *  proposal -> review; costs/intel/compare -> pricing (+ open Insights). */
export function mapLegacyTabToStep(tab: PcTabKey | string | undefined | null): EstimateStepKey {
  switch (tab) {
    case 'overview':
    case 'prebid':
    case 'files':
      return 'documents';
    case 'bid':
    case 'takeoff':
      return 'takeoff';
    case 'pricing':
      return 'pricing';
    case 'scope':
    case 'rfis':
      return 'scope';
    case 'proposal':
      return 'review';
    case 'costs':
    case 'intel':
    case 'compare':
      return 'pricing';
    default:
      return 'documents';
  }
}

/** True when a legacy tab mapped onto the pricing step because it was
 *  costs/intel (the Insights-only tabs) rather than the pricing tab itself —
 *  used to auto-open BidSummary's Insights section on first load. */
export function legacyTabWantsInsights(tab: PcTabKey | string | undefined | null): boolean {
  return tab === 'costs' || tab === 'intel';
}

/** A representative legacy tab key to persist into ws.activeTab when a step
 *  is selected in the new shell — keeps bid_workspaces.active_tab populated
 *  with something a pre-redesign build (or a stale open tab) still understands. */
export function stepToLegacyTab(step: EstimateStepKey): PcTabKey {
  switch (step) {
    case 'documents': return 'files';
    case 'takeoff': return 'takeoff';
    case 'pricing': return 'pricing';
    case 'scope': return 'scope';
    case 'review': return 'proposal';
  }
}

export interface StepStatusInput {
  hasFiles: boolean;
  hasTakeoffOutput: boolean;
  takeoffConfirmed: boolean;
  hasSavedPricingLines: boolean;
  hasUnmatchedNonExcluded: boolean;
  hasScopeText: boolean;
  proposalFiled: boolean;
}

/** Step "done" status, derived from data every render — never stored. */
export function deriveStepStatus(input: StepStatusInput): Record<EstimateStepKey, boolean> {
  return {
    documents: input.hasFiles,
    takeoff: input.hasTakeoffOutput && input.takeoffConfirmed,
    pricing: input.hasSavedPricingLines && !input.hasUnmatchedNonExcluded,
    scope: input.hasScopeText,
    review: input.proposalFiled,
  };
}

/** "Needs X first" hint for a step that isn't done — only shown when the
 *  step immediately before it isn't done either (steps are never hard-locked;
 *  this is advisory only). Null when there's nothing to hint. */
export function stepHint(
  key: EstimateStepKey,
  done: Record<EstimateStepKey, boolean>,
): string | null {
  const idx = ESTIMATE_STEPS.findIndex(s => s.key === key);
  if (idx <= 0 || done[key]) return null;
  const prev = ESTIMATE_STEPS[idx - 1];
  if (!done[prev.key]) return `Needs ${prev.label} first`;
  return null;
}
