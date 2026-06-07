import React, { useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Lead } from '../../types';

interface Props {
  onClose: () => void;
  onAdded: (lead: Lead) => void;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1100, padding: 20,
};
const MODAL: React.CSSProperties = {
  background: 'var(--surface)', borderRadius: 14,
  width: '100%', maxWidth: 480,
  boxShadow: '0 24px 64px rgba(0,0,0,.35)',
  overflow: 'hidden',
};
const HDR: React.CSSProperties = {
  background: 'var(--amber, #F59E0B)', color: '#11192a',
  padding: '16px 20px', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between',
};
const BODY: React.CSSProperties = { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 };
const FOOT: React.CSSProperties = {
  padding: '14px 22px', borderTop: '1px solid var(--border)',
  display: 'flex', gap: 10, justifyContent: 'flex-end',
};
const input: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 11px', outline: 'none',
  boxSizing: 'border-box', width: '100%',
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4, display: 'block' };

export default function AddLeadModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [source, setSource] = useState('phone');
  const [contactMethod, setContactMethod] = useState<'phone' | 'email'>('phone');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post<Lead>('/leads', {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        source,
        contact_method: contactMethod,
        notes: notes.trim() || null,
      });
      onAdded(data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save lead.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={OVERLAY} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={MODAL}>
        <div style={HDR}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .6, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
              Generator Leads
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Add New Lead</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,.5)', padding: 4 }}>
            <Icon name="x" size={18} stroke={2}/>
          </button>
        </div>

        <div style={BODY}>
          <div>
            <label style={label}>Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input style={input} value={name} onChange={e => setName(e.target.value)} placeholder="Customer name" autoFocus/>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>Phone</label>
              <input style={input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555" type="tel"/>
            </div>
            <div>
              <label style={label}>Email</label>
              <input style={input} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com" type="email"/>
            </div>
          </div>
          <div>
            <label style={label}>Address</label>
            <input style={input} value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, City, State"/>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>Source</label>
              <select style={{ ...input }} value={source} onChange={e => setSource(e.target.value)}>
                <option value="phone">Phone</option>
                <option value="web">Web</option>
                <option value="referral">Referral</option>
                <option value="kohler">Kohler</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={label}>Contact via</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                {(['phone', 'email'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setContactMethod(m)}
                    style={{
                      flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 700,
                      borderRadius: 8, cursor: 'pointer',
                      border: contactMethod === m ? '2px solid var(--amber)' : '2px solid var(--border2)',
                      background: contactMethod === m ? 'rgba(245,158,11,.12)' : 'var(--surface)',
                      color: contactMethod === m ? 'var(--amber)' : 'var(--text2)',
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label style={label}>Notes</label>
            <textarea
              style={{ ...input, resize: 'vertical', minHeight: 72 }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Initial notes, referral source details, etc."
            />
          </div>
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(224,106,106,.1)', border: '1px solid rgba(224,106,106,.3)', fontSize: 13, color: '#E06A6A', fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        <div style={FOOT}>
          <button className="btn ghost" onClick={onClose} disabled={saving} style={{ fontSize: 13 }}>Cancel</button>
          <button
            className="btn amber"
            onClick={save}
            disabled={!name.trim() || saving}
            style={{ fontSize: 13, minWidth: 120 }}
          >
            {saving ? 'Saving…' : <><Icon name="plus" size={14} stroke={2.4}/>Add Lead</>}
          </button>
        </div>
      </div>
    </div>
  );
}
