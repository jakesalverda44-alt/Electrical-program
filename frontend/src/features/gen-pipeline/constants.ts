export const GEN_STAGES = [
  { key: 'building', label: 'Building',      color: '#E0A53B' },
  { key: 'sent',     label: 'Proposal Sent', color: '#4D8DF7' },
  { key: 'awarded',  label: 'Awarded',       color: '#34C588' },
  { key: 'declined', label: 'Declined',      color: '#7C8AA3' },
] as const;

export type GenStageKey = typeof GEN_STAGES[number]['key'];
