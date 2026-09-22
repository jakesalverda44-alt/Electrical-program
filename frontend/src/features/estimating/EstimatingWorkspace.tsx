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
import { EstimateLine, EstimateSettings, PricingRecap } from './types';

export interface EstimatingWorkspaceProps {
  currentStep: EstimateStepKey;
  onSelectStep: (step: EstimateStepKey) => void;
  doneByStep: Record<EstimateStepKey, boolean>;
  saveState: SaveState;
  nextAction: { label: string; onClick: () => void } | null;

  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  proposed: boolean;
  saving: boolean;
  syncing: boolean;
  saveError: string | null;
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  save: () => Promise<void>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number } | null>;
  showToast?: (t: { title: string; sub?: string }) => void;

  comparables: ComparableForSummary[];
  insights: React.ReactNode;

  /** The other four steps' (already re-homed, unchanged) content — Labor &
   *  Pricing is the only step this module itself renders. */
  otherStepContent: React.ReactNode;
}

export default function EstimatingWorkspace({
  currentStep, onSelectStep, doneByStep, saveState, nextAction,
  lines, settings, recap, proposed, saving, syncing, saveError, setLines, setSettings, save, syncTakeoff, showToast,
  comparables, insights, otherStepContent,
}: EstimatingWorkspaceProps) {
  return (
    <EstimateShell
      currentStep={currentStep}
      onSelectStep={onSelectStep}
      doneByStep={doneByStep}
      saveState={saveState}
      nextAction={nextAction}
      summary={
        <BidSummary
          recap={recap}
          proposed={proposed}
          comparables={comparables}
          onJumpToUnmatched={() => onSelectStep('pricing')}
          onJumpToVerify={() => onSelectStep('takeoff')}
          insights={insights}
        />
      }
    >
      {currentStep === 'pricing' ? (
        <LaborPricingStep
          lines={lines}
          settings={settings}
          recap={recap}
          saving={saving}
          syncing={syncing}
          saveError={saveError}
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
