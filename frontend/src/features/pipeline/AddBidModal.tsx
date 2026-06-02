import React, { useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Bid } from '../../types';

interface Props {
  onClose: () => void;
  onAdded: (bid: Bid) => void;
}

export default function AddBidModal({ onClose, onAdded }: Props) {
  const [f, setF] = useState({ name: '', gc: '', loc: '', amount: '', due: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }));

  const ok = f.name.trim() && f.gc.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/bids', f);
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
                <input value={f.gc} onChange={set('gc')} placeholder="GC name" required/>
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
