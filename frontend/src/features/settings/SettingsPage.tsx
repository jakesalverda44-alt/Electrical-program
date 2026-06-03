import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import Icon from '../../components/Icon';

interface Setting {
  key: string;
  value: string;
}

const FIELD_META: Record<string, { label: string; desc: string; type: 'text' | 'password' | 'email' | 'url'; placeholder: string }> = {
  email_resend_api_key: {
    label: 'Resend API Key',
    desc: 'Your Resend.com API key. Get one free at resend.com — required for sending proposals by email.',
    type: 'password',
    placeholder: 're_••••••••••••••••••••••••',
  },
  email_from_address: {
    label: 'From Address',
    desc: 'The email address proposals are sent from. Must be verified in your Resend account.',
    type: 'email',
    placeholder: 'proposals@accuratepowerandtechnology.com',
  },
  email_from_name: {
    label: 'From Name',
    desc: 'The sender name customers will see in their inbox.',
    type: 'text',
    placeholder: 'Accurate Power & Technology',
  },
  email_reply_to: {
    label: 'Reply-To Address',
    desc: 'When a customer hits Reply on the proposal email, it will go to this address.',
    type: 'email',
    placeholder: 'jakes@accuratepowerandtechnology.com',
  },
  frontend_url: {
    label: 'App URL',
    desc: 'The public URL of this app (your Render URL). Used to generate the proposal signing link in emails.',
    type: 'url',
    placeholder: 'https://your-app.onrender.com',
  },
};

const KEY_ORDER = ['email_resend_api_key', 'email_from_address', 'email_from_name', 'email_reply_to', 'frontend_url'];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [edits,    setEdits]    = useState<Record<string, string>>({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testing,   setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'error'>('idle');

  useEffect(() => {
    api.get('/settings')
      .then(r => {
        const map: Record<string, string> = {};
        (r.data as Setting[]).forEach(s => { map[s.key] = s.value; });
        setSettings(map);
        setEdits(map);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/settings', edits);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      // Refresh to get masked key
      const r = await api.get('/settings');
      const map: Record<string, string> = {};
      (r.data as Setting[]).forEach(s => { map[s.key] = s.value; });
      setSettings(map);
      setEdits(map);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    setTestResult('idle');
    try {
      await api.post('/settings/test-email', { to: testEmail.trim() });
      setTestResult('ok');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const hasChanges = KEY_ORDER.some(k => edits[k] !== settings[k]);

  if (loading) {
    return (
      <div className="scroll view-enter">
        <div style={{ padding: 32, color: 'var(--text3)' }}>Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 60px', maxWidth: 680 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', marginBottom: 4 }}>Settings</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Configure email delivery for generator proposals.</div>
        </div>

        {/* Email Settings Panel */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                <Icon name="send" size={15} stroke={1.8}/>
              </span>
              Email Settings
            </span>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {KEY_ORDER.map(key => {
              const meta = FIELD_META[key];
              if (!meta) return null;
              return (
                <div key={key}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{meta.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, lineHeight: 1.5 }}>{meta.desc}</div>
                  <input
                    type={meta.type}
                    value={edits[key] ?? ''}
                    onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={meta.placeholder}
                    style={{
                      width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13,
                      fontWeight: 600, color: 'var(--text)', background: 'var(--surface2)',
                      border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px', outline: 'none',
                    }}
                  />
                </div>
              );
            })}

            {error && (
              <div style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={handleSave} disabled={saving || !hasChanges}
                style={{ padding: '10px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: saving || !hasChanges ? 'not-allowed' : 'pointer', opacity: !hasChanges ? .5 : 1 }}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
              {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
            </div>
          </div>
        </div>

        {/* Test email panel */}
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                <Icon name="check" size={15} stroke={2}/>
              </span>
              Test Email Delivery
            </span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
              Send a test email to verify your Resend API key and domain are configured correctly.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="your@email.com"
                style={{
                  flex: 1, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 9,
                  padding: '9px 12px', outline: 'none',
                }}
              />
              <button onClick={handleTest} disabled={testing || !testEmail.trim()}
                style={{ padding: '9px 20px', background: 'var(--navy, #1B3A6B)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: testing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                {testing ? 'Sending…' : 'Send Test'}
              </button>
            </div>
            {testResult === 'ok' && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>
                ✓ Test email sent — check your inbox.
              </div>
            )}
            {testResult === 'error' && (
              <div style={{ marginTop: 10, fontSize: 13, color: '#DC2626', fontWeight: 700 }}>
                ✗ Failed — check your API key and from address in Resend.
              </div>
            )}
          </div>
        </div>

        {/* Setup guide */}
        <div style={{ marginTop: 24, background: 'var(--blue-soft)', borderRadius: 12, padding: '18px 20px', border: '1px solid var(--blue-soft)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--blue)', marginBottom: 10 }}>First-time setup checklist</div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text2)', lineHeight: 2 }}>
            <li>Create a free account at <strong>resend.com</strong></li>
            <li>In Resend, go to <strong>Domains → Add Domain</strong> and enter <strong>accuratepowerandtechnology.com</strong></li>
            <li>Add the SPF and DKIM DNS records Resend gives you to your domain registrar (takes ~10 min to verify)</li>
            <li>In Resend, go to <strong>API Keys → Create API Key</strong> and paste it above</li>
            <li>Set your App URL to your Render deployment URL</li>
            <li>Hit <strong>Save</strong>, then send a test email to confirm everything works</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
