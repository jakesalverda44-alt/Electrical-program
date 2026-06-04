import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

export function SecuritySection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [timeout, setTimeout_] = useState(settings.security_session_timeout || '480');
  const [orig, setOrig] = useState(settings.security_session_timeout || '480');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => { setTimeout_(settings.security_session_timeout || '480'); setOrig(settings.security_session_timeout || '480'); }, [settings]);

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', { security_session_timeout: timeout }); setOrig(timeout); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Security" sub="Account security settings and access controls."/>

      <Field label="Session Timeout (minutes)" desc="Users are automatically logged out after this many minutes of inactivity.">
        <input type="number" style={{ ...inputStyle, maxWidth: 200 }} value={timeout} onChange={e => setTimeout_(e.target.value)} min={30} max={10080}/>
      </Field>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={timeout !== orig}/>

      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { title: 'Two-Factor Authentication', desc: 'Require 2FA for all users on login.', badge: 'Coming Soon' },
          { title: 'Password Requirements',     desc: 'Minimum length: 8 characters. Must include a number and uppercase letter.', badge: 'Active' },
          { title: 'Login Restrictions',        desc: 'Limit access to specific IP ranges.', badge: 'Coming Soon' },
        ].map(item => (
          <div key={item.title} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{item.desc}</div>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 5,
              background: item.badge === 'Active' ? 'var(--green-soft)' : 'var(--surface2)',
              color: item.badge === 'Active' ? 'var(--green)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
              {item.badge}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
