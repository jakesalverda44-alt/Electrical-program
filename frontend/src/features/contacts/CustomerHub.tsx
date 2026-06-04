import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Customer, CustomerDetail, Toast } from '../../types';

const money = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');
const moneyShort = (n: number) => n >= 1_000_000 ? '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  : n >= 1000 ? '$' + (n / 1000).toFixed(0) + 'K' : '$' + Math.round(n || 0);
const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const fmtDate = (ts?: string | null) => ts ? new Date(ts.length <= 10 ? ts + 'T00:00:00' : ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtSize = (n: number) => !n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

const TYPE_LABEL: Record<string, string> = { gc: 'General Contractor', customer: 'Customer', other: 'Other' };
const inputStyle: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">{title}{count !== undefined && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 6 }}>· {count}</span>}</span>
        {action}
      </div>
      <div style={{ padding: '4px 0' }}>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '14px 18px', fontSize: 12.5, color: 'var(--text3)' }}>{children}</div>;
}

function Row({ primary, secondary, right }: { primary: string; secondary?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</div>
        {secondary && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{secondary}</div>}
      </div>
      {right && <div style={{ flexShrink: 0, textAlign: 'right' }}>{right}</div>}
    </div>
  );
}

const EDIT_FIELDS: [keyof Customer, string][] = [
  ['company', 'Company'], ['contact_name', 'Contact'], ['phone', 'Phone'], ['email', 'Email'],
  ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['zip', 'Zip'],
];

const MANAGER_ROLES = ['owner', 'administrator', 'sales_manager'];

