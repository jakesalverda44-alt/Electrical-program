import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import CustomerHub from './CustomerHub';
import { Customer, Toast } from '../../types';

type FilterType = Customer['type'] | 'all';

interface Props {
  showToast?: (t: Toast) => void;
}

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
function initials(name: string) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

const TYPE_LABELS: Record<Customer['type'], { label: string; color: string; bg: string }> = {
  gc:       { label: 'General Contractor', color: 'var(--blue)',  bg: 'var(--blue-soft)'  },
  customer: { label: 'Customer',           color: 'var(--amber)', bg: 'var(--amber-soft)' },
  other:    { label: 'Other',              color: 'var(--text2)', bg: 'var(--surface2)'   },
};

function TypePill({ type }: { type: Customer['type'] }) {
  const t = TYPE_LABELS[type];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
      background: t.bg, color: t.color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      {t.label}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9,
  padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};

const EDIT_FIELDS: [keyof Customer, string][] = [
  ['company', 'Company'], ['contact_name', 'Contact Name'], ['phone', 'Phone'],
  ['email', 'Email'], ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['zip', 'Zip'],
];

function AddCustomerForm({ onCreated, onCancel }: { onCreated: (c: Customer) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<Customer>>({ type: 'customer', name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.name?.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/customers', form);
      onCreated(data);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not create customer');
    } finally { setSaving(false); }
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr"><span className="panel-title">New Customer</span></div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>Name *</div>
          <input style={inputStyle} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus/>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>Type</div>
          <select style={inputStyle} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as Customer['type'] }))}>
            <option value="customer">Customer</option>
            <option value="gc">General Contractor</option>
            <option value="other">Other</option>
          </select>
        </div>
        {EDIT_FIELDS.slice(0, 4).map(([k, label]) => (
          <div key={k}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 5 }}>{label}</div>
            <input style={inputStyle} value={String(form[k] ?? '')} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}/>
          </div>
        ))}
      </div>
      {error && <div style={{ padding: '0 16px 8px', color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
        <button className="btn" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function ContactsPage({ showToast }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/customers').then(({ data }) => setCustomers(data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = customers.filter(c => {
    if (filterType !== 'all' && c.type !== filterType) return false;
    const q = query.toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !(c.company || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const totalGCs = customers.filter(c => c.type === 'gc').length;
  const totalCustomers = customers.filter(c => c.type === 'customer').length;

  const handleCreated = (c: Customer) => {
    setCustomers(prev => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
    setAdding(false);
    setSelectedId(c.id);
    showToast?.({ title: 'Customer added', sub: c.name });
  };

  // Selecting a customer opens the full-screen hub; coming back refreshes the list.
  if (selectedId) {
    return <CustomerHub id={selectedId} onBack={() => { setSelectedId(null); load(); }} showToast={showToast}/>;
  }

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'General Contractors', val: String(totalGCs), sub: 'in directory', tone: 'blue' },
            { label: 'Customers', val: String(totalCustomers), sub: 'generator clients', tone: 'amber' },
            { label: 'Total Records', val: String(customers.length), sub: 'all contacts', tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="users" size={16} stroke={1.8}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {adding && <AddCustomerForm onCreated={handleCreated} onCancel={() => setAdding(false)}/>}

        <div>
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                  <Icon name="users" size={15} stroke={1.8}/>
                </span>
                Customers
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 6 }}>· {filtered.length}</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={filterType} onChange={e => setFilterType(e.target.value as FilterType)} className="comm-filter">
                  <option value="all">All Types</option>
                  <option value="gc">GC</option>
                  <option value="customer">Customer</option>
                  <option value="other">Other</option>
                </select>
                <button className="btn" onClick={() => setAdding(true)}>+ Add</button>
              </div>
            </div>

            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 9, padding: '7px 12px' }}>
                <Icon name="search" size={14} stroke={1.9}/>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customers…"
                  style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--text)', outline: 'none', flex: 1 }}/>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No customers match</div>
            ) : (
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="hide-mobile">Company</th>
                    <th style={{ textAlign: 'right' }}>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} onClick={() => setSelectedId(c.id)}
                      style={{ cursor: 'pointer', background: selectedId === c.id ? 'var(--surface2)' : undefined }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="avatar" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>{initials(c.name)}</span>
                          <span className="nm">{c.name}</span>
                        </div>
                      </td>
                      <td><TypePill type={c.type}/></td>
                      <td className="sub hide-mobile">{c.company || '—'}</td>
                      <td className="sub" style={{ textAlign: 'right' }}>
                        {(c.bid_count ?? 0)} bid{(c.bid_count ?? 0) !== 1 ? 's' : ''} · {(c.gen_count ?? 0)} prop
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
