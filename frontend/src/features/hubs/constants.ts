// frontend/src/features/hubs/constants.ts
export const GEN_HUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'leads',    label: 'Leads' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'jobs',     label: 'Jobs' },
] as const;
export const ELEC_HUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'intake',   label: 'Intake' },
  { key: 'bids',     label: 'Bids' },
  { key: 'projects', label: 'Projects' },
] as const;
export type GenHubTab  = typeof GEN_HUB_TABS[number]['key'];
export type ElecHubTab = typeof ELEC_HUB_TABS[number]['key'];
export function coerceGenTab(raw: string | null): GenHubTab {
  return (GEN_HUB_TABS.some(t => t.key === raw) ? raw : 'overview') as GenHubTab;
}
export function coerceElecTab(raw: string | null): ElecHubTab {
  return (ELEC_HUB_TABS.some(t => t.key === raw) ? raw : 'overview') as ElecHubTab;
}
