import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import Icon from '../../components/Icon';
import { User } from '../../types';
import { AppSettings } from '../../hooks/useAppSettings';

interface Props {
  settings: AppSettings;
  onSettingsSaved: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(ts?: string) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return m <= 1 ? 'Just now' : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

const ROLE_OPTIONS = [
  'owner','administrator','sales_manager','salesperson',
  'estimator','project_manager','technician','accounting','read_only',
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', administrator: 'Administrator', sales_manager: 'Sales Manager',
  salesperson: 'Sales Rep', estimator: 'Estimator', project_manager: 'Project Manager',
  technician: 'Technician', accounting: 'Accounting', read_only: 'Read Only',
};

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  owner:           { bg: '#FEF3C7', color: '#92400E' },
  administrator:   { bg: '#EDE9FE', color: '#5B21B6' },
  sales_manager:   { bg: '#DBEAFE', color: '#1E40AF' },
  salesperson:     { bg: '#D1FAE5', color: '#065F46' },
  estimator:       { bg: '#E0F2FE', color: '#075985' },
  project_manager: { bg: '#FCE7F3', color: '#9D174D' },
  technician:      { bg: '#FEE2E2', color: '#991B1B' },
  accounting:      { bg: '#F3F4F6', color: '#374151' },
  read_only:       { bg: '#F9FAFB', color: '#6B7280' },
};

