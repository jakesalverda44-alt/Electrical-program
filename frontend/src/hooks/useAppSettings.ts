import { useState, useEffect } from 'react';
import { setCurrency } from '../lib/money';
import { useApi } from './useApi';

export interface AppSettings {
  // Company
  company_name: string;
  company_address: string;
  company_city: string;
  company_state: string;
  company_zip: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  company_license_ec: string;
  company_license_cfc: string;
  company_license_li: string;
  // Proposal defaults
  gen_default_labor: string;
  gen_default_permit: string;
  gen_default_startup: string;
  gen_default_tax_rate: string;
  gen_default_pad: string;
  gen_default_smm: string;
  gen_default_surge_pro: string;
  gen_default_battery: string;
  gen_default_extra_wire: string;
  gen_default_lull: string;
  gen_default_crane: string;
  gen_default_deposit_pct: string;
  gen_default_valid_days: string;
  gen_pricing_table: string;
  // EV charger quotes. Tax is a flat dollar passthrough, not a rate — see evData.
  ev_default_tax: string;
  ev_default_valid_days: string;
  ev_default_deposit_pct: string;
  proposal_default_message: string;
  gas_contacts_text: string;
  // Email
  email_resend_api_key: string;
  email_from_address: string;
  email_from_name: string;
  email_reply_to: string;
  email_signature: string;
  frontend_url: string;
  // AI
  ai_anthropic_key: string;
  ai_model: string;
  ai_takeoff_agent2_model: string;
  ai_takeoff_agent3_model: string;
  ai_max_tokens: string;
  ai_max_tokens_agent1: string;
  ai_max_tokens_agent2: string;
  ai_max_tokens_agent3: string;
  ai_temperature: string;
  ai_prompt_agent1: string;
  ai_prompt_agent2: string;
  ai_prompt_agent3: string;
  ai_takeoff_agent4_model: string;
  ai_max_tokens_agent4: string;
  ai_prompt_agent4: string;
  ai_reply_draft_model: string;
  ai_build_from_notes_model: string;
  // AI takeoff doc prep — Task 2/3 (phase 2 takeoff fidelity): page classifier
  // model, and per-class DPI / max-tiles-per-page overrides. All optional —
  // empty means "use the built-in default" (see documentPrep.ts's tileSettingsFor).
  // Takeoff accuracy Task 1 — the dedicated counting stage (Agent 1C).
  ai_takeoff_counter_model: string;
  ai_takeoff_evidence_model: string;
  ai_job_profile_model: string;
  ai_max_tokens_evidence: string;
  ai_max_tokens_counter: string;
  ai_prep_classifier_model: string;
  ai_prep_dpi_schedule: string;
  ai_prep_dpi_plan: string;
  ai_prep_tiles_schedule: string;
  ai_prep_tiles_plan: string;
  // AI permissions
  ai_enabled: string;
  ai_analysis_enabled: string;
  ai_daily_limit_per_user: string;
  ai_role_permissions: string;
  // Commissions & sales goals
  commission_default_rate: string;
  sales_goal_monthly: string;
  // Localization
  currency_code: string;
  // Bid notifications
  bid_notify_enabled: string;
  bid_notify_emails: string;
  // Gen award kickoff email
  award_recipients: string;
  // Phase 4 Task 4 — electrical proposal quiet-sweep follow-up delay
  // (services/proposalQuietSweep.ts's sweepQuietBids), the bids-side
  // counterpart to the generator pipeline's own (unsurfaced) gen_followup_*
  // settings. Post-merge rework (2026-09-03) collapsed the sweep to one
  // tier — elec_followup_viewed_days is gone (the "viewed" tracking it
  // depended on went away with the public proposal page).
  elec_followup_quiet_days: string;
  // Estimating (legacy flat unit-cost library — read-only fallback no longer
  // used by pricing; kept for any remaining reader)
  unit_cost_library: string;
  // Estimating labor engine (Part 2, Task 11 — Settings > Labor Library > Defaults)
  est_default_labor_rate: string;
  est_default_material_tax_pct: string;
  est_default_small_tools_pct: string;
  est_default_supervision_pct: string;
  est_default_consumables_pct: string;
  // Fix round 1 / B8 — Decision 7's own drops/slack defaults (migration
  // 108 already seeded these two keys; nothing read or wrote them until
  // now — see LaborLibrarySection.tsx's DefaultsPanel and PlansWorkspace.
  // tsx's DropsSlackPopover).
  est_default_drop_ft: string;
  est_default_slack_pct: string;
  // Other
  notifications_json: string;
  security_session_timeout: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  company_name: 'Accurate Power & Technology',
  company_address: '', company_city: '', company_state: 'FL',
  company_zip: '', company_phone: '', company_email: '', company_website: '',
  company_license_ec: 'EC13007737', company_license_cfc: 'CFC1430965', company_license_li: 'LI45063',
  gen_default_labor: '3000', gen_default_permit: '1250', gen_default_startup: '695',
  gen_default_tax_rate: '7', gen_default_pad: '485', gen_default_smm: '250',
  gen_default_surge_pro: '395', gen_default_battery: '185', gen_default_extra_wire: '25',
  gen_default_lull: '1100', gen_default_crane: '1800',
  gen_default_deposit_pct: '50', gen_default_valid_days: '30', gen_pricing_table: '',
  ev_default_tax: '50', ev_default_valid_days: '30', ev_default_deposit_pct: '0',
  proposal_default_message: 'Thank you for the opportunity to provide you with back-up power at your home.', gas_contacts_text: '',
  email_resend_api_key: '', email_from_address: '', email_from_name: '', email_reply_to: '', email_signature: '', frontend_url: '',
  ai_anthropic_key: '', ai_model: 'claude-sonnet-4-6',
  ai_takeoff_agent2_model: 'claude-haiku-4-5-20251001', ai_takeoff_agent3_model: 'claude-haiku-4-5-20251001',
  ai_max_tokens: '4096', ai_max_tokens_agent1: '16000', ai_max_tokens_agent2: '32000', ai_max_tokens_agent3: '16000',
  ai_temperature: '0.3',
  ai_prompt_agent1: '', ai_prompt_agent2: '', ai_prompt_agent3: '',
  ai_takeoff_agent4_model: 'claude-sonnet-4-6', ai_max_tokens_agent4: '8000', ai_prompt_agent4: '',
  ai_reply_draft_model: 'claude-opus-4-8', ai_build_from_notes_model: 'claude-haiku-4-5-20251001',
  ai_takeoff_counter_model: 'claude-opus-5-5', ai_max_tokens_counter: '32000',
  ai_takeoff_evidence_model: 'claude-opus-5-5', ai_max_tokens_evidence: '16000',
  ai_job_profile_model: 'claude-sonnet-5',
  ai_prep_classifier_model: 'claude-haiku-4-5-20251001',
  ai_prep_dpi_schedule: '', ai_prep_dpi_plan: '', ai_prep_tiles_schedule: '', ai_prep_tiles_plan: '',
  ai_enabled: 'true', ai_analysis_enabled: 'true', ai_daily_limit_per_user: '10', ai_role_permissions: '',
  commission_default_rate: '3',
  sales_goal_monthly: '',
  currency_code: 'USD',
  bid_notify_enabled: 'true', bid_notify_emails: '[]',
  award_recipients: '[]',
  elec_followup_quiet_days: '5',
  unit_cost_library: '',
  est_default_labor_rate: '38', est_default_material_tax_pct: '7', est_default_small_tools_pct: '3',
  est_default_supervision_pct: '0', est_default_consumables_pct: '2',
  est_default_drop_ft: '10', est_default_slack_pct: '10',
  notifications_json: '{}', security_session_timeout: '480',
};

