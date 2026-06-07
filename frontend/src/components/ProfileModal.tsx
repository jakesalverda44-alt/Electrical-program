import React, { useState } from 'react';
import Icon from './Icon';
import api from '../api/client';
import { User } from '../types';

interface Props {
  user: User;
  onClose: () => void;
  onSaved: (updated: User) => void;
  showToast?: (t: { title: string; sub?: string }) => void;
}

const INPUT: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)',
  border: '1px solid var(--border2)', borderRadius: 9,
  padding: '9px 12px', outline: 'none', boxSizing: 'border-box',
};

export default function ProfileModal({ user, onClose, onSaved, showToast }: Props) {
  const [tab, setTab] = useState<'profile' | 'password'>('profile');

  // Profile fields
  const [name,      setName]      = useState(user.name ?? '');
  const [email,     setEmail]     = useState(user.email ?? '');
  const [phone,     setPhone]     = useState(user.phone ?? '');
  const [jobTitle,  setJobTitle]  = useState(user.job_title ?? '');
  const [saving,    setSaving]    = useState(false);
  const [profErr,   setProfErr]   = useState('');

  // Password fields
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [pwSaving,  setPwSaving]  = useState(false);
  const [pwErr,     setPwErr]     = useState('');

  const saveProfile = async () => {
    if (!name.trim()) { setProfErr('Name is required.'); return; }
    if (!email.trim()) { setProfErr('Email is required.'); return; }
    setSaving(true); setProfErr('');
    try {
      const { data } = await api.put('/users/me', { name, email, phone, job_title: jobTitle });
      onSaved(data);
      showToast?.({ title: 'Profile updated', sub: data.name });
      onClose();
    } catch (e: any) {
      setProfErr(e?.response?.data?.error || 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 8) { setPwErr('Password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwErr('Passwords do not match.'); return; }
    setPwSaving(true); setPwErr('');
    try {
      await api.put(`/users/${user.id}/password`, { password: newPw });
      showToast?.({ title: 'Password changed' });
      setNewPw(''); setConfirmPw('');
      onClose();
    } catch (e: any) {
      setPwErr(e?.response?.data?.error || 'Failed to change password. Try again.');
    } finally {
      setPwSaving(false);
    }
  };

  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 440 }}>
        {/* Header */}
        <div className="modal-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ width: 40, height: 40, fontSize: 15, borderRadius: 11, flexShrink: 0 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.3px' }}>{user.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 1, textTransform: 'capitalize' }}>{user.role.replace(/_/g, ' ')}</div>
            </div>
          </div>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 2, padding: '10px 16px 0', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {([['profile', 'Profile'], ['password', 'Change Password']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 14px',
              border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0',
              background: tab === id ? 'var(--surface2)' : 'transparent',
              color: tab === id ? 'var(--text)' : 'var(--text3)',
              borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
            }}>{label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'profile' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Name *</label>
                  <input style={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder="Your name"/>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Email *</label>
                  <input style={INPUT} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Phone</label>
                  <input style={INPUT} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(000) 000-0000"/>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Job Title</label>
                  <input style={INPUT} value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Estimator"/>
                </div>
              </div>
              {profErr && (
                <div style={{ background: 'rgba(224,106,106,.12)', color: 'var(--red)', borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 600 }}>{profErr}</div>
              )}
            </>
          ) : (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>New Password</label>
                <div style={{ position: 'relative' }}>
                  <input style={{ ...INPUT, paddingRight: 40 }} type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters"/>
                  <button onClick={() => setShowPw(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0 }}>
                    <Icon name={showPw ? 'eye' : 'eye'} size={15} stroke={1.8}/>
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Confirm Password</label>
                <input style={INPUT} type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Repeat new password"/>
              </div>
              {newPw.length > 0 && (
                <div style={{ fontSize: 12, color: newPw.length >= 8 ? 'var(--green)' : 'var(--text3)', fontWeight: 600 }}>
                  {newPw.length >= 8 ? '✓ Length OK' : `${8 - newPw.length} more characters needed`}
                </div>
              )}
              {pwErr && (
                <div style={{ background: 'rgba(224,106,106,.12)', color: 'var(--red)', borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 600 }}>{pwErr}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {tab === 'profile' ? (
            <button className="btn" onClick={saveProfile} disabled={saving}>
              <Icon name="check" size={14} stroke={2.2}/>{saving ? 'Saving…' : 'Save Profile'}
            </button>
          ) : (
            <button className="btn" onClick={savePassword} disabled={pwSaving || newPw.length < 8 || newPw !== confirmPw}>
              <Icon name="check" size={14} stroke={2.2}/>{pwSaving ? 'Saving…' : 'Change Password'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
