// Active board stages, in order. These drive the filter pills, the board columns, and
// the stage selector. New -> Contacted -> Site Scheduled, plus Lost (an exit from any
// stage). "Converted" is a terminal state set automatically on handoff and is NOT shown
// on the board — it lives in ALL_LEAD_STAGES only so labels/colors still resolve.
export const LEAD_STAGES = [
  { key: 'new',            label: 'New',            color: '#4D8DF7' },
  { key: 'contacted',      label: 'Contacted',      color: '#8B5CF6' },
  { key: 'site-scheduled', label: 'Site Scheduled', color: '#06B6D4' },
  { key: 'lost',           label: 'Lost',           color: '#7C8AA3' },
] as const;

export const CONVERTED_STAGE = { key: 'converted', label: 'Converted', color: '#34C588' } as const;

// All stages including the hidden terminal "Converted" — use for label/color lookups.
export const ALL_LEAD_STAGES = [...LEAD_STAGES, CONVERTED_STAGE] as const;

export type LeadStageKey = typeof ALL_LEAD_STAGES[number]['key'];

// Options offered when creating a new lead going forward.
export const NEW_LEAD_SOURCES = ['kohler', 'generac', 'cummins', 'call-in'] as const;

export const SOURCE_LABELS: Record<string, string> = {
  kohler:   'Kohler',
  generac:  'Generac',
  cummins:  'Cummins',
  'call-in': 'Call-in',
  // Legacy values — kept so existing leads still resolve a label.
  web:      'Web',
  phone:    'Phone',
  referral: 'Referral',
  other:    'Other',
};

export const INTEREST_LABELS: Record<string, string> = {
  unknown:       'Unknown',
  warm:          'Warm',
  hot:           'Hot',
  'not-interested': 'Not Interested',
};

export const INTEREST_COLORS: Record<string, string> = {
  unknown:       'var(--text3)',
  warm:          '#E0A53B',
  hot:           '#F2854F',
  'not-interested': '#7C8AA3',
};
