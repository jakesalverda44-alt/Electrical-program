import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

export function CompanySection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['company_name','company_address','company_city','company_state','company_zip',
                 'company_phone','company_email','company_website',
                 'company_license_ec','company_license_cfc','company_license_li'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', vals);
      setOrig(vals);
      onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  return (
    <div>
      <SectionTitle title="Company Profile" sub="This information appears on generator proposals and system emails."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Company Name"><input style={inputStyle} value={vals.company_name} onChange={set('company_name')}/></Field>
        </div>
        <Field label="Address"><input style={inputStyle} value={vals.company_address} onChange={set('company_address')} placeholder="123 Main St"/></Field>
        <Field label="City"><input style={inputStyle} value={vals.company_city} onChange={set('company_city')}/></Field>
        <Field label="State"><input style={inputStyle} value={vals.company_state} onChange={set('company_state')} placeholder="FL"/></Field>
        <Field label="ZIP"><input style={inputStyle} value={vals.company_zip} onChange={set('company_zip')}/></Field>
        <Field label="Phone"><input style={inputStyle} value={vals.company_phone} onChange={set('company_phone')} placeholder="(555) 555-5555"/></Field>
        <Field label="Email"><input style={inputStyle} type="email" value={vals.company_email} onChange={set('company_email')}/></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Website"><input style={inputStyle} value={vals.company_website} onChange={set('company_website')} placeholder="https://accuratepowerandtechnology.com"/></Field>
        </div>
      </div>
      <div style={{ marginTop: 8, marginBottom: 4, fontSize: 13, fontWeight: 700, color: 'var(--text3)' }}>License Numbers</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Field label="Electrical (EC)"><input style={inputStyle} value={vals.company_license_ec} onChange={set('company_license_ec')}/></Field>
        <Field label="Mechanical (CFC)"><input style={inputStyle} value={vals.company_license_cfc} onChange={set('company_license_cfc')}/></Field>
        <Field label="LI"><input style={inputStyle} value={vals.company_license_li} onChange={set('company_license_li')}/></Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── USERS ─────────────────────────────────────────────────────────────────────

