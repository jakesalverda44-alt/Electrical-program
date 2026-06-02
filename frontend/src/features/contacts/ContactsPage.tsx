import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, WonJob } from '../../types';

type ContactType = 'gc' | 'customer' | 'salesperson';

interface Contact {
  id: string;
  name: string;
  type: ContactType;
  company: string;
  phone: string;
  email: string;
  loc: string;
  bids: number;
  gens: number;
  wonValue: number;
}

interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
}

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

function buildContacts(bids: Bid[], gens: Gen[], wonJobs: WonJob[]): Contact[] {
  const map = new Map<string, Contact>();

  // GCs from bids
  bids.forEach(b => {
    if (!b.gc) return;
    const key = 'gc:' + b.gc;
    const existing = map.get(key);
    if (existing) {
      existing.bids++;
    } else {
      map.set(key, {
        id: key, name: b.gc, type: 'gc', company: b.gc,
        phone: '', email: '', loc: b.loc,
        bids: 1, gens: 0,
        wonValue: wonJobs.filter(j => j.proposal_type === 'Electrical').reduce((s, j) => s, 0),
      });
    }
  });

  // Customers from gens
  gens.forEach(g => {
    if (!g.customer) return;
    const key = 'cust:' + g.customer;
    const existing = map.get(key);
    if (existing) {
      existing.gens++;
    } else {
      map.set(key, {
        id: key, name: g.customer, type: 'customer', company: '',
        phone: '', email: '', loc: g.loc,
        bids: 0, gens: 1, wonValue: 0,
      });
    }
  });

  // Salesperson contacts from won jobs
  const repMap = new Map<string, number>();
  wonJobs.forEach(j => {
    repMap.set(j.salesperson_name, (repMap.get(j.salesperson_name) ?? 0) + Number(j.value));
  });
  repMap.forEach((val, name) => {
    const key = 'rep:' + name;
    map.set(key, {
      id: key, name, type: 'salesperson', company: 'Accurate Power & Technology',
      phone: '', email: '', loc: 'FL',
      bids: bids.filter(b => b.salesperson_name === name).length,
      gens: gens.filter(g => g.salesperson_name === name).length,
      wonValue: val,
    });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const TYPE_LABELS: Record<ContactType, { label: string; color: string; bg: string }> = {
  gc:          { label: 'General Contractor', color: 'var(--blue)',  bg: 'var(--blue-soft)'  },
  customer:    { label: 'Customer',           color: 'var(--amber)', bg: 'var(--amber-soft)' },
  salesperson: { label: 'Salesperson',        color: 'var(--green)', bg: 'var(--green-soft)' },
};

function TypePill({ type }: { type: ContactType }) {
  const t = TYPE_LABELS[type];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
      background: t.bg, color: t.color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      {t.label}
    </span>
  );
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function ContactsPage({ bids, gens, wonJobs }: Props) {
  const [query,      setQuery]      = useState('');
  const [filterType, setFilterType] = useState<ContactType | 'all'>('all');
  const [selected,   setSelected]   = useState<Contact | null>(null);
  const [overrides,  setOverrides]  = useState<Record<string, Partial<Contact>>>({});

  const contacts = useMemo(() => buildContacts(bids, gens, wonJobs), [bids, gens, wonJobs]);

  const merged = useMemo(() =>
    contacts.map(c => ({ ...c, ...(overrides[c.id] ?? {}) })),
    [contacts, overrides]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return merged.filter(c => {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.company.toLowerCase().includes(q) && !c.loc.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [merged, query, filterType]);

  const setField = (id: string, key: keyof Contact, val: string) => {
    setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: val } }));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, [key]: val } : prev);
  };

  const openContact = (c: Contact) => setSelected({ ...c, ...(overrides[c.id] ?? {}) });

  const totalGCs      = merged.filter(c => c.type === 'gc').length;
  const totalCustomers = merged.filter(c => c.type === 'customer').length;
  const totalReps     = merged.filter(c => c.type === 'salesperson').length;
  const totalWon      = merged.filter(c => c.type === 'salesperson').reduce((s, c) => s + c.wonValue, 0);

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        {/* Stats */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'General Contractors', val: String(totalGCs),      sub: 'in contact list', tone: 'blue'  },
            { label: 'Customers',           val: String(totalCustomers), sub: 'generator clients', tone: 'amber' },
            { label: 'Sales Reps',          val: String(totalReps),      sub: 'on the team',      tone: 'green' },
            { label: 'Total Won Value',     val: moneyFull(totalWon),    sub: 'across all reps',  tone: 'green' },
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

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 340px' : '1fr', gap: 16 }}>
          {/* List panel */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                  <Icon name="users" size={15} stroke={1.8}/>
                </span>
                Contacts
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 6 }}>· {filtered.length}</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className="comm-filter">
                  <option value="all">All Types</option>
                  <option value="gc">GC</option>
                  <option value="customer">Customer</option>
                  <option value="salesperson">Salesperson</option>
                </select>
              </div>
            </div>

            {/* Search bar */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 9, padding: '7px 12px' }}>
                <Icon name="search" size={14} stroke={1.9}/>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search contacts…"
                  style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--text)', outline: 'none', flex: 1 }}/>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No contacts match</div>
            ) : (
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th style={{ textAlign: 'right' }}>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} onClick={() => openContact(c)}
                      style={{ cursor: 'pointer', background: selected?.id === c.id ? 'var(--surface2)' : undefined }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="avatar" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>
                            {initials(c.name)}
                          </span>
                          <span className="nm">{c.name}</span>
                        </div>
                      </td>
                      <td><TypePill type={c.type}/></td>
                      <td className="sub">{c.loc || '—'}</td>
                      <td className="sub" style={{ textAlign: 'right' }}>
                        {c.type === 'salesperson'
                          ? moneyFull(c.wonValue)
                          : c.type === 'gc'
                          ? `${c.bids} bid${c.bids !== 1 ? 's' : ''}`
                          : `${c.gens} proposal${c.gens !== 1 ? 's' : ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="panel" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">Contact Detail</span>
                <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                  <Icon name="x" size={16} stroke={2}/>
                </button>
              </div>
              <div style={{ padding: '16px 18px' }}>
                {/* Avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <span className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
                    {initials(selected.name)}
                  </span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>{selected.name}</div>
                    <div style={{ marginTop: 4 }}><TypePill type={selected.type}/></div>
                  </div>
                </div>

                {/* Editable fields */}
                {([
                  ['company', 'Company', 'text'],
                  ['phone',   'Phone',   'tel'],
                  ['email',   'Email',   'email'],
                  ['loc',     'Location', 'text'],
                ] as [keyof Contact, string, string][]).map(([k, label, type]) => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{label}</div>
                    <input type={type} value={String(selected[k] ?? '')}
                      onChange={e => setField(selected.id, k, e.target.value)}
                      style={{ width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '8px 10px', outline: 'none', boxSizing: 'border-box' }}/>
                  </div>
                ))}

                {/* Stats for this contact */}
                <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }}/>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {selected.type === 'gc' && <>
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Bids</div><div className="num" style={{ fontSize: 18, fontWeight: 900 }}>{selected.bids}</div></div>
                  </>}
                  {selected.type === 'customer' && <>
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Proposals</div><div className="num" style={{ fontSize: 18, fontWeight: 900 }}>{selected.gens}</div></div>
                  </>}
                  {selected.type === 'salesperson' && <>
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Bids</div><div className="num" style={{ fontSize: 18, fontWeight: 900 }}>{selected.bids}</div></div>
                    <div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Gen Proposals</div><div className="num" style={{ fontSize: 18, fontWeight: 900 }}>{selected.gens}</div></div>
                    <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Won Value YTD</div><div className="num" style={{ fontSize: 18, fontWeight: 900, color: 'var(--green)' }}>{moneyFull(selected.wonValue)}</div></div>
                  </>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
