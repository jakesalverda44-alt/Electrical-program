import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

export function EmailSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['email_resend_api_key','email_from_address','email_from_name','email_reply_to','frontend_url'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [testTo,  setTestTo]  = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle'|'ok'|'error'>('idle');

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const testSend = async () => {
    setTesting(true); setTestResult('idle');
    try { await api.post('/settings/test-email', { to: testTo }); setTestResult('ok'); }
    catch { setTestResult('error'); }
    finally { setTesting(false); }
  };

  return (
    <div>
      <SectionTitle title="Email Delivery" sub="Configure how generator proposals are sent to customers."/>
      <Field label="Resend API Key" desc="Get a free key at resend.com. Required for sending proposals.">
        <input type="password" style={inputStyle} value={vals.email_resend_api_key} onChange={set('email_resend_api_key')} placeholder="re_••••••••••••"/>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <Field label="From Address" desc="Must be verified in Resend.">
          <input type="email" style={inputStyle} value={vals.email_from_address} onChange={set('email_from_address')} placeholder="proposals@yourcompany.com"/>
        </Field>
        <Field label="From Name">
          <input style={inputStyle} value={vals.email_from_name} onChange={set('email_from_name')} placeholder="Accurate Power & Technology"/>
        </Field>
        <Field label="Reply-To Address" desc="Where customer replies land.">
          <input type="email" style={inputStyle} value={vals.email_reply_to} onChange={set('email_reply_to')} placeholder="you@yourcompany.com"/>
        </Field>
        <Field label="App URL" desc="Your Render deployment URL — used in proposal signing links.">
          <input type="url" style={inputStyle} value={vals.frontend_url} onChange={set('frontend_url')} placeholder="https://your-app.onrender.com"/>
        </Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Test Email</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>Send a test to verify your configuration.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="email" style={{ ...inputStyle, flex: 1 }} value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="your@email.com"/>
          <button onClick={testSend} disabled={testing || !testTo}
            style={{ padding: '9px 20px', background: 'var(--navy, #1B3A6B)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {testing ? 'Sending…' : 'Send Test'}
          </button>
        </div>
        {testResult === 'ok'    && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Test email delivered — check your inbox.</div>}
        {testResult === 'error' && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)', fontWeight: 700 }}>✗ Delivery failed — check your API key and from address.</div>}
      </div>

      <div style={{ marginTop: 24, background: 'var(--blue-soft)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--blue)', marginBottom: 8 }}>First-time setup</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text2)', lineHeight: 2 }}>
          <li>Create a free account at <strong>resend.com</strong></li>
          <li>Go to <strong>Domains → Add Domain</strong> and add <strong>accuratepowerandtechnology.com</strong></li>
          <li>Add the SPF + DKIM records Resend provides to your domain registrar (~10 min to verify)</li>
          <li>Go to <strong>API Keys → Create API Key</strong> and paste it above</li>
          <li>Set your App URL to your Render deployment URL</li>
          <li>Save and send a test email</li>
        </ol>
      </div>
    </div>
  );
}
