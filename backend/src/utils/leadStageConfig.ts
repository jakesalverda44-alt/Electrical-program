import { getSetting } from '../db/getSetting';

export interface StageConfig {
  followup_delay_hours: number | null;
  followup_title: string;
  overdue_after_hours: number | null;
}

export const DEFAULT_STAGE_CONFIG: Record<string, StageConfig> = {
  new:              { followup_delay_hours: 24,  followup_title: 'Follow up with {name}',             overdue_after_hours: 48  },
  contacted:        { followup_delay_hours: 48,  followup_title: 'Re-contact {name}',                 overdue_after_hours: 96  },
  vetting:          { followup_delay_hours: 72,  followup_title: 'Follow up: vetting {name}',         overdue_after_hours: 120 },
  quoted:           { followup_delay_hours: 48,  followup_title: 'Check in on quote for {name}',      overdue_after_hours: 72  },
  'site-scheduled': { followup_delay_hours: null, followup_title: '',                                 overdue_after_hours: 168 },
  'site-complete':  { followup_delay_hours: 48,  followup_title: 'Send proposal to {name}',           overdue_after_hours: 72  },
  'proposal-sent':  { followup_delay_hours: 72,  followup_title: 'Follow up on proposal for {name}', overdue_after_hours: 96  },
  won:              { followup_delay_hours: null, followup_title: '',                                 overdue_after_hours: null },
  lost:             { followup_delay_hours: null, followup_title: '',                                 overdue_after_hours: null },
};

export async function getStageConfig(): Promise<Record<string, StageConfig>> {
  try {
    const raw = await getSetting('lead_stage_config_json');
    if (!raw) return DEFAULT_STAGE_CONFIG;
    const overrides = JSON.parse(raw) as Partial<Record<string, Partial<StageConfig>>>;
    const merged: Record<string, StageConfig> = { ...DEFAULT_STAGE_CONFIG };
    for (const [stage, cfg] of Object.entries(overrides)) {
      if (merged[stage] && cfg) merged[stage] = { ...merged[stage], ...cfg };
    }
    return merged;
  } catch {
    return DEFAULT_STAGE_CONFIG;
  }
}
