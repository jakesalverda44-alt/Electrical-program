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

  const [genRunning, setGenRunning] = useState(false);
  const [genResult, setGenResult] = useState<{ processed: number; skipped: number; errors: string[] } | null>(null);
  const [genErr, setGenErr] = useState('');

  const [genFixing, setGenFixing] = useState(false);
  const [genFixResult, setGenFixResult] = useState<{ moved: number; skipped: number; errors: string[] } | null>(null);
  const [genFixErr, setGenFixErr] = useState('');

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

  const runGen = async () => {
    if (!confirm('This will create Google Drive folders for every awarded generator job that does not have one yet. Continue?')) return;
    setGenRunning(true);
    setGenErr('');
    setGenResult(null);
    try {
      const { data } = await api.post('/admin/backfill-gen-drive', {}, { timeout: 300_000 });
      setGenResult(data);
    } catch (e: unknown) {
      setGenErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed');
    } finally {
      setGenRunning(false);
    }
  };

  const fixGen = async () => {
    if (!confirm('This will move all existing generator job folders into the correct root folder (Active or Completed Generator Jobs). Continue?')) return;
    setGenFixing(true);
    setGenFixErr('');
    setGenFixResult(null);
    try {
      const { data } = await api.post('/admin/reorganize-gen-drive', {}, { timeout: 300_000 });
      setGenFixResult(data);
    } catch (e: unknown) {
      setGenFixErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed');
    } finally {
      setGenFixing(false);
    }
  };

  const fixAwarded = async () => {
    if (!confirm('This will move all existing job folders into the correct stage folder (Active Bids, Submitted Bids, Active Projects, or Completed Projects) with GC name hierarchy. Continue?')) return;
    setFixing(true);
    setFixErr('');
    setFixResult(null);
    try {
      const { data } = await api.post('/admin/reorganize-drive', {}, { timeout: 300_000 });
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
          <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--green-soft)', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
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
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>{result.processed} folders created</span>
            {result.skipped > 0 && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>{result.skipped} skipped</span>}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 6, color: 'var(--red)' }}>
                {result.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                {result.errors.length > 5 && <div>…and {result.errors.length - 5} more</div>}
              </div>
            )}
          </div>
        )}
        {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{err}</div>}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>One-time Fix</div>
          <button
            className="btn ghost"
            disabled={fixing}
            onClick={fixAwarded}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {fixing ? 'Reorganizing…' : 'Reorganize all Drive folders'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>
            Moves all existing job folders into the correct stage folder with GC name hierarchy.
          </div>
          {fixResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>{fixResult.moved} folders moved</span>
              {fixResult.skipped > 0 && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>{fixResult.skipped} skipped</span>}
              {fixResult.errors.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--red)' }}>
                  {fixResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}
          {fixErr && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{fixErr}</div>}
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Generator Jobs</div>
          <button
            className="btn"
            disabled={genRunning}
            onClick={runGen}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {genRunning ? 'Creating folders…' : 'Backfill generator jobs'}
          </button>
          {genResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>{genResult.processed} folders created</span>
              {genResult.skipped > 0 && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>{genResult.skipped} skipped</span>}
              {genResult.errors.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--red)' }}>
                  {genResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                  {genResult.errors.length > 5 && <div>…and {genResult.errors.length - 5} more</div>}
                </div>
              )}
            </div>
          )}
          {genErr && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{genErr}</div>}

          <button
            className="btn ghost"
            disabled={genFixing}
            onClick={fixGen}
            style={{ fontSize: 12, padding: '6px 12px', marginTop: 8 }}
          >
            {genFixing ? 'Reorganizing…' : 'Reorganize generator folders'}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>
            Moves generator job folders into Active or Completed Generator Jobs based on close status.
          </div>
          {genFixResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>{genFixResult.moved} folders moved</span>
              {genFixResult.skipped > 0 && <span style={{ marginLeft: 8, color: 'var(--amber)' }}>{genFixResult.skipped} skipped</span>}
              {genFixResult.errors.length > 0 && (
                <div style={{ marginTop: 6, color: 'var(--red)' }}>
                  {genFixResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}
          {genFixErr && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{genFixErr}</div>}
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
