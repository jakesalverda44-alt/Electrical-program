import { describe, it, expect } from 'vitest';
import { mapLegacyTabToStep, legacyTabWantsInsights, stepToLegacyTab, deriveStepStatus, stepHint, ESTIMATE_STEPS, EstimateStepKey } from './steps';

describe('mapLegacyTabToStep', () => {
  it('maps every legacy tab key to the right step per the plan', () => {
    expect(mapLegacyTabToStep('overview')).toBe('documents');
    expect(mapLegacyTabToStep('prebid')).toBe('documents');
    expect(mapLegacyTabToStep('files')).toBe('documents');
    expect(mapLegacyTabToStep('bid')).toBe('takeoff');
    expect(mapLegacyTabToStep('takeoff')).toBe('takeoff');
    expect(mapLegacyTabToStep('pricing')).toBe('pricing');
    expect(mapLegacyTabToStep('scope')).toBe('scope');
    expect(mapLegacyTabToStep('rfis')).toBe('rfis');
    expect(mapLegacyTabToStep('proposal')).toBe('review');
    expect(mapLegacyTabToStep('costs')).toBe('pricing');
    expect(mapLegacyTabToStep('intel')).toBe('pricing');
    expect(mapLegacyTabToStep('compare')).toBe('pricing');
  });

  it('falls back to documents for an unknown/undefined value', () => {
    expect(mapLegacyTabToStep(undefined)).toBe('documents');
    expect(mapLegacyTabToStep('something-old')).toBe('documents');
  });
});

describe('legacyTabWantsInsights', () => {
  it('is true only for costs/intel', () => {
    expect(legacyTabWantsInsights('costs')).toBe(true);
    expect(legacyTabWantsInsights('intel')).toBe(true);
    expect(legacyTabWantsInsights('pricing')).toBe(false);
    expect(legacyTabWantsInsights(undefined)).toBe(false);
  });
});

describe('stepToLegacyTab', () => {
  it('round-trips through mapLegacyTabToStep for every step', () => {
    for (const step of ESTIMATE_STEPS) {
      expect(mapLegacyTabToStep(stepToLegacyTab(step.key))).toBe(step.key);
    }
  });
});

const ALL_DONE = { documents: true, takeoff: true, scope: true, rfis: true, pricing: true, review: true };
const NONE_DONE = { documents: false, takeoff: false, scope: false, rfis: false, pricing: false, review: false };
const BASE = {
  hasFiles: false, hasTakeoffOutput: false, takeoffConfirmed: false, hasSavedPricingLines: false,
  hasUnmatchedNonExcluded: false, hasScopeText: false, proposalFiled: false,
  analysisRunning: false, rfiCount: 0, draftRfiCount: 0, pendingAiRfiCount: 0, noRfis: false,
};

describe('deriveStepStatus', () => {
  it('documents is done when files exist', () => {
    expect(deriveStepStatus({ ...BASE, hasFiles: true }).documents).toBe(true);
  });

  it('takeoff is done only when AI output exists AND key data is confirmed', () => {
    expect(deriveStepStatus({ ...BASE, hasTakeoffOutput: true, takeoffConfirmed: false }).takeoff).toBe(false);
    expect(deriveStepStatus({ ...BASE, hasTakeoffOutput: false, takeoffConfirmed: true }).takeoff).toBe(false);
    expect(deriveStepStatus({ ...BASE, hasTakeoffOutput: true, takeoffConfirmed: true }).takeoff).toBe(true);
  });

  it('pricing is done when lines are saved AND nothing unmatched remains', () => {
    expect(deriveStepStatus({ ...BASE, hasSavedPricingLines: true, hasUnmatchedNonExcluded: true }).pricing).toBe(false);
    expect(deriveStepStatus({ ...BASE, hasSavedPricingLines: false, hasUnmatchedNonExcluded: false }).pricing).toBe(false);
    expect(deriveStepStatus({ ...BASE, hasSavedPricingLines: true, hasUnmatchedNonExcluded: false }).pricing).toBe(true);
  });

  it('scope needs scope text AND a finished takeoff; review is done when the proposal is filed', () => {
    expect(deriveStepStatus({ ...BASE, hasScopeText: true }).scope).toBe(false);
    expect(deriveStepStatus({ ...BASE, hasScopeText: true, hasTakeoffOutput: true, takeoffConfirmed: true }).scope).toBe(true);
    expect(deriveStepStatus({ ...BASE, proposalFiled: true }).review).toBe(true);
  });

  it('rfis follows the RFI done rule', () => {
    const d = (o: object) => deriveStepStatus({ ...BASE, ...o }).rfis;
    expect(d({ rfiCount: 2, analysisRunning: true })).toBe(false);
    expect(d({})).toBe(false);
    expect(d({ noRfis: true })).toBe(true);
    expect(d({ noRfis: true, rfiCount: 1, draftRfiCount: 1 })).toBe(false);
    expect(d({ rfiCount: 2 })).toBe(true);
    expect(d({ rfiCount: 2, pendingAiRfiCount: 1 })).toBe(false);
    expect(d({ noRfis: true, pendingAiRfiCount: 3 })).toBe(true);
  });
});

describe('stepHint', () => {
  it('is null for the first step regardless of status', () => {
    expect(stepHint('documents', NONE_DONE)).toBeNull();
  });

  it('is null once the step itself is done', () => {
    expect(stepHint('takeoff', { ...NONE_DONE, takeoff: true })).toBeNull();
  });

  it('hints the immediately preceding step when neither it nor this step is done', () => {
    expect(stepHint('pricing', NONE_DONE)).toBe('Needs RFIs first');
    expect(stepHint('review', NONE_DONE)).toBe('Needs Labor & Pricing first');
    expect(stepHint('scope', NONE_DONE)).toBe('Needs Takeoff first');
  });

  it('is null when the preceding step IS done (no hint needed even if this step is not)', () => {
    expect(stepHint('rfis', { ...NONE_DONE, scope: true })).toBeNull();
  });

  it('produces no hint anywhere once everything is done', () => {
    for (const s of ESTIMATE_STEPS) expect(stepHint(s.key as EstimateStepKey, ALL_DONE)).toBeNull();
  });

  it('has the exact step order', () => {
    expect(ESTIMATE_STEPS.map(s => s.key)).toEqual(['documents', 'takeoff', 'scope', 'rfis', 'pricing', 'review']);
  });

  it('shows running hints while the takeoff runs', () => {
    const o = { analysisRunning: true };
    expect(stepHint('takeoff', NONE_DONE, o)).toBe('Running…');
    for (const k of ['scope', 'rfis', 'pricing', 'review'] as const) expect(stepHint(k, NONE_DONE, o)).toBe('Takeoff running…');
    expect(stepHint('documents', NONE_DONE, o)).toBeNull();
    expect(stepHint('pricing', { ...NONE_DONE, pricing: true }, o)).toBeNull();
  });
});
