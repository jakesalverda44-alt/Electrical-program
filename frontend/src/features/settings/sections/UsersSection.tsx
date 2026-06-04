import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

export function UsersSection() {
  const [users,    setUsers]    = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [adding,   setAdding]   = useState(false);
  const [loading,  setLoading]  = useState(true);

  const load = () => {
    api.get('/users').then(r => { setUsers(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const active   = users.filter(u => u.status !== 'inactive');
  const inactive = users.filter(u => u.status === 'inactive');

  return (
    <div>
      <SectionTitle title="Users" sub="Manage team members, roles, and account access."/>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{active.length} active · {inactive.length} inactive</div>
        <button onClick={() => setAdding(true)}
          style={{ padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + Add User
        </button>
      </div>

      {loading ? <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div> : (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <table className="ctable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Job Title</th>
                <th>Status</th>
                <th>Last Login</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ opacity: u.status === 'inactive' ? .5 : 1 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="avatar" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>{initials(u.name)}</span>
                      <div>
                        <div className="nm">{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><RolePill role={u.role}/></td>
                  <td className="sub">{u.job_title || '—'}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                      background: u.status === 'inactive' ? 'var(--surface2)' : 'var(--green-soft)',
                      color: u.status === 'inactive' ? 'var(--text3)' : 'var(--green)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {u.status ?? 'active'}
                    </span>
                  </td>
                  <td className="sub">{timeAgo(u.last_login)}</td>
                  <td>
                    <button onClick={() => setSelected(u)}
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <UserModal mode="add" onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }}/>}
      {selected && <UserModal mode="edit" user={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }}/>}
    </div>
  );
}

function UserModal({ mode, user, onClose, onSaved }: { mode: 'add' | 'edit'; user?: User; onClose: () => void; onSaved: () => void }) {
  const [name,      setName]      = useState(user?.name ?? '');
  const [email,     setEmail]     = useState(user?.email ?? '');
  const [phone,     setPhone]     = useState(user?.phone ?? '');
  const [jobTitle,  setJobTitle]  = useState(user?.job_title ?? '');
  const [role,      setRole]      = useState(user?.role ?? 'salesperson');
  const [password,  setPassword]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [tempPw,    setTempPw]    = useState('');

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      if (mode === 'add') {
        if (!password) { setError('Password is required'); setSaving(false); return; }
        await api.post('/users', { name, email, phone, job_title: jobTitle, role, password });
        onSaved();
      } else {
        await api.put(`/users/${user!.id}`, { name, email, phone, job_title: jobTitle, role });
        if (password) await api.put(`/users/${user!.id}/password`, { password });
        onSaved();
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const deactivate = async () => {
    if (!user) return;
    await api.put(`/users/${user.id}`, { status: user.status === 'inactive' ? 'active' : 'inactive' });
    onSaved();
  };

  const genTempPw = () => {
    const pw = Math.random().toString(36).slice(-8) + 'A1!';
    setPassword(pw);
    setTempPw(pw);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: 500, boxShadow: '0 8px 40px rgba(0,0,0,.25)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{mode === 'add' ? 'Add User' : 'Edit User'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600 }}>{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Field label="Name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)}/></Field>
            <Field label="Email"><input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)}/></Field>
            <Field label="Phone"><input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555"/></Field>
            <Field label="Job Title"><input style={inputStyle} value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Sales Representative"/></Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Role">
                <select value={role} onChange={e => setRole(e.target.value as any)}
                  style={{ ...inputStyle, appearance: 'none' }}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
              {mode === 'add' ? 'Set Password' : 'Reset Password (leave blank to keep current)'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input type="text" style={{ ...inputStyle, flex: 1 }} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'edit' ? 'New password…' : 'Temp password…'}/>
              <button onClick={genTempPw} style={{ padding: '9px 14px', border: '1px solid var(--border2)', background: 'var(--surface2)', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                Generate
              </button>
            </div>
            {tempPw && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>Generated: {tempPw} — copy this before saving</div>}
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          {mode === 'edit' && user && (
            <button onClick={deactivate}
              style={{ padding: '9px 16px', border: '1px solid var(--border2)', background: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: user.status === 'inactive' ? 'var(--green)' : '#DC2626' }}>
              {user.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button onClick={onClose} style={{ padding: '9px 20px', border: '1px solid var(--border2)', background: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ padding: '9px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PROPOSAL DEFAULTS ─────────────────────────────────────────────────────────

