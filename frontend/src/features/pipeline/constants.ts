export const ELEC_STAGES = [
  { key: 'due',       label: 'Bids Due',   color: '#F2854F' },
  { key: 'submitted', label: 'Submitted',  color: '#4D8DF7' },
  { key: 'awarded',   label: 'Awarded',    color: '#34C588' },
  { key: 'lost',      label: 'Lost',       color: '#7C8AA3' },
] as const;

export type ElecStageKey = typeof ELEC_STAGES[number]['key'];
