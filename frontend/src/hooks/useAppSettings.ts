import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

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
  gen_pricing_table: string;
  // Email
  email_resend_api_key: string;
  email_from_address: string;
  email_from_name: string;
  email_reply_to: string;
  frontend_url: string;
  // AI
  ai_anthropic_key: string;
  ai_model: string;
  ai_max_tokens: string;
  ai_temperature: string;
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
  gen_default_lull: '1100', gen_default_crane: '1800', gen_pricing_table: '',
  email_resend_api_key: '', email_from_address: '', email_from_name: '', email_reply_to: '', frontend_url: '',
  ai_anthropic_key: '', ai_model: 'claude-sonnet-4-6', ai_max_tokens: '4096', ai_temperature: '0.3',
  notifications_json: '{}', security_session_timeout: '480',
};

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
