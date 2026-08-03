// frontend/src/features/leads/surveyMap.ts
//
// Field names deliberately mirror GenForm in features/builder/genData.ts so the
// output of surveyToGenFormFields can be merged directly over blankGenForm /
// defaults downstream. This module stays dependency-free (no import of genData).

export interface LeadSurvey {
  jobType?: 'new-install' | 'swap-out';
  brand?: 'Kohler' | 'Generac';
  coolingType?: 'air-cooled' | 'liquid-cooled';
  size?: string; // e.g. '22KW'; unset when sizingNeeded
  sizingNeeded?: boolean;
  fuel?: 'Natural Gas' | 'LP';
  genSide?: '' | 'Left' | 'Right';
  panelRel?: '' | 'Same side as panel' | 'Opposite side of panel' | 'Next to panel';
  panelFt?: number;
  feedFt?: number;
  base?: 'pad' | 'stand-small' | 'stand-big' | 'existing-pad';
  gasLine?: boolean; // swap-out only
  removal?: boolean; // swap-out only
  liftType?: 'none' | 'lull' | 'crane';
  battery?: boolean;
  emPanel?: boolean;
  surgeProQty?: number;
  smmQty?: number;
  notes?: string;
}

const BASE_TO_PAD_STAND: Record<
  NonNullable<LeadSurvey['base']>,
  { pad: boolean; genStand: 'none' | 'small' | 'big' }
> = {
  pad: { pad: true, genStand: 'none' },
  'stand-small': { pad: false, genStand: 'small' },
  'stand-big': { pad: false, genStand: 'big' },
  'existing-pad': { pad: false, genStand: 'none' },
};

/** Only answered questions produce keys — merge over blankGenForm/defaults downstream. */
export function surveyToGenFormFields(s: LeadSurvey): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Simple pass-through fields.
  if (s.jobType !== undefined) out.jobType = s.jobType;
  if (s.brand !== undefined) out.brand = s.brand;
  if (s.coolingType !== undefined) out.coolingType = s.coolingType;
  if (s.fuel !== undefined) out.fuel = s.fuel;
  if (s.genSide !== undefined) out.genSide = s.genSide;
  if (s.panelRel !== undefined) out.panelRel = s.panelRel;
  if (s.feedFt !== undefined) out.feedFt = s.feedFt;
  if (s.liftType !== undefined) out.liftType = s.liftType;
  if (s.battery !== undefined) out.battery = s.battery;
  if (s.emPanel !== undefined) out.emPanel = s.emPanel;
  if (s.surgeProQty !== undefined) out.surgeProQty = s.surgeProQty;
  if (s.smmQty !== undefined) out.smmQty = s.smmQty;
  if (s.notes !== undefined) out.notes = s.notes;

  // panelFt: pass through, but dropped when panelRel === 'Next to panel'.
  if (s.panelFt !== undefined && s.panelRel !== 'Next to panel') {
    out.panelFt = s.panelFt;
  }

  // size: only when sizingNeeded is not true and size is set.
  if (s.size !== undefined && s.sizingNeeded !== true) {
    out.size = s.size;
  }

  // base -> pad/genStand.
  if (s.base !== undefined) {
    Object.assign(out, BASE_TO_PAD_STAND[s.base]);
  }

  // gasLine/removal: swap-out only.
  if (s.jobType === 'swap-out') {
    if (s.gasLine !== undefined) out.gasLine = s.gasLine;
    if (s.removal !== undefined) out.removal = s.removal;
  }

  return out;
}
