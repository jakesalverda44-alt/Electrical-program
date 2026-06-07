export const LEAD_STAGES = [
  { key: 'new',            label: 'New',            color: '#4D8DF7' },
  { key: 'contacted',      label: 'Contacted',      color: '#8B5CF6' },
  { key: 'vetting',        label: 'Vetting',        color: '#F2854F' },
  { key: 'quoted',         label: 'Quoted',         color: '#E0A53B' },
  { key: 'site-scheduled', label: 'Site Scheduled', color: '#06B6D4' },
  { key: 'site-complete',  label: 'Site Complete',  color: '#10B981' },
  { key: 'proposal-sent',  label: 'Proposal Sent',  color: '#4D8DF7' },
  { key: 'won',            label: 'Won',            color: '#34C588' },
  { key: 'lost',           label: 'Lost',           color: '#7C8AA3' },
] as const;

export type LeadStageKey = typeof LEAD_STAGES[number]['key'];

export const SOURCE_LABELS: Record<string, string> = {
  web:      'Web',
  phone:    'Phone',
  referral: 'Referral',
  kohler:   'Kohler',
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
