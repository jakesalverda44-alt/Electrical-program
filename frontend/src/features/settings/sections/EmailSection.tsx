import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, inputStyle } from '../shared';

export function EmailSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  // Text settings still edited here. Mail is sent through Microsoft Graph (the shared
  // mailbox), so the old Resend API key / from / reply-to fields are gone.
  const keys = ['email_signature', 'frontend_url'];
  const parseEmails = (raw?: string): string[] => {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  };

  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [bidOn, setBidOn] = useState(settings.bid_notify_enabled !== 'false');
  const [emails, setEmails] = useState<string[]>(parseEmails(settings.bid_notify_emails));
  const [emailIn, setEmailIn] = useState('');
  const [orig, setOrig] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'error'>('idle');

  const snapshot = (v: Record<string, string>, b: boolean, e: string[]) => JSON.stringify({ v, b, e });

  useEffect(() => {
    const v = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    const b = settings.bid_notify_enabled !== 'false';
    const e = parseEmails(settings.bid_notify_emails);
    setVals(v); setBidOn(b); setEmails(e); setOrig(snapshot(v, b, e));
  }, [settings]);

  const hasChanges = snapshot(vals, bidOn, emails) !== orig;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const addEmail = () => {
    const v = emailIn.trim().toLowerCase();
    if (!v || emails.includes(v)) return;
    setEmails(prev => [...prev, v]);
    setEmailIn('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ...vals,
        bid_notify_enabled: bidOn ? 'true' : 'false',
        bid_notify_emails: JSON.stringify(emails),
      });
      setOrig(snapshot(vals, bidOn, emails));
      onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const testSend = async () => {
    setTesting(true); setTestResult('idle');
    try { await api.post('/settings/test-email', { to: testTo }); setTestResult('ok'); }
    catch { setTestResult('error'); }
    finally { setTesting(false); }
  };

  return (
    <div>
      <SectionTitle title="Email Delivery" sub="The app sends mail through your Microsoft 365 mailbox (Graph). Manage app links, signature, and who new-bid emails go to."/>

      <Field label="App URL" desc="Your Render deployment URL — used in proposal signing links and email buttons.">
        <input type="url" style={inputStyle} value={vals.frontend_url} onChange={set('frontend_url')} placeholder="https://your-app.onrender.com"/>
      </Field>

      <Field label="Email Signature" desc="Appended to every email the app sends. Leave blank to use the default branded Accurate Power signature with logo. Enter plain text or HTML here to override it.">
        <textarea
          style={{ ...inputStyle, minHeight: 110, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
          value={vals.email_signature}
          onChange={set('email_signature')}
          placeholder={'Leave blank for the default logo signature, or paste custom text/HTML to override.'}
        />
      </Field>

      {/* New-bid email recipients — who gets the "New Bid" email when a bid is added
          or sent to the team from the Accept panel / pipeline. */}
      <div style={{ marginTop: 8, marginBottom: 8, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>New Bid Email Recipients</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>The team list that receives the “New Bid” email. Used for the auto-send when a bid is added and for “Email to Team” on the Intake and pipeline screens.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>Auto-send</span>
            <Toggle on={bidOn} onToggle={() => setBidOn(o => !o)}/>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 12 }}>
          Auto-send emails this list automatically whenever a new bid is added. With it off, you can still send manually from the Accept panel or a bid’s “Email Bid to Team” button.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="email"
            value={emailIn}
            onChange={e => setEmailIn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
            placeholder="estimator@accuratepower.com"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border2)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
          />
          <button className="btn ghost" onClick={addEmail} style={{ height: 38, padding: '0 16px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {emails.map(em => (
            <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
              background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid rgba(77,141,247,.25)',
              borderRadius: 20, padding: '4px 10px 4px 12px' }}>
              {em}
              <button onClick={() => setEmails(prev => prev.filter(x => x !== em))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
            </span>
          ))}
          {emails.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No recipients added yet.</span>}
        </div>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Test Email</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>Send a test through Microsoft Graph to verify delivery.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="email" style={{ ...inputStyle, flex: 1 }} value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="your@email.com"/>
          <button onClick={testSend} disabled={testing || !testTo}
            style={{ padding: '9px 20px', background: 'var(--navy, #1B3A6B)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {testing ? 'Sending…' : 'Send Test'}
          </button>
        </div>
        {testResult === 'ok'    && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Test email delivered — check your inbox.</div>}
        {testResult === 'error' && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)', fontWeight: 700 }}>✗ Delivery failed — confirm the Microsoft Graph credentials are set.</div>}
      </div>
    </div>
  );
}