function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] ?? ROLE_COLORS.read_only;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
      background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '9px 12px', outline: 'none',
};

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: desc ? 2 : 6 }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, lineHeight: 1.5 }}>{desc}</div>}
      {children}
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SaveBar({ onSave, saving, saved, hasChanges }: { onSave: () => void; saving: boolean; saved: boolean; hasChanges: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
      <button onClick={onSave} disabled={saving || !hasChanges}
        style={{ padding: '10px 28px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9,
          fontWeight: 700, fontSize: 14, cursor: saving || !hasChanges ? 'not-allowed' : 'pointer', opacity: !hasChanges ? .5 : 1 }}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {saved && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
    </div>
  );
}

// ── Nav structure ─────────────────────────────────────────────────────────────

type SectionId = 'company' | 'proposal-defaults' | 'gen-pricing' | 'users' | 'email' | 'ai' | 'ai-permissions' | 'integrations' | 'notifications' | 'security';

const NAV: { group: string; items: { id: SectionId; label: string; icon: string }[] }[] = [
  { group: 'Organization', items: [
    { id: 'company',          label: 'Company Profile', icon: 'building' },
    { id: 'users',            label: 'Users',           icon: 'users'    },
  ]},
  { group: 'Proposals', items: [
    { id: 'proposal-defaults', label: 'Defaults',       icon: 'doc'      },
    { id: 'gen-pricing',       label: 'Gen Pricing',    icon: 'zap'      },
  ]},
  { group: 'Integrations', items: [
    { id: 'email',            label: 'Email Delivery',  icon: 'send'     },
    { id: 'ai',               label: 'AI',              icon: 'cpu'      },
    { id: 'ai-permissions',   label: 'AI Permissions',  icon: 'shield'   },
    { id: 'integrations',     label: 'Integrations',    icon: 'link'     },
  ]},
  { group: 'System', items: [
    { id: 'notifications',    label: 'Notifications',   icon: 'bell'     },
    { id: 'security',         label: 'Security',        icon: 'shield'   },
  ]},
];

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsPage({ settings, onSettingsSaved }: Props) {
  const [active, setActive] = useState<SectionId>('company');
  const [search, setSearch] = useState('');

  const allItems = NAV.flatMap(g => g.items);
  const filtered = search
    ? allItems.filter(i => i.label.toLowerCase().includes(search.toLowerCase()))
    : null;

  return (
    <div className="scroll view-enter" style={{ height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh', maxHeight: '100vh', overflow: 'hidden' }}>

        {/* ── Left sidebar ── */}
        <div style={{ background: 'var(--surface2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ padding: '20px 16px 12px' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)', marginBottom: 12 }}>Settings</div>
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={13} stroke={1.9} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ ...inputStyle, paddingLeft: 28, fontSize: 12, padding: '7px 10px 7px 28px' }}/>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '0 8px 20px' }}>
            {(filtered ? [{ group: 'Results', items: filtered }] : NAV).map(g => (
              <div key={g.group} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em', padding: '6px 8px 3px' }}>{g.group}</div>
                {g.items.map(item => (
                  <button key={item.id} onClick={() => { setActive(item.id); setSearch(''); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: 'none',
                      borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: active === item.id ? 700 : 500,
                      background: active === item.id ? 'var(--accent)' : 'transparent',
                      color: active === item.id ? '#fff' : 'var(--text2)', textAlign: 'left' }}>
                    <Icon name={item.icon} size={15} stroke={active === item.id ? 2 : 1.7}/>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* ── Right content ── */}
        <div style={{ overflow: 'auto', padding: '28px 32px 60px' }}>
          {active === 'company'           && <CompanySection     settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'users'             && <UsersSection/>}
          {active === 'proposal-defaults' && <ProposalDefaultsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'gen-pricing'       && <GenPricingSection  settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'email'             && <EmailSection       settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'ai'                && <AISection          settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'ai-permissions'    && <AIPermissionsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'integrations'      && <IntegrationsSection/>}
          {active === 'notifications'     && <NotificationsSection settings={settings} onSaved={onSettingsSaved}/>}
          {active === 'security'          && <SecuritySection    settings={settings} onSaved={onSettingsSaved}/>}
        </div>
      </div>
    </div>
  );
}

// ── COMPANY PROFILE ───────────────────────────────────────────────────────────

function CompanySection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['company_name','company_address','company_city','company_state','company_zip',
                 'company_phone','company_email','company_website',
                 'company_license_ec','company_license_cfc','company_license_li'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', vals);
      setOrig(vals);
      onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  return (
    <div>
      <SectionTitle title="Company Profile" sub="This information appears on generator proposals and system emails."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Company Name"><input style={inputStyle} value={vals.company_name} onChange={set('company_name')}/></Field>
        </div>
        <Field label="Address"><input style={inputStyle} value={vals.company_address} onChange={set('company_address')} placeholder="123 Main St"/></Field>
        <Field label="City"><input style={inputStyle} value={vals.company_city} onChange={set('company_city')}/></Field>
        <Field label="State"><input style={inputStyle} value={vals.company_state} onChange={set('company_state')} placeholder="FL"/></Field>
        <Field label="ZIP"><input style={inputStyle} value={vals.company_zip} onChange={set('company_zip')}/></Field>
        <Field label="Phone"><input style={inputStyle} value={vals.company_phone} onChange={set('company_phone')} placeholder="(555) 555-5555"/></Field>
        <Field label="Email"><input style={inputStyle} type="email" value={vals.company_email} onChange={set('company_email')}/></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Website"><input style={inputStyle} value={vals.company_website} onChange={set('company_website')} placeholder="https://accuratepowerandtechnology.com"/></Field>
        </div>
      </div>
      <div style={{ marginTop: 8, marginBottom: 4, fontSize: 13, fontWeight: 700, color: 'var(--text3)' }}>License Numbers</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Field label="Electrical (EC)"><input style={inputStyle} value={vals.company_license_ec} onChange={set('company_license_ec')}/></Field>
        <Field label="Mechanical (CFC)"><input style={inputStyle} value={vals.company_license_cfc} onChange={set('company_license_cfc')}/></Field>
        <Field label="LI"><input style={inputStyle} value={vals.company_license_li} onChange={set('company_license_li')}/></Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── USERS ─────────────────────────────────────────────────────────────────────

function UsersSection() {
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

function ProposalDefaultsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['gen_default_labor','gen_default_permit','gen_default_startup','gen_default_tax_rate',
                 'gen_default_pad','gen_default_smm','gen_default_surge_pro','gen_default_battery',
                 'gen_default_extra_wire','gen_default_lull','gen_default_crane'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const fields: [string, string, string][] = [
    ['gen_default_labor',     'Labor & Installation',     '$'],
    ['gen_default_permit',    'Permit Fee',               '$'],
    ['gen_default_startup',   'Startup & Commissioning',  '$'],
    ['gen_default_tax_rate',  'Tax Rate',                 '%'],
    ['gen_default_pad',       'Concrete Pad',             '$'],
    ['gen_default_smm',       'SMM (Preventative Maint.)', '$'],
    ['gen_default_surge_pro', 'Surge Protector Pro',      '$'],
    ['gen_default_battery',   'Battery Maintainer',       '$'],
    ['gen_default_extra_wire','Extra Wire (per ft)',       '$'],
    ['gen_default_lull',      'Lull',                     '$'],
    ['gen_default_crane',     'Crane',                    '$'],
  ];

  return (
    <div>
      <SectionTitle title="Proposal Defaults" sub="Default values pre-filled when creating a new generator proposal. These can still be overridden per-proposal."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        {fields.map(([key, label, unit]) => (
          <Field key={key} label={`${label} (${unit})`}>
            <input type="number" style={inputStyle} value={vals[key]} onChange={set(key)}/>
          </Field>
        ))}
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── GEN PRICING ───────────────────────────────────────────────────────────────

interface PricingTable {
  'air-cooled': Record<string, Record<string, number>>;
  'liquid-cooled': Record<string, Record<string, number>>;
}

const DEFAULT_PRICING: PricingTable = {
  'air-cooled': {
    Kohler:  { '14KW': 5800, '20KW': 6700, '26KW': 8200 },
    Generac: { '14KW': 5600, '18KW': 6450, '22KW': 7150, '24KW': 7575, '26KW': 8000, '28KW': 9300 },
  },
  'liquid-cooled': {
    Kohler:  { '24KW': 17549, '30KW': 19999, '38KW': 22449, '48KW': 25209, '60KW': 27759, '80KW': 34089, '100KW': 41129 },
    Generac: { '32KW': 19203, '40KW': 21734, '48KW': 22914, '60KW': 25212 },
  },
};

function GenPricingSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [table, setTable] = useState<PricingTable>(() => {
    try { return settings.gen_pricing_table ? JSON.parse(settings.gen_pricing_table) : DEFAULT_PRICING; }
    catch { return DEFAULT_PRICING; }
  });
  const [orig, setOrig] = useState(JSON.stringify(table));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    try {
      const parsed = settings.gen_pricing_table ? JSON.parse(settings.gen_pricing_table) : DEFAULT_PRICING;
      setTable(parsed); setOrig(JSON.stringify(parsed));
    } catch { /* keep current */ }
  }, [settings]);

  const hasChanges = JSON.stringify(table) !== orig;

  const setPrice = (cooling: keyof PricingTable, brand: string, size: string, val: string) => {
    setTable(prev => ({
      ...prev,
      [cooling]: { ...prev[cooling], [brand]: { ...prev[cooling][brand], [size]: Number(val) || 0 } },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { gen_pricing_table: JSON.stringify(table) });
      setOrig(JSON.stringify(table)); onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Generator Pricing" sub="Unit prices for each generator model. These drive proposal totals in the builder."/>
      {(['air-cooled', 'liquid-cooled'] as const).map(cooling => (
        <div key={cooling} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 12, textTransform: 'capitalize' }}>
            {cooling === 'air-cooled' ? '🌬️' : '💧'} {cooling.replace('-', ' ')}
          </div>
          {Object.entries(table[cooling]).map(([brand, sizes]) => (
            <div key={brand} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{brand}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {Object.entries(sizes).map(([size, price]) => (
                  <div key={size}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>{size}</div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: 'var(--text3)' }}>$</span>
                      <input type="number" value={price}
                        onChange={e => setPrice(cooling, brand, size, e.target.value)}
                        style={{ ...inputStyle, paddingLeft: 22, width: '100%' }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────

function EmailSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['email_resend_api_key','email_from_address','email_from_name','email_reply_to','frontend_url'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [testTo,  setTestTo]  = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle'|'ok'|'error'>('idle');

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const testSend = async () => {
    setTesting(true); setTestResult('idle');
    try { await api.post('/settings/test-email', { to: testTo }); setTestResult('ok'); }
    catch { setTestResult('error'); }
    finally { setTesting(false); }
  };

  return (
    <div>
      <SectionTitle title="Email Delivery" sub="Configure how generator proposals are sent to customers."/>
      <Field label="Resend API Key" desc="Get a free key at resend.com. Required for sending proposals.">
        <input type="password" style={inputStyle} value={vals.email_resend_api_key} onChange={set('email_resend_api_key')} placeholder="re_••••••••••••"/>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <Field label="From Address" desc="Must be verified in Resend.">
          <input type="email" style={inputStyle} value={vals.email_from_address} onChange={set('email_from_address')} placeholder="proposals@yourcompany.com"/>
        </Field>
        <Field label="From Name">
          <input style={inputStyle} value={vals.email_from_name} onChange={set('email_from_name')} placeholder="Accurate Power & Technology"/>
        </Field>
        <Field label="Reply-To Address" desc="Where customer replies land.">
          <input type="email" style={inputStyle} value={vals.email_reply_to} onChange={set('email_reply_to')} placeholder="you@yourcompany.com"/>
        </Field>
        <Field label="App URL" desc="Your Render deployment URL — used in proposal signing links.">
          <input type="url" style={inputStyle} value={vals.frontend_url} onChange={set('frontend_url')} placeholder="https://your-app.onrender.com"/>
        </Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Test Email</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>Send a test to verify your configuration.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="email" style={{ ...inputStyle, flex: 1 }} value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="your@email.com"/>
          <button onClick={testSend} disabled={testing || !testTo}
            style={{ padding: '9px 20px', background: 'var(--navy, #1B3A6B)', color: '#fff', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {testing ? 'Sending…' : 'Send Test'}
          </button>
        </div>
        {testResult === 'ok'    && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', fontWeight: 700 }}>✓ Test email delivered — check your inbox.</div>}
        {testResult === 'error' && <div style={{ marginTop: 8, fontSize: 13, color: '#DC2626', fontWeight: 700 }}>✗ Delivery failed — check your API key and from address.</div>}
      </div>

      <div style={{ marginTop: 24, background: 'var(--blue-soft)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--blue)', marginBottom: 8 }}>First-time setup</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text2)', lineHeight: 2 }}>
          <li>Create a free account at <strong>resend.com</strong></li>
          <li>Go to <strong>Domains → Add Domain</strong> and add <strong>accuratepowerandtechnology.com</strong></li>
          <li>Add the SPF + DKIM records Resend provides to your domain registrar (~10 min to verify)</li>
          <li>Go to <strong>API Keys → Create API Key</strong> and paste it above</li>
          <li>Set your App URL to your Render deployment URL</li>
          <li>Save and send a test email</li>
        </ol>
      </div>
    </div>
  );
}

// ── AI ────────────────────────────────────────────────────────────────────────

function AISection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['ai_anthropic_key','ai_model','ai_max_tokens','ai_temperature'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as any)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const MODELS = [
    'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
  ];

  return (
    <div>
      <SectionTitle title="AI Configuration" sub="Settings for the Anthropic Claude AI used in plan analysis and proposal generation."/>

      <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#92400E', lineHeight: 1.6 }}>
        <strong>⚠️ Security Note:</strong> Do not add your Anthropic API key until you are in the final testing phase. The system operates without it — AI features will return a graceful "unavailable" response until the key is set.
      </div>

      <Field label="Anthropic API Key" desc="Your key from console.anthropic.com. Leave blank until ready for testing.">
        <input type="password" style={inputStyle} value={vals.ai_anthropic_key} onChange={set('ai_anthropic_key')} placeholder="sk-ant-••••••••••"/>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Field label="Model">
          <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_model} onChange={set('ai_model')}>
            {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Max Tokens">
          <input type="number" style={inputStyle} value={vals.ai_max_tokens} onChange={set('ai_max_tokens')} min={256} max={8192}/>
        </Field>
        <Field label="Temperature (0–1)">
          <input type="number" style={inputStyle} value={vals.ai_temperature} onChange={set('ai_temperature')} min={0} max={1} step={0.1}/>
        </Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── INTEGRATIONS ──────────────────────────────────────────────────────────────

const INTEGRATIONS = [
  { name: 'Google Calendar',    icon: '📅', desc: 'Sync appointments and job schedules.',           status: 'coming-soon' },
  { name: 'Microsoft Outlook',  icon: '📧', desc: 'Sync emails and calendar events.',              status: 'coming-soon' },
  { name: 'QuickBooks',         icon: '📊', desc: 'Sync invoices and payments.',                   status: 'coming-soon' },
  { name: 'Stripe',             icon: '💳', desc: 'Accept online payments for proposals.',         status: 'coming-soon' },
  { name: 'Twilio',             icon: '💬', desc: 'Send SMS notifications and reminders.',         status: 'coming-soon' },
  { name: 'DocuSign',           icon: '✍️',  desc: 'Legally certified e-signatures.',              status: 'coming-soon' },
  { name: 'CompanyCam',         icon: '📷', desc: 'Sync job site photos automatically.',           status: 'coming-soon' },
  { name: 'Google Drive',       icon: '☁️',  desc: 'Store and share project documents.',           status: 'coming-soon' },
];

function IntegrationsSection() {
  return (
    <div>
      <SectionTitle title="Integrations" sub="Connect third-party services to extend your workflow."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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

const NOTIF_EVENTS = [
  { key: 'proposal_sent',     label: 'Proposal Sent',     desc: 'When you send a generator proposal to a customer.' },
  { key: 'proposal_viewed',   label: 'Proposal Viewed',   desc: 'When a customer opens their proposal link.' },
  { key: 'proposal_signed',   label: 'Proposal Signed',   desc: 'When a customer accepts and signs.' },
  { key: 'job_won',           label: 'Job Won',           desc: 'When a bid or proposal is marked as awarded.' },
  { key: 'job_lost',          label: 'Job Lost / Declined', desc: 'When a proposal is declined.' },
];

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', transition: 'background .2s',
        background: on ? 'var(--blue)' : 'var(--border2)', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 18, height: 18,
        borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
    </button>
  );
}

interface ReminderTypePref { app: boolean; email: boolean; days?: number }
interface ReminderPrefs { recipients: string[]; types: Record<string, ReminderTypePref> }

const REMINDER_DEFAULTS: ReminderPrefs = {
  recipients: [],
  types: {
    followup_due:             { app: true, email: true },
    proposal_viewed_unsigned: { app: true, email: true, days: 3 },
    bid_due_soon:             { app: true, email: false, days: 3 },
  },
};

const REMINDER_TYPES: { key: string; label: string; desc: string; hasDays: boolean }[] = [
  { key: 'followup_due',             label: 'Follow-up due',            desc: 'When a follow-up task reaches its due date.', hasDays: false },
  { key: 'proposal_viewed_unsigned', label: 'Proposal viewed, not signed', desc: 'When a customer opens a proposal but hasn’t signed after N days.', hasDays: true },
  { key: 'bid_due_soon',             label: 'Bid due soon',             desc: 'When a bid is within N days of its due date.', hasDays: true },
];

function parseReminders(raw: string): ReminderPrefs {
  try {
    const r = (JSON.parse(raw || '{}').reminders ?? {}) as Partial<ReminderPrefs>;
    return {
      recipients: Array.isArray(r.recipients) ? r.recipients : [],
      types: {
        followup_due:             { ...REMINDER_DEFAULTS.types.followup_due, ...(r.types?.followup_due ?? {}) },
        proposal_viewed_unsigned: { ...REMINDER_DEFAULTS.types.proposal_viewed_unsigned, ...(r.types?.proposal_viewed_unsigned ?? {}) },
        bid_due_soon:             { ...REMINDER_DEFAULTS.types.bid_due_soon, ...(r.types?.bid_due_soon ?? {}) },
      },
    };
  } catch { return REMINDER_DEFAULTS; }
}

function NotificationsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  // Flat event booleans (proposal_sent, etc.) live at the top level; reminder config lives under `reminders`.
  const parsePrefs = (): Record<string, boolean> => {
    try { const o = JSON.parse(settings.notifications_json || '{}'); delete o.reminders; return o; } catch { return {}; }
  };
  const parseEmails = (): string[] => {
    try { return JSON.parse(settings.bid_notify_emails || '[]'); } catch { return []; }
  };

  const [prefs,   setPrefs]   = useState<Record<string, boolean>>(parsePrefs);
  const [reminders, setReminders] = useState<ReminderPrefs>(() => parseReminders(settings.notifications_json));
  const [bidOn,   setBidOn]   = useState(settings.bid_notify_enabled !== 'false');
  const [emails,  setEmails]  = useState<string[]>(parseEmails);
  const [emailIn, setEmailIn] = useState('');
  const [remIn,   setRemIn]   = useState('');
  const [orig,    setOrig]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const snapshot = (p: Record<string, boolean>, r: ReminderPrefs, b: boolean, e: string[]) =>
    JSON.stringify({ p, r, b, e });

  useEffect(() => {
    const p = parsePrefs(); const r = parseReminders(settings.notifications_json);
    const b = settings.bid_notify_enabled !== 'false'; const e = parseEmails();
    setPrefs(p); setReminders(r); setBidOn(b); setEmails(e);
    setOrig(snapshot(p, r, b, e));
  }, [settings]);

  const hasChanges = snapshot(prefs, reminders, bidOn, emails) !== orig;
  const toggle     = (k: string) => setPrefs(p => ({ ...p, [k]: !p[k] }));

  const setRem = (key: string, patch: Partial<ReminderTypePref>) =>
    setReminders(r => ({ ...r, types: { ...r.types, [key]: { ...r.types[key], ...patch } } }));

  const addEmail = () => {
    const v = emailIn.trim().toLowerCase();
    if (!v || emails.includes(v)) return;
    setEmails(prev => [...prev, v]);
    setEmailIn('');
  };

  const addRem = () => {
    const v = remIn.trim().toLowerCase();
    if (!v || reminders.recipients.includes(v)) return;
    setReminders(r => ({ ...r, recipients: [...r.recipients, v] }));
    setRemIn('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        notifications_json:  JSON.stringify({ ...prefs, reminders }),
        bid_notify_enabled:  bidOn ? 'true' : 'false',
        bid_notify_emails:   JSON.stringify(emails),
      });
      setOrig(snapshot(prefs, reminders, bidOn, emails)); onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Notifications" sub="Choose which events and reminders are sent, and how."/>

      {/* New bid email team */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>New Bid Notification</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Email the team list below whenever a new electrical bid is added to the pipeline.</div>
          </div>
          <Toggle on={bidOn} onToggle={() => setBidOn(o => !o)}/>
        </div>

        {/* Email chip list */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            type="email"
            value={emailIn}
            onChange={e => setEmailIn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmail())}
            placeholder="estimator@accuratepower.com"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border2)',
              background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
          />
          <button className="btn ghost" onClick={addEmail} style={{ height: 38, padding: '0 16px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {emails.map(em => (
            <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600,
              background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid rgba(77,141,247,.25)',
              borderRadius: 20, padding: '4px 10px 4px 12px' }}>
              {em}
              <button onClick={() => setEmails(prev => prev.filter(x => x !== em))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
            </span>
          ))}
          {emails.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>No recipients added yet.</span>}
        </div>
      </div>

      {/* Proposal/job event toggles */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Proposal &amp; Job Events</div>
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '4px 0', marginBottom: 20 }}>
        {NOTIF_EVENTS.map((ev, i) => (
          <div key={ev.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: i < NOTIF_EVENTS.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{ev.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{ev.desc}</div>
            </div>
            <Toggle on={!!prefs[ev.key]} onToggle={() => toggle(ev.key)}/>
          </div>
        ))}
      </div>
      {/* Follow-up reminders — per type, choose App and/or Email */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Follow-up Reminders</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Choose how each reminder is delivered. App shows in the bell; Email sends to the recipients below.</div>
      <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '4px 0', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 92px', gap: 8, padding: '8px 18px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Reminder</span><span style={{ textAlign: 'center' }}>App</span><span style={{ textAlign: 'center' }}>Email</span><span style={{ textAlign: 'center' }}>Days</span>
        </div>
        {REMINDER_TYPES.map((rt, i) => {
          const cfg = reminders.types[rt.key];
          return (
            <div key={rt.key} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 64px 92px', gap: 8, alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{rt.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{rt.desc}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={cfg.app} onToggle={() => setRem(rt.key, { app: !cfg.app })}/></div>
              <div style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={cfg.email} onToggle={() => setRem(rt.key, { email: !cfg.email })}/></div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {rt.hasDays ? (
                  <input type="number" min={0} max={60} value={cfg.days ?? 3}
                    onChange={e => setRem(rt.key, { days: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={{ width: 60, ...inputStyle, textAlign: 'center', padding: '6px 8px' }}/>
                ) : <span style={{ fontSize: 12, color: 'var(--text3)' }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reminder email recipients */}
      <Field label="Reminder Email Recipients" desc="Who receives reminder emails. Leave empty to send to owners/administrators only.">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input type="email" value={remIn} onChange={e => setRemIn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRem())}
            placeholder="you@accuratepower.com"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }}/>
          <button className="btn ghost" onClick={addRem} style={{ height: 38, padding: '0 16px' }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {reminders.recipients.map(em => (
            <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: 'var(--blue-soft)', color: 'var(--blue)', border: '1px solid rgba(77,141,247,.25)', borderRadius: 20, padding: '4px 10px 4px 12px' }}>
              {em}
              <button onClick={() => setReminders(r => ({ ...r, recipients: r.recipients.filter(x => x !== em) }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 15, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
            </span>
          ))}
          {reminders.recipients.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Owners &amp; administrators (default).</span>}
        </div>
      </Field>

      <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#92400E', margin: '20px 0' }}>
        Email delivery requires email settings to be configured under <strong>Integrations → Email Delivery</strong>.
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── AI PERMISSIONS ────────────────────────────────────────────────────────────

const AI_PERM_COLS: { key: string; label: string; desc: string }[] = [
  { key: 'run_analysis',    label: 'Run Analysis',    desc: 'Trigger the AI plan analysis pipeline' },
  { key: 'view_results',   label: 'View Results',    desc: 'Read analysis output and reports' },
  { key: 'manage_settings',label: 'Manage Settings', desc: 'Edit AI keys, model, temperature' },
];

const DEFAULT_ROLE_MATRIX: Record<string, Record<string, boolean>> = {
  owner:           { run_analysis: true,  manage_settings: true,  view_results: true  },
  administrator:   { run_analysis: true,  manage_settings: true,  view_results: true  },
  estimator:       { run_analysis: true,  manage_settings: false, view_results: true  },
  sales_manager:   { run_analysis: false, manage_settings: false, view_results: true  },
  salesperson:     { run_analysis: false, manage_settings: false, view_results: false },
  project_manager: { run_analysis: false, manage_settings: false, view_results: true  },
  technician:      { run_analysis: false, manage_settings: false, view_results: false },
  accounting:      { run_analysis: false, manage_settings: false, view_results: false },
  read_only:       { run_analysis: false, manage_settings: false, view_results: false },
};

interface AIUsageRow { id: string; name: string; role: string; count: number }

function AIPermissionsSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const parseMatrix = (): Record<string, Record<string, boolean>> => {
    try {
      const stored = settings.ai_role_permissions ? JSON.parse(settings.ai_role_permissions) : {};
      return { ...DEFAULT_ROLE_MATRIX, ...stored };
    } catch { return { ...DEFAULT_ROLE_MATRIX }; }
  };

  const [matrix,    setMatrix]   = useState<Record<string, Record<string, boolean>>>(parseMatrix);
  const [origMatrix, setOrigMatrix] = useState(JSON.stringify(parseMatrix()));
  const [aiEnabled, setAiEnabled] = useState(settings.ai_enabled !== 'false');
  const [analysisEnabled, setAnalysisEnabled] = useState(settings.ai_analysis_enabled !== 'false');
  const [dailyLimit, setDailyLimit] = useState(settings.ai_daily_limit_per_user || '10');
  const [origEnabled, setOrigEnabled] = useState(settings.ai_enabled !== 'false');
  const [origAnalysis, setOrigAnalysis] = useState(settings.ai_analysis_enabled !== 'false');
  const [origLimit, setOrigLimit] = useState(settings.ai_daily_limit_per_user || '10');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [users,  setUsers]  = useState<User[]>([]);
  const [usage,  setUsage]  = useState<AIUsageRow[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean> | null>>({});
  const [overrideSaving, setOverrideSaving] = useState<string | null>(null);

  useEffect(() => {
    const m = parseMatrix();
    setMatrix(m); setOrigMatrix(JSON.stringify(m));
    const en = settings.ai_enabled !== 'false';
    const an = settings.ai_analysis_enabled !== 'false';
    const lim = settings.ai_daily_limit_per_user || '10';
    setAiEnabled(en); setOrigEnabled(en);
    setAnalysisEnabled(an); setOrigAnalysis(an);
    setDailyLimit(lim); setOrigLimit(lim);
  }, [settings]);

  useEffect(() => {
    api.get('/users').then(r => {
      const active = (r.data as User[]).filter(u => u.status !== 'inactive');
      setUsers(active);
      const ov: Record<string, Record<string, boolean> | null> = {};
      active.forEach(u => { ov[u.id] = (u as any).ai_override ?? null; });
      setOverrides(ov);
    }).catch(() => {});
    api.get('/ai/usage/today').then(r => setUsage(r.data)).catch(() => {});
  }, []);

  const toggleMatrix = (role: string, perm: string) => {
    setMatrix(prev => ({ ...prev, [role]: { ...prev[role], [perm]: !prev[role]?.[perm] } }));
  };

  const hasChanges = JSON.stringify(matrix) !== origMatrix ||
    aiEnabled !== origEnabled || analysisEnabled !== origAnalysis || dailyLimit !== origLimit;

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ai_enabled: aiEnabled ? 'true' : 'false',
        ai_analysis_enabled: analysisEnabled ? 'true' : 'false',
        ai_daily_limit_per_user: dailyLimit,
        ai_role_permissions: JSON.stringify(matrix),
      });
      setOrigMatrix(JSON.stringify(matrix));
      setOrigEnabled(aiEnabled); setOrigAnalysis(analysisEnabled); setOrigLimit(dailyLimit);
      onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const setUserOverride = async (userId: string, key: string, value: boolean | null) => {
    const current = overrides[userId] ?? {};
    const next = value === null ? { ...current } : { ...current, [key]: value };
    if (value === null) delete next[key];
    const payload = Object.keys(next).length === 0 ? null : next;
    setOverrideSaving(userId + key);
    try {
      await api.put(`/users/${userId}/ai-override`, payload);
      setOverrides(prev => ({ ...prev, [userId]: payload }));
    } finally { setOverrideSaving(null); }
  };

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div>
      <SectionTitle title="AI Permissions" sub="Control who can use AI features, set limits, and manage emergency kill switches."/>

      {/* Kill Switches */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Emergency Controls
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              label: 'AI Features Master Switch',
              desc: 'Instantly disables ALL AI features for every user. Takes effect on the next request.',
              value: aiEnabled, set: setAiEnabled, danger: !aiEnabled,
            },
            {
              label: 'Plan Analysis',
              desc: 'Disables the preconstruction plan analysis pipeline only. Other AI features unaffected.',
              value: analysisEnabled, set: setAnalysisEnabled, danger: !analysisEnabled,
            },
          ].map(item => (
            <div key={item.label} style={{ border: `1px solid ${item.danger ? '#FCA5A5' : 'var(--border)'}`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: item.danger ? '#FEF2F2' : 'var(--surface)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: item.danger ? '#991B1B' : 'var(--text)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: item.danger ? '#B91C1C' : 'var(--text3)' }}>{item.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: item.value ? 'var(--green)' : '#DC2626', textTransform: 'uppercase' }}>
                  {item.value ? 'ON' : 'OFF'}
                </span>
                <button onClick={() => item.set(!item.value)}
                  style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', transition: 'background .2s',
                    background: item.value ? 'var(--accent)' : '#EF4444', position: 'relative', flexShrink: 0 }}>
                  <span style={{ position: 'absolute', top: 3, left: item.value ? 22 : 3, width: 18, height: 18,
                    borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Limit */}
      <div style={{ marginBottom: 28 }}>
        <Field label="Daily Analysis Limit per User" desc="Maximum number of AI plan analyses a single user can run per calendar day. Set to 0 for unlimited.">
          <input type="number" min={0} max={999} value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
            style={{ ...inputStyle, maxWidth: 140 }}/>
        </Field>
      </div>

      {/* Role Permission Matrix */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Role Permissions
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                {AI_PERM_COLS.map(col => (
                  <th key={col.key} style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_OPTIONS.map((role, i) => (
                <tr key={role} style={{ borderBottom: i < ROLE_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <RolePill role={role}/>
                  </td>
                  {AI_PERM_COLS.map(col => {
                    const checked = matrix[role]?.[col.key] ?? false;
                    return (
                      <td key={col.key} style={{ textAlign: 'center', padding: '12px 14px' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMatrix(role, col.key)}
                          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}/>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
          {AI_PERM_COLS.map(col => (
            <span key={col.key} style={{ marginRight: 16 }}>
              <strong>{col.label}:</strong> {col.desc}
            </span>
          ))}
        </div>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>

      {/* Per-User Overrides */}
      {users.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Per-User Overrides
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
            Override individual users beyond their role defaults. Leave unchecked/checked to inherit role settings, or explicitly set here to override.
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>User</th>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                  {AI_PERM_COLS.map(col => (
                    <th key={col.key} style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {col.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Suspended</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const ov = overrides[u.id] ?? null;
                  const isSuspended = ov?.suspended === true;
                  return (
                    <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none', background: isSuspended ? '#FEF2F2' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', opacity: overrideSaving?.startsWith(u.id) ? 0.6 : 1 }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                            {initials(u.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}><RolePill role={u.role}/></td>
                      {AI_PERM_COLS.map(col => {
                        const inherited = matrix[u.role]?.[col.key] ?? false;
                        const ovVal = ov !== null && col.key in (ov ?? {}) ? (ov as any)[col.key] as boolean : null;
                        const effective = ovVal !== null ? ovVal : inherited;
                        const hasOverride = ovVal !== null && ovVal !== inherited;
                        return (
                          <td key={col.key} style={{ textAlign: 'center', padding: '12px 14px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                              <input type="checkbox" checked={effective} disabled={isSuspended}
                                onChange={() => setUserOverride(u.id, col.key, !effective)}
                                style={{ width: 16, height: 16, cursor: isSuspended ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)', opacity: isSuspended ? 0.4 : 1 }}/>
                              {hasOverride && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.03em' }}>override</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                        <button onClick={() => setUserOverride(u.id, 'suspended', isSuspended ? null : true)}
                          style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'background .2s',
                            background: isSuspended ? '#EF4444' : 'var(--border2)', position: 'relative' }}>
                          <span style={{ position: 'absolute', top: 2, left: isSuspended ? 18 : 2, width: 16, height: 16,
                            borderRadius: '50%', background: '#fff', transition: 'left .2s', display: 'block' }}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Usage Today */}
      {usage.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            AI Usage Today — {today}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {usage.filter(r => r.count > 0).length === 0 ? (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No AI analyses run today.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>User</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Role</th>
                    <th style={{ textAlign: 'center', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Analyses</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 700, color: 'var(--text3)', fontSize: 12 }}>Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.filter(r => r.count > 0).map((row, i, arr) => {
                    const pct = Math.min(100, (row.count / (parseInt(dailyLimit) || 10)) * 100);
                    return (
                      <tr key={row.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text)' }}>{row.name}</td>
                        <td style={{ padding: '12px 16px' }}><RolePill role={row.role}/></td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <span style={{ fontWeight: 800, color: pct >= 100 ? '#DC2626' : pct >= 80 ? '#D97706' : 'var(--text)' }}>{row.count}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : 'var(--accent)', borderRadius: 3, transition: 'width .3s' }}/>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{row.count} / {dailyLimit}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SECURITY ──────────────────────────────────────────────────────────────────

function SecuritySection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [timeout, setTimeout_] = useState(settings.security_session_timeout || '480');
  const [orig, setOrig] = useState(settings.security_session_timeout || '480');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => { setTimeout_(settings.security_session_timeout || '480'); setOrig(settings.security_session_timeout || '480'); }, [settings]);

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', { security_session_timeout: timeout }); setOrig(timeout); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Security" sub="Account security settings and access controls."/>

      <Field label="Session Timeout (minutes)" desc="Users are automatically logged out after this many minutes of inactivity.">
        <input type="number" style={{ ...inputStyle, maxWidth: 200 }} value={timeout} onChange={e => setTimeout_(e.target.value)} min={30} max={10080}/>
      </Field>
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={timeout !== orig}/>

      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { title: 'Two-Factor Authentication', desc: 'Require 2FA for all users on login.', badge: 'Coming Soon' },
          { title: 'Password Requirements',     desc: 'Minimum length: 8 characters. Must include a number and uppercase letter.', badge: 'Active' },
          { title: 'Login Restrictions',        desc: 'Limit access to specific IP ranges.', badge: 'Coming Soon' },
        ].map(item => (
          <div key={item.title} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{item.desc}</div>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 5,
              background: item.badge === 'Active' ? 'var(--green-soft)' : 'var(--surface2)',
              color: item.badge === 'Active' ? 'var(--green)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
              {item.badge}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
