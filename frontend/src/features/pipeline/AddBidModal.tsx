import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Bid } from '../../types';
import { PROJECT_TYPES } from '../preconstruction/constants';
import { moneyShort } from '../../lib/money';

interface Props {
  onClose: () => void;
  onAdded: (bid: Bid) => void;
  initialGc?: string;
}

interface ComparablesPreview {
  count: number;
  won: number;
  lost: number;
  avgPerSf: number | null;
  top: { id: string; name: string; brand: string; project_type: string; sq_ft: number; amount: number; stage: string }[];
}

export default function AddBidModal({ onClose, onAdded, initialGc }: Props) {
  const [f, setF] = useState({ name: '', gc: initialGc ?? '', loc: '', amount: '', due: '', notes: '', project_type: '', sq_ft: '', brand: '' });
  const [notifyTeam, setNotifyTeam] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [preview, setPreview] = useState<ComparablesPreview | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }));

  const ok = f.name.trim() && f.gc.trim();

  useEffect(() => {
    let cancelled = false;
    api.get('/bids/meta/brands')
      .then(({ data }) => { if (!cancelled) setBrands(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!f.brand.trim() && !f.project_type.trim()) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (f.brand.trim()) params.set('brand', f.brand.trim());
      if (f.project_type.trim()) params.set('project_type', f.project_type.trim());
      if (f.sq_ft.trim()) params.set('sq_ft', f.sq_ft.trim());
      api.get(`/preconstruction/comparables-preview?${params.toString()}`)
        .then(({ data }) => { if (!cancelled) setPreview(data); })
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [f.brand, f.project_type, f.sq_ft]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/bids', { ...f, brand: f.brand.trim(), suppress_notify: !notifyTeam });
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
              <label htmlFor="bid-brand">Brand / Prototype <span style={{fontWeight:400,color:'var(--text3)'}}>— optional</span></label>
              <input id="bid-brand" list="brand-options" value={f.brand} onChange={set('brand')} placeholder="e.g. Sonny's"/>
              <datalist id="brand-options">
                {Array.from(new Set(brands)).map(b => <option key={b} value={b}/>)}
              </datalist>
            </div>
            {preview && preview.count > 0 && (
              <div aria-live="polite" style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', fontSize: 12.5 }}>
                <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
                  {preview.count} similar past bids
                  {preview.avgPerSf != null ? ` · avg $${preview.avgPerSf.toFixed(2)}/SF` : ''} · {preview.won} won {preview.lost} lost
                </div>
                {preview.top.slice(0, 3).map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', color: 'var(--text3)' }}>
                    <span>{c.name}</span>
                    <span>{c.sq_ft.toLocaleString()} sf</span>
                    <span>{moneyShort(c.amount)}</span>
                    <span>{c.stage === 'awarded' ? 'won' : c.stage === 'lost' ? 'lost' : 'open'}</span>
                  </div>
                ))}
              </div>
            )}
            {preview && preview.count === 0 && f.brand.trim() && (
              <div style={{ color: 'var(--text3)', fontSize: 12.5 }}>No similar past bids yet.</div>
            )}
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
