import React, { useState } from 'react';
import api from '../../../api/client';
import { SectionTitle } from '../shared';

const INTEGRATIONS = [
  { name: 'Google Calendar',    icon: '📅', desc: 'Sync appointments and job schedules.'    },
  { name: 'Microsoft Outlook',  icon: '📧', desc: 'Sync emails and calendar events.'       },
  { name: 'QuickBooks',         icon: '📊', desc: 'Sync invoices and payments.'            },
  { name: 'Stripe',             icon: '💳', desc: 'Accept online payments for proposals.'  },
  { name: 'Twilio',             icon: '💬', desc: 'Send SMS notifications and reminders.'  },
  { name: 'DocuSign',           icon: '✍️',  desc: 'Legally certified e-signatures.'       },
  { name: 'CompanyCam',         icon: '📷', desc: 'Sync job site photos automatically.'    },
];

function GoogleDriveCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ processed: number; skipped: number; errors: string[] } | null>(null);
  const [err, setErr] = useState('');

  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<{ moved: number; skipped: number; errors: string[] } | null>(null);
  const [fixErr, setFixErr] = useState('');

  const run = async () => {
    if (!confirm('This will create Google Drive folders for every bid that does not have one yet. Continue?')) return;
    setRunning(true);
    setErr('');
    setResult(null);
    try {
      const { data } = await api.post('/admin/backfill-drive', {}, { timeout: 300_000 });
      setResult(data);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed');
    } finally {
      setRunning(false);
    }
  };

  const fixAwarded = async () => {
    if (!confirm('This will move all awarded (in-progress) job folders from Completed Projects back to Active Projects. Continue?')) return;
    setFixing(true);
    setFixErr('');
    setFixResult(null);
    try {
      const { data } = await api.post('/admin/fix-drive-awarded', {}, { timeout: 300_000 });
      setFixResult(data);
    } catch (e: unknown) {
      setFixErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed');
    } finally {
      setFixing(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ fontSize: 28, lineHeight: 1 }}>☁️</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>Google Drive</span>
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: '#D1FAE5', color: '#065F46', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Active
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 10 }}>
          Automatically mirrors bids and documents to Google Drive. New bids get folders created automatically.
        </div>
        <button
          className="btn"
          disabled={running}
          onClick={run}
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          {running ? 'Creating folders…' : 'Backfill existing bids'}
        </button>
        {result && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
            <span style={{ color: '#065F46', fontWeight: 700 }}>{result.processed} folders created</span>
            {result.skipped > 0 && <span style={{ marginLeft: 8, color: '#92400E' }}>{result.skipped} skipped</span>}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 6, color: '#DC2626' }}>
                {result.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                {result.errors.length > 5 && <div>…and {result.errors.length - 5} more</div>}
              </div>
            )}
          </div>
        )}
        {err && <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>{err}</div>}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>One-time Fix</div>
          <button
            className="btn ghost"
            disabled={fixing}
            onClick={fixAwarded}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {fixing ? 'Moving folders…' : 'Move awarded jobs → Active Projects'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>
            Fixes awarded (in-progress) jobs that were incorrectly placed in Completed Projects.
          </div>
          {fixResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: '#065F46', fontWeight: 700 }}>{fixResult.moved} folders moved</span>
              {fixResult.skipped > 0 && <span style={{ marginLeft: 8, color: '#92400E' }}>{fixResult.skipped} skipped</span>}
              {fixResult.errors.length > 0 && (
                <div style={{ marginTop: 6, color: '#DC2626' }}>
                  {fixResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}
          {fixErr && <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>{fixErr}</div>}
        </div>
      </div>
    </div>
  );
}

export function IntegrationsSection() {
  return (
    <div>
      <SectionTitle title="Integrations" sub="Connect third-party services to extend your workflow."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <GoogleDriveCard />
        {INTEGRATIONS.map(int => (
          <div key={int.name} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{int.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{int.name}</span>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Coming Soon
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{int.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

