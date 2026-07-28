// Logs a generator job that was never built in the proposal builder — typically work
// completed before the CRM existed. Records the job at its final stage directly, so no
// pipeline side effects (Drive folders, "moved to…" activity) fire for finished work.
import React, { useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Gen, WonJob } from '../../types';

interface Props {
  onClose: () => void;
  onAdded: (gen: Gen, wonJob: WonJob | null) => void;
}

const BRANDS = ['Kohler', 'Generac', 'Other'];

// 'signed' is deliberately absent — it means a real customer signature is on file.
const STAGES = [
  { value: 'awarded',  label: 'Awarded — job sold/completed' },
  { value: 'declined', label: 'Declined — customer passed'   },
  { value: 'sent',     label: 'Proposal Sent — still open'   },
  { value: 'building', label: 'Building — draft'             },
];

export default function LogGenJobModal({ onClose, onAdded }: Props) {
  const [f, setF] = useState({
    customer: '', loc: '', mfr: 'Kohler', model: '', kw: '',
    amount: '', tax: '', stage: 'awarded', date_won: '', proposal_no: '',
  });
  const [commissionPaid, setCommissionPaid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }));

  const ok = f.customer.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/gens', {
        customer: f.customer,
        loc: f.loc,
        mfr: f.mfr,
        model: f.model,
        kw: f.kw === '' ? 0 : Number(f.kw),
        amount: f.amount === '' ? 0 : Number(f.amount),
        tax: f.tax === '' ? 0 : Number(f.tax),
        proposal_no: f.proposal_no || null,
        stage: f.stage,
        date_won: f.stage === 'awarded' && f.date_won ? f.date_won : null,
        commission_paid: f.stage === 'awarded' ? commissionPaid : false,
      });
      const { wonJob, ...gen } = data as Gen & { wonJob?: WonJob };
      onAdded(gen as Gen, wonJob ?? null);
    } catch {
      setError('Failed to log the job. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <h3>Log Existing Generator Job</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 }}>
              For jobs quoted outside the proposal builder — older work from before the CRM.
              Awarded jobs count toward the $/kW benchmark and revenue reporting. No proposal
              document is generated.
            </p>
            <div className="field">
              <label>Customer</label>
              <input value={f.customer} onChange={set('customer')} placeholder="e.g. Debra Gierach" autoFocus required/>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Location</label>
                <input value={f.loc} onChange={set('loc')} placeholder="City, FL"/>
              </div>
              <div className="field">
                <label>Proposal # <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
                <input value={f.proposal_no} onChange={set('proposal_no')} placeholder="e.g. 2024-118"/>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Brand</label>
                <select value={f.mfr} onChange={set('mfr')} style={{ width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px' }}>
                  {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Model</label>
                <input value={f.model} onChange={set('model')} placeholder="e.g. 20RCAL"/>
              </div>
              <div className="field">
                <label>kW</label>
                <input className="num" type="number" value={f.kw} onChange={set('kw')} placeholder="e.g. 26" min="0" step="0.1"/>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contract amount (USD)</label>
                <input className="num" type="number" value={f.amount} onChange={set('amount')} placeholder="Total charged" min="0" step="0.01"/>
              </div>
              <div className="field">
                <label>Sales tax <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
                <input className="num" type="number" value={f.tax} onChange={set('tax')} placeholder="0.00" min="0" step="0.01"/>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Stage</label>
                <select value={f.stage} onChange={set('stage')} style={{ width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px' }}>
                  {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {f.stage === 'awarded' && (
                <div className="field">
                  <label>Date won</label>
                  <input type="date" value={f.date_won} onChange={set('date_won')}/>
                </div>
              )}
            </div>
            {f.stage === 'awarded' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginTop: 4 }}>
                <input type="checkbox" checked={commissionPaid} onChange={e => setCommissionPaid(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}/>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>
                  Commission already paid — don’t flag it as owed
                </span>
              </label>
            )}
            {error && <div className="login-error">{error}</div>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={!ok || saving}>
              {saving ? 'Logging…' : 'Log Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