const DEFAULT_ROLE_PERMS: Record<string, Record<string, boolean>> = {
  owner:           { run_analysis: true,  manage_settings: true,  view_results: true  },
  administrator:   { run_analysis: true,  manage_settings: true,  view_results: true  },
  estimator:       { run_analysis: true,  manage_settings: false, view_results: true  },
  sales_manager:   { run_analysis: false, manage_settings: false, view_results: true  },
  salesperson:     { run_analysis: false, manage_settings: false, view_results: false },
  project_manager: { run_analysis: false, manage_settings: false, view_results: true  },
  technician:      { run_analysis: false, manage_settings: false, view_results: false },
  accounting:      { run_analysis: false, manage_settings: false, view_results: false },
  read_only:       { run_analysis: false, manage_settings: false, view_results: false },
  // legacy
  manager:         { run_analysis: true,  manage_settings: true,  view_results: true  },
};

export function checkAIPermission(
  permission: 'run_analysis' | 'view_results' | 'manage_settings',
  role: string,
  settings: AppSettings
): boolean {
  if (settings.ai_enabled === 'false') return false;
  if (permission === 'run_analysis' && settings.ai_analysis_enabled === 'false') return false;
  try {
    const stored = settings.ai_role_permissions ? JSON.parse(settings.ai_role_permissions) : {};
    const merged = { ...DEFAULT_ROLE_PERMS, ...stored };
    return merged[role]?.[permission] ?? false;
  } catch {
    return DEFAULT_ROLE_PERMS[role]?.[permission] ?? false;
  }
}

export function useAppSettings(authenticated: boolean) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  const { data, error, loading, reload } = useApi<{ key: string; value: string }[]>('/settings', {
    enabled: authenticated,
  });

  useEffect(() => {
    if (!data) return;
    const map: Partial<AppSettings> = {};
    data.forEach(s => { (map as Record<string, string>)[s.key] = s.value; });
    setCurrency(map.currency_code);
    setSettings(prev => ({ ...prev, ...map }));
  }, [data]);

  // "Loaded" has always meant "we are done trying", not "we succeeded" — a
  // failure still falls back to DEFAULT_APP_SETTINGS rather than blocking boot.
  const loaded = authenticated ? (!loading && (!!data || !!error)) : true;

  return { settings, setSettings, loaded, reload };
}
