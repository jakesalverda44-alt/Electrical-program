import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { setCurrency } from '../lib/money';

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
  // Email
  email_resend_api_key: string;
  email_from_address: string;
  email_from_name: string;
  email_reply_to: string;
  frontend_url: string;
  // AI — Plan Analysis / Takeoff
  ai_anthropic_key: string;
  ai_model: string;
  ai_takeoff_agent2_model: string;
  ai_takeoff_agent3_model: string;
  ai_max_tokens: string;
  ai_temperature: string;
  // AI permissions
  ai_enabled: string;
  ai_analysis_enabled: string;
  ai_daily_limit_per_user: string;
  ai_role_permissions: string;
  // Commissions
  commission_default_rate: string;
  // Localization
  currency_code: string;
  // Bid notifications
  bid_notify_enabled: string;
  bid_notify_emails: string;
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
  email_resend_api_key: '', email_from_address: '', email_from_name: '', email_reply_to: '', frontend_url: '',
  ai_anthropic_key: '', ai_model: 'claude-sonnet-4-6', ai_takeoff_agent2_model: 'claude-haiku-4-5-20251001', ai_takeoff_agent3_model: 'claude-haiku-4-5-20251001', ai_max_tokens: '16000', ai_temperature: '0.3',
  ai_enabled: 'true', ai_analysis_enabled: 'true', ai_daily_limit_per_user: '10', ai_role_permissions: '',
  commission_default_rate: '3',
  currency_code: 'USD',
  bid_notify_enabled: 'true', bid_notify_emails: '[]',
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
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await api.get('/settings');
      const map: Partial<AppSettings> = {};
      (r.data as { key: string; value: string }[]).forEach(s => {
        (map as Record<string, string>)[s.key] = s.value;
      });
      setCurrency(map.currency_code);
      setSettings(prev => ({ ...prev, ...map }));
    } catch {
      // fail silently — use defaults
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) reload();
  }, [authenticated, reload]);

  return { settings, setSettings, loaded, reload };
}
