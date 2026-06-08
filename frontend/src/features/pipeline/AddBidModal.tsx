import React, { useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Bid } from '../../types';
import { PROJECT_TYPES } from '../preconstruction/constants';

interface Props {
  onClose: () => void;
  onAdded: (bid: Bid) => void;
  initialGc?: string;
}

export default function AddBidModal({ onClose, onAdded, initialGc }: Props) {
  const [f, setF] = useState({ name: '', gc: initialGc ?? '', loc: '', amount: '', due: '', notes: '', project_type: '', sq_ft: '' });
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }));

  const ok = f.name.trim() && f.gc.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/bids', { ...f, suppress_notify: !notifyTeam });
      onAdded(data);
    } catch {
      setError('Failed to add bid. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <h3>New Electrical Bid</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Project name</label>
              <input value={f.name} onChange={set('name')} placeholder="e.g. Riverview Medical Office" autoFocus required/>
            </div>
            <div className="field-row">
              <div className="field">
                <label>General contractor</label>
                <input value={f.gc} onChange={set('gc')} placeholder="e.g. Brasfield & Gorrie" required autoComplete="off"/>
              </div>
              <div className="field">
                <label>Location</label>
                <input value={f.loc} onChange={set('loc')} placeholder="City, FL"/>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Bid amount (USD) <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
                <input className="num" type="number" value={f.amount} onChange={set('amount')} placeholder="Assign after submission" min="0"/>
              </div>
              <div className="field">
                <label>Due date</label>
                <input type="date" value={f.due} onChange={set('due')}/>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Project Type <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
                <select value={f.project_type} onChange={set('project_type')} style={{ width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px' }}>
                  <option value="">Select type…</option>
                  {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Square Footage <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
                <input className="num" type="number" value={f.sq_ft} onChange={set('sq_ft')} placeholder="e.g. 5000" min="0"/>
              </div>
            </div>
            <div className="field">
              <label>Notes <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
              <textarea value={f.notes} onChange={set('notes')} placeholder="Scope details, contacts, special requirements…"
                rows={3} style={{ resize: 'vertical', minHeight: 72 }}/>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginTop: 4 }}>
              <input
                type="checkbox"
                checked={notifyTeam}
                onChange={e => setNotifyTeam(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>
                Send notification email to team
              </span>
            </label>
            {error && <div className="login-error">{error}</div>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={!ok || saving}>
              {saving ? 'Adding…' : 'Add to Pipeline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