// Pick duplicate customer records and merge them into the current one.
function MergeModal({ targetId, targetName, onClose, onMerged }: { targetId: string; targetName: string; onClose: () => void; onMerged: (n: number) => void }) {
  const [all, setAll] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  useEffect(() => { api.get('/customers').then(({ data }) => setAll(data)); }, []);

  const options = all.filter(c => c.id !== targetId &&
    (!query || c.name.toLowerCase().includes(query.toLowerCase()) || (c.company || '').toLowerCase().includes(query.toLowerCase())));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const merge = async () => {
    if (!selected.size) return;
    setMerging(true);
    try {
      const { data } = await api.post(`/customers/${targetId}/merge`, { sourceIds: [...selected] });
      onMerged(data.merged);
    } finally { setMerging(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, width: 480, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>Merge duplicates into {targetName}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>Selected customers' bids, proposals, jobs, documents, follow-ups, and communications move into <b>{targetName}</b>, and the duplicates are deleted. This can't be undone.</div>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <input style={{ ...inputStyle }} placeholder="Search customers to merge in…" value={query} onChange={e => setQuery(e.target.value)} autoFocus/>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {options.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No other customers.</div> :
            options.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{TYPE_LABEL[c.type]}{c.company ? ` · ${c.company}` : ''} · {(c.bid_count ?? 0)} bids · {(c.gen_count ?? 0)} props</div>
                </div>
              </label>
            ))}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={merge} disabled={!selected.size || merging}
            style={{ background: 'var(--red)', borderColor: 'var(--red)' }}>
            {merging ? 'Merging…' : `Merge ${selected.size || ''} into this`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerHub({ id, onBack, showToast, onNewBid, userRole }: { id: string; onBack: () => void; showToast?: (t: Toast) => void; onNewBid?: (gc: string) => void; userRole?: string }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>({});
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [commOpen, setCommOpen] = useState(false);
  const [comm, setComm] = useState({ kind: 'call', subject: '', body: '', project: 'general' });
  const [collapsedComm, setCollapsedComm] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const [docCategory, setDocCategory] = useState('plans');

  const load = useCallback(() => {
    api.get(`/customers/${id}`).then(({ data }) => { setDetail(data); setForm(data.customer); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!detail) return <div className="scroll"><div style={{ padding: 40, color: 'var(--text3)' }}>Loading…</div></div>;

  const c = detail.customer;
  const isGc = c.type === 'gc';
  const canMerge = MANAGER_ROLES.includes(userRole || '');
  const openBids = detail.bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const awarded = detail.bids.filter(b => b.stage === 'awarded');
  const lost = detail.bids.filter(b => b.stage === 'lost');
  const revenue = detail.wonJobs.reduce((s, j) => s + Number(j.value), 0);
  const openTasks = detail.tasks.filter(t => t.status === 'open');
  const winRate = (awarded.length + lost.length) ? Math.round((awarded.length / (awarded.length + lost.length)) * 100) : null;

  const saveEdit = async () => {
    const { data } = await api.patch(`/customers/${id}`, form);
    setDetail(d => d ? { ...d, customer: { ...d.customer, ...data } } : d);
    setEditing(false);
    showToast?.({ title: 'Customer saved', sub: data.name });
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    await api.post('/tasks', { title: taskTitle.trim(), due_date: taskDue || null, linked_type: 'customer', linked_id: id, linked_name: c.name });
    setTaskTitle(''); setTaskDue(''); load();
    showToast?.({ title: 'Follow-up added' });
  };
  const toggleTask = async (taskId: string, status: string) => {
    await api.patch(`/tasks/${taskId}`, { status: status === 'done' ? 'open' : 'done' });
    load();
  };

  const logComm = async () => {
    if (!comm.subject.trim()) return;
    // Resolve which project (or the company itself) this message is about.
    let linkedId = id, linkedName = c.name;
    if (comm.project.startsWith('bid:')) {
      const b = detail.bids.find(x => 'bid:' + x.id === comm.project);
      if (b) { linkedId = b.id; linkedName = b.name; }
    } else if (comm.project.startsWith('gen:')) {
      const g = detail.gens.find(x => 'gen:' + x.id === comm.project);
      if (g) { linkedId = g.id; linkedName = g.customer; }
    }
    await api.post('/comms', { kind: comm.kind, subject: comm.subject.trim(), body: comm.body.trim(), linked_id: linkedId, linked_name: linkedName, div: isGc ? 'elec' : 'gen' });
    setComm({ kind: 'call', subject: '', body: '', project: comm.project }); setCommOpen(false); load();
    showToast?.({ title: 'Communication logged' });
  };

  // Group the communication timeline by project (bids/gens), with a General bucket.
  const commProjectOf = (m: CustomerDetail['communications'][number]) => {
    const b = detail.bids.find(x => x.id === m.linked_id) || detail.bids.find(x => x.name === m.linked_name && m.linked_name !== c.name);
    if (b) return { key: 'bid:' + b.id, label: b.name };
    const g = detail.gens.find(x => x.id === m.linked_id);
    if (g) return { key: 'gen:' + g.id, label: `${g.mfr || ''} ${g.model || ''}`.trim() || 'Generator' };
    return { key: 'general', label: 'General / Company' };
  };
  const commGroups = (() => {
    const map = new Map<string, { label: string; items: CustomerDetail['communications'] }>();
    for (const m of detail.communications) {
      const g = commProjectOf(m);
      if (!map.has(g.key)) map.set(g.key, { label: g.label, items: [] });
      map.get(g.key)!.items.push(m);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'general') return 1;
      if (b[0] === 'general') return -1;
      return new Date(b[1].items[0].created_at).getTime() - new Date(a[1].items[0].created_at).getTime();
    });
  })();
  const projectOpts = [
    { val: 'general', label: 'General / company-level' },
    ...detail.bids.map(b => ({ val: 'bid:' + b.id, label: b.name })),
    ...detail.gens.map(g => ({ val: 'gen:' + g.id, label: `${g.mfr || ''} ${g.model || ''}`.trim() || 'Generator' })),
  ];

  const uploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file); fd.append('linked_id', id); fd.append('linked_name', c.name);
    fd.append('div', isGc ? 'elec' : 'gen'); fd.append('category', docCategory); fd.append('display_name', file.name);
    await api.post('/documents', fd);
    if (fileInput.current) fileInput.current.value = '';
    load();
  };
  const downloadDoc = (docId: string, name: string) => {
    const token = localStorage.getItem('crm_token');
    fetch(`/api/documents/${docId}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      });
  };

  const stageBadge = (stage: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      due: { bg: 'var(--amber-soft)', color: 'var(--amber)', label: 'Due' },
      submitted: { bg: 'var(--blue-soft)', color: 'var(--blue)', label: 'Submitted' },
      awarded: { bg: 'var(--green-soft)', color: 'var(--green)', label: 'Awarded' },
      lost: { bg: 'rgba(224,106,106,.12)', color: '#E06A6A', label: 'Lost' },
    };
    const m = map[stage] || { bg: 'var(--surface2)', color: 'var(--text3)', label: stage };
    return <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: m.bg, color: m.color, textTransform: 'uppercase', letterSpacing: '.03em' }}>{m.label}</span>;
  };

  // ── Left column sections (electrical-first for GCs, generator-first otherwise) ──
  const bidsSection = (
    <Section key="bids" title="Open Bids" count={openBids.length}
      action={onNewBid && <button className="panel-link" onClick={() => onNewBid(c.name)}>New bid +</button>}>
      {openBids.length === 0 ? <Empty>No open bids.</Empty> : openBids.map(b => (
        <Row key={b.id} primary={b.name} secondary={`${b.loc || ''}${b.due ? ' · due ' + b.due : ''}`}
          right={<div><div className="num" style={{ fontSize: 13, fontWeight: 700 }}>{b.amount != null ? money(Number(b.amount)) : '—'}</div><div style={{ marginTop: 2 }}>{stageBadge(b.stage)}</div></div>}/>
      ))}
    </Section>
  );
  const projectsSection = (
    <Section key="proj" title="Awarded Projects" count={awarded.length}>
      {awarded.length === 0 ? <Empty>No awarded projects yet.</Empty> : awarded.map(b => (
        <Row key={b.id} primary={b.name} secondary={b.elec_project_phase ? `Phase: ${b.elec_project_phase}` : b.loc}
          right={<span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{b.amount != null ? money(Number(b.amount)) : '—'}</span>}/>
      ))}
    </Section>
  );
  const gensSection = detail.gens.length > 0 ? (
    <Section key="gens" title="Generator Proposals" count={detail.gens.length}>
      {detail.gens.map(g => (
        <Row key={g.id} primary={`${g.mfr || ''} ${g.model || ''}`.trim() || 'Proposal'} secondary={`${g.kw || 0}kW · ${g.stage}`}
          right={<span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{money(Number(g.amount))}</span>}/>
      ))}
    </Section>
  ) : null;

  const leftSections = isGc ? [bidsSection, projectsSection, gensSection] : [gensSection, bidsSection, projectsSection];

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '16px 24px 48px', maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 14, fontSize: 12.5 }}>
          <Icon name="arrow" size={13} stroke={2} style={{ transform: 'rotate(180deg)' }}/>All customers
        </button>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 20px' }}>
            <span className="avatar" style={{ width: 52, height: 52, fontSize: 19, flexShrink: 0 }}>{initials(c.name)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{c.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>
                {TYPE_LABEL[c.type]}{c.contact_name ? ` · ${c.contact_name}` : ''}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}
                {(c.city || c.state) ? ` · ${[c.city, c.state].filter(Boolean).join(', ')}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {onNewBid && (
                <button className="btn" onClick={() => onNewBid(c.name)} style={{ fontSize: 12.5 }}>
                  <Icon name="plus" size={13} stroke={2.4}/>New Bid
                </button>
              )}
              {canMerge && (
                <button className="btn ghost" onClick={() => setMerging(true)} style={{ fontSize: 12.5 }} title="Merge duplicate customer records into this one">
                  <Icon name="users" size={13} stroke={2}/>Merge
                </button>
              )}
              <button className="btn ghost" onClick={() => { setForm(c); setEditing(e => !e); }} style={{ fontSize: 12.5 }}>
                <Icon name={editing ? 'x' : 'gear'} size={13} stroke={2}/>{editing ? 'Cancel' : 'Edit'}
              </button>
            </div>
          </div>

          {editing && (
            <div style={{ padding: '0 20px 18px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
              {EDIT_FIELDS.map(([k, label]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
                  <input style={inputStyle} value={String(form[k] ?? '')} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}/>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1' }}><button className="btn" onClick={saveEdit}>Save changes</button></div>
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(5,1fr)', padding: 0, marginBottom: 16 }}>
          {[
            { label: 'Revenue Won', val: moneyShort(revenue), sub: `${detail.wonJobs.length} jobs`, tone: 'green' },
            { label: 'Open Bids', val: String(openBids.length), sub: moneyShort(openBids.reduce((s, b) => s + Number(b.amount || 0), 0)), tone: 'blue' },
            { label: 'Awarded Projects', val: String(awarded.length), sub: moneyShort(awarded.reduce((s, b) => s + Number(b.amount || 0), 0)), tone: 'green' },
            { label: 'Win Rate', val: winRate != null ? winRate + '%' : '—', sub: `${awarded.length}W · ${lost.length}L`, tone: 'amber' },
            { label: 'Open Follow-ups', val: String(openTasks.length), sub: 'to do', tone: openTasks.length ? 'amber' : 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top"><span className="stat-label">{s.label}</span></div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Command center: work on the left, relationship on the right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
          <div>{leftSections}</div>

          <div>
            {/* Follow-ups */}
            <Section title="Follow-ups" count={openTasks.length}>
              <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
                <input style={{ ...inputStyle, flex: 1 }} placeholder="Add a follow-up…" value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()}/>
                <input type="date" style={{ ...inputStyle, width: 140 }} value={taskDue} onChange={e => setTaskDue(e.target.value)}/>
                <button className="btn" onClick={addTask} disabled={!taskTitle.trim()}>Add</button>
              </div>
              {detail.tasks.length === 0 ? <Empty>No follow-ups.</Empty> : detail.tasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => toggleTask(t.id, t.status)} style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, cursor: 'pointer',
                    border: '2px solid ' + (t.status === 'done' ? 'var(--green)' : 'var(--border2)'), background: t.status === 'done' ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.status === 'done' && <Icon name="check" size={11} stroke={3}/>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, textDecoration: t.status === 'done' ? 'line-through' : 'none', opacity: t.status === 'done' ? .6 : 1 }}>{t.title}</div>
                    {t.due_date && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Due {fmtDate(t.due_date)}</div>}
                  </div>
                </div>
              ))}
            </Section>

            {/* Communication history */}
            <Section title="Communication History" count={detail.communications.length}
              action={<button className="panel-link" onClick={() => setCommOpen(o => !o)}>{commOpen ? 'Cancel' : 'Log +'}</button>}>
              {commOpen && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...inputStyle, width: 110 }} value={comm.kind} onChange={e => setComm(s => ({ ...s, kind: e.target.value }))}>
                      <option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option>
                    </select>
                    <select style={{ ...inputStyle, flex: 1 }} value={comm.project} onChange={e => setComm(s => ({ ...s, project: e.target.value }))} title="Which project is this about?">
                      {projectOpts.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                    </select>
                  </div>
                  <input style={inputStyle} placeholder="Subject" value={comm.subject} onChange={e => setComm(s => ({ ...s, subject: e.target.value }))}/>
                  <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Notes…" value={comm.body} onChange={e => setComm(s => ({ ...s, body: e.target.value }))}/>
                  <button className="btn" onClick={logComm} disabled={!comm.subject.trim()} style={{ alignSelf: 'flex-start' }}>Save</button>
                </div>
              )}
              {detail.communications.length === 0 ? <Empty>No communications logged.</Empty> : commGroups.map(([key, group]) => {
                const open = !collapsedComm.has(key);
                return (
                  <div key={key} style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => setCollapsedComm(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', border: 'none', background: 'var(--surface2)', cursor: 'pointer', textAlign: 'left' }}>
                      <Icon name="arrow" size={12} stroke={2.4} style={{ transform: open ? 'rotate(90deg)' : 'none', color: 'var(--text3)' }}/>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{group.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>· {group.items.length}</span>
                    </button>
                    {open && group.items.map(m => (
                      <div key={m.id} style={{ padding: '9px 16px 9px 30px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.subject}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{fmtDate(m.created_at)}</span>
                        </div>
                        {m.body && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>{m.body}</div>}
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, textTransform: 'capitalize' }}>{m.kind}{m.author ? ` · ${m.author}` : ''}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </Section>

            {/* Documents */}
            <Section title="Documents" count={detail.documents.length}
              action={
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={docCategory} onChange={e => setDocCategory(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}>
                    <option value="plans">Plans</option><option value="contract">Contract</option><option value="proposal">Proposal</option>
                    <option value="permit">Permit</option><option value="invoice">Invoice / PO</option><option value="other">Other</option>
                  </select>
                  <input ref={fileInput} type="file" onChange={uploadDoc} style={{ display: 'none' }}/>
                  <button className="panel-link" onClick={() => fileInput.current?.click()}>Upload +</button>
                </span>
              }>
              {detail.documents.length === 0 ? <Empty>No documents.</Empty> : detail.documents.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: '1px solid var(--border)' }}>
                  <Icon name="clip" size={15} stroke={1.8} style={{ color: 'var(--text3)', flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.display_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'capitalize' }}>{d.category}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''} · {fmtDate(d.created_at)}</div>
                  </div>
                  <button onClick={() => downloadDoc(d.id, d.display_name)} title="Download" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--blue)', padding: 4, flexShrink: 0 }}>
                    <Icon name="arrow" size={15} stroke={2}/>
                  </button>
                </div>
              ))}
            </Section>
          </div>
        </div>
      </div>

      {merging && (
        <MergeModal targetId={id} targetName={c.name} onClose={() => setMerging(false)}
          onMerged={n => { setMerging(false); load(); showToast?.({ title: `Merged ${n} duplicate${n !== 1 ? 's' : ''}`, sub: `into ${c.name}` }); }}/>
      )}
    </div>
  );
}
