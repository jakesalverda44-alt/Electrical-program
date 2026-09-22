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
    expect(mapLegacyTabToStep('rfis')).toBe('scope');
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

const ALL_DONE = { documents: true, takeoff: true, pricing: true, scope: true, review: true };
const NONE_DONE = { documents: false, takeoff: false, pricing: false, scope: false, review: false };

describe('deriveStepStatus', () => {
  it('documents is done when files exist', () => {
    expect(deriveStepStatus({
      hasFiles: true, hasTakeoffOutput: false, takeoffConfirmed: false,
      hasSavedPricingLines: false, hasUnmatchedNonExcluded: false, hasScopeText: false, proposalFiled: false,
    }).documents).toBe(true);
  });

  it('takeoff is done only when AI output exists AND key data is confirmed', () => {
    const base = { hasFiles: false, hasSavedPricingLines: false, hasUnmatchedNonExcluded: false, hasScopeText: false, proposalFiled: false };
    expect(deriveStepStatus({ ...base, hasTakeoffOutput: true, takeoffConfirmed: false }).takeoff).toBe(false);
    expect(deriveStepStatus({ ...base, hasTakeoffOutput: false, takeoffConfirmed: true }).takeoff).toBe(false);
    expect(deriveStepStatus({ ...base, hasTakeoffOutput: true, takeoffConfirmed: true }).takeoff).toBe(true);
  });

  it('pricing is done when lines are saved AND nothing unmatched remains', () => {
    const base = { hasFiles: false, hasTakeoffOutput: false, takeoffConfirmed: false, hasScopeText: false, proposalFiled: false };
    expect(deriveStepStatus({ ...base, hasSavedPricingLines: true, hasUnmatchedNonExcluded: true }).pricing).toBe(false);
    expect(deriveStepStatus({ ...base, hasSavedPricingLines: false, hasUnmatchedNonExcluded: false }).pricing).toBe(false);
    expect(deriveStepStatus({ ...base, hasSavedPricingLines: true, hasUnmatchedNonExcluded: false }).pricing).toBe(true);
  });

  it('scope is done when any scope text exists, review when the proposal is filed', () => {
    const base = { hasFiles: false, hasTakeoffOutput: false, takeoffConfirmed: false, hasSavedPricingLines: false, hasUnmatchedNonExcluded: false };
    expect(deriveStepStatus({ ...base, hasScopeText: true, proposalFiled: false }).scope).toBe(true);
    expect(deriveStepStatus({ ...base, hasScopeText: false, proposalFiled: true }).review).toBe(true);
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
    expect(stepHint('pricing', NONE_DONE)).toBe('Needs Takeoff first');
    expect(stepHint('review', NONE_DONE)).toBe('Needs Scope & RFIs first');
  });

  it('is null when the preceding step IS done (no hint needed even if this step is not)', () => {
    expect(stepHint('scope', { ...NONE_DONE, pricing: true })).toBeNull();
  });

  it('produces no hint anywhere once everything is done', () => {
    for (const s of ESTIMATE_STEPS) expect(stepHint(s.key as EstimateStepKey, ALL_DONE)).toBeNull();
  });
});
