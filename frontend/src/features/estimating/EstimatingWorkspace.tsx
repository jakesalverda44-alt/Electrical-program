// Task 12 — bundle boundary. This is the ONE module PcWorkspaceView
// React.lazy()-imports, so EstimateShell + BidSummary + LaborPricingStep (and
// their CSS) ship as a separate chunk instead of growing the main bundle —
// the re-homed OLD tabs (FilesTab, TakeoffTab, etc., passed in as
// `otherStepContent`) are unaffected and stay exactly where they already were.
import React from 'react';
import { EstimateShell, SaveState } from './EstimateShell';
import { BidSummary, ComparableForSummary } from './BidSummary';
import { LaborPricingStep } from './LaborPricingStep';
import { EstimateStepKey } from './steps';
import { type DuplicatePair, EstimateLine, EstimateSettings, PricingRecap } from './types';

export interface EstimatingWorkspaceProps {
  currentStep: EstimateStepKey;
  onSelectStep: (step: EstimateStepKey) => void;
  doneByStep: Record<EstimateStepKey, boolean>;
  saveState: SaveState;
  nextAction: { label: string; onClick: () => void } | null;

  /** Next round B2/B3 — mounts the Accubid-mode Crew/Quotes/Equipment/GE/
   *  Alternates panel when settings.pricing_mode === 'accubid'. */
  bidId?: string;
  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  proposed: boolean;
  /** Fix round 1 / S1 — genuine unsaved edits (not just "proposed"); drives
   *  BidSummary's "unsaved proposal" tag and LaborPricingStep's sync-confirm. */
  dirty?: boolean;
  /** Fix round 2 / SF3 — see BidSummaryProps.savedGrandTotal. */
  savedGrandTotal?: number | null;
  saving: boolean;
  syncing: boolean;
  saveError: string | null;
  /** Next round A7 — possible duplicates (Labor & Pricing blocks the save). */
  duplicates?: DuplicatePair[];
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  // Fix round 2 / R2-S1 — widened from Promise<void>: useEstimatingBid's
  // save() now resolves to remappedLineKeys (PlansWorkspace.tsx's own
  // proposed-mapping remap). This chain (down through LaborPricingStep's
  // own Save button) never reads the resolved value at all — `unknown`
  // says so honestly, and never needs updating again regardless of what
  // save() returns in the future.
  save: () => Promise<unknown>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number } | null>;
  showToast?: (t: { title: string; sub?: string; variant?: 'success' | 'error' }) => void;

  comparables: ComparableForSummary[];
  /** Phase B, Task 8 — see BidSummaryProps.linesNotVerifiedOnPlansCount. */
  linesNotVerifiedOnPlansCount?: number;
  onJumpToPlans?: () => void;
  /** Fix round 2 / R2-S4(a) — see BidSummaryProps.ambiguousQtyKeys. */
  ambiguousQtyKeys?: string[];
  insights: React.ReactNode;
  /** Fix round 1 / N7 — see BidSummaryProps.initialInsightsOpen. */
  initialInsightsOpen?: boolean;

  /** The other four steps' (already re-homed, unchanged) content — Labor &
   *  Pricing is the only step this module itself renders. */
  otherStepContent: React.ReactNode;

  /** Phase B, Decision 1 — forwarded to EstimateShell; true while the
   *  Takeoff step's Plans view is open (the caller, PcWorkspaceView, is the
   *  one that knows the List|Plans toggle state). */
  forceSlimSummary?: boolean;
}

export default function EstimatingWorkspace({
  currentStep, onSelectStep, doneByStep, saveState, nextAction, bidId,
  lines, settings, recap, proposed, dirty, savedGrandTotal, saving, syncing, saveError, duplicates, setLines, setSettings, save, syncTakeoff, showToast,
  comparables, insights, otherStepContent, initialInsightsOpen, forceSlimSummary,
  linesNotVerifiedOnPlansCount, onJumpToPlans, ambiguousQtyKeys,
}: EstimatingWorkspaceProps) {
  return (
    <EstimateShell
      currentStep={currentStep}
      onSelectStep={onSelectStep}
      doneByStep={doneByStep}
      saveState={saveState}
      nextAction={nextAction}
      forceSlimSummary={forceSlimSummary}
      summary={
        <BidSummary
          recap={recap}
          proposed={proposed}
          dirty={dirty}
          savedGrandTotal={savedGrandTotal}
          comparables={comparables}
          onJumpToUnmatched={() => onSelectStep('pricing')}
          onJumpToVerify={() => onSelectStep('takeoff')}
          linesNotVerifiedOnPlansCount={linesNotVerifiedOnPlansCount}
          onJumpToPlans={onJumpToPlans}
          ambiguousQtyKeys={ambiguousQtyKeys}
          insights={insights}
          initialInsightsOpen={initialInsightsOpen}
        />
      }
    >
      {currentStep === 'pricing' ? (
        <LaborPricingStep
          bidId={bidId}
          lines={lines}
          settings={settings}
          recap={recap}
          saving={saving}
          syncing={syncing}
          saveError={saveError}
          duplicates={duplicates}
          dirty={dirty}
          setLines={setLines}
          setSettings={setSettings}
          save={save}
          syncTakeoff={syncTakeoff}
          showToast={showToast}
        />
      ) : otherStepContent}
    </EstimateShell>
  );
}
