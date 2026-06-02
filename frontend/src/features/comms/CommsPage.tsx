import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, Activity, Toast } from '../../types';
import api from '../../api/client';

type CommKind = 'note' | 'call' | 'email' | 'meeting' | 'bid' | 'award' | 'system';

interface CommEntry {
  id: string;
  kind: CommKind;
  div: 'elec' | 'gen' | 'general';
  subject: string;
  body: string;
  linkedId: string;
  linkedName: string;
  author: string;
  ts: string;
}

const KIND_META: Record<CommKind, { label: string; icon: string; color: string; bg: string }> = {
  note:    { label: 'Note',    icon: 'doc',      color: 'var(--text2)',  bg: 'var(--surface2)'   },
  call:    { label: 'Call',    icon: 'bell',     color: 'var(--blue)',   bg: 'var(--blue-soft)'  },
  email:   { label: 'Email',   icon: 'cloud',    color: 'var(--amber)',  bg: 'var(--amber-soft)' },
  meeting: { label: 'Meeting', icon: 'users',    color: 'var(--green)',  bg: 'var(--green-soft)' },
  bid:     { label: 'Bid',     icon: 'pipeline', color: 'var(--orange, #F2854F)', bg: 'rgba(242,133,79,.12)' },
  award:   { label: 'Award',   icon: 'check',    color: 'var(--green)',  bg: 'var(--green-soft)' },
  system:  { label: 'System',  icon: 'gear',     color: 'var(--text3)',  bg: 'var(--surface2)'   },
};

function activityToEntry(a: Activity, idx: number): CommEntry {
  return {
    id: a.id,
    kind: (a.kind as CommKind) ?? 'system',
    div: (a.div === 'elec' ? 'elec' : a.div === 'gen' ? 'gen' : 'general') as CommEntry['div'],
    subject: a.text,
    body: '',
    linkedId: '',
    linkedName: '',
    author: 'System',
    ts: new Date(Date.now() - idx * 3_600_000 * 4).toISOString(),
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

interface Props {
  bids:     Bid[];
  gens:     Gen[];
  activity: Activity[];
  showToast: (t: Toast) => void;
  userName:  string;
}

const BLANK_FORM = { kind: 'note' as CommKind, linkedId: '', subject: '', body: '' };

export default function CommsPage({ bids, gens, activity, showToast, userName }: Props) {
  const systemEntries = useMemo(() => activity.map((a, i) => activityToEntry(a, i)), [activity]);
  const [persisted, setPersisted] = useState<CommEntry[]>([]);

  useEffect(() => {
    api.get('/comms').then(r => {
      const rows: CommEntry[] = r.data.map((row: Record<string, string>) => ({
        id: row.id,
        kind: row.kind as CommKind,
        div: row.div as CommEntry['div'],
        subject: row.subject,
        body: row.body ?? '',
        linkedId: row.linked_id ?? '',
        linkedName: row.linked_name ?? '',
        author: row.author,
        ts: row.created_at,
      }));
      setPersisted(rows);
    }).catch(() => {});
  }, []);

  const entries = useMemo(() => {
    const ids = new Set(persisted.map(e => e.id));
    return [...persisted, ...systemEntries.filter(e => !ids.has(e.id))];
  }, [persisted, systemEntries]);
  const [filterKind, setFilterKind] = useState<CommKind | 'all'>('all');
  const [filterDiv,  setFilterDiv]  = useState<'all' | 'elec' | 'gen' | 'general'>('all');
  const [search,     setSearch]     = useState('');
  const [addOpen,    setAddOpen]    = useState(false);
  const [form,       setForm]       = useState(BLANK_FORM);

  // Build linked-item options
  const linkOptions = useMemo(() => [
    { id: '', name: '— No link —' },
    ...bids.map(b => ({ id: 'bid:' + b.id, name: `[Elec] ${b.name}` })),
    ...gens.map(g => ({ id: 'gen:' + g.id, name: `[Gen] ${g.customer}` })),
  ], [bids, gens]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries
      .filter(e => {
        if (filterKind !== 'all' && e.kind !== filterKind) return false;
        if (filterDiv  !== 'all' && e.div  !== filterDiv)  return false;
        if (q && !e.subject.toLowerCase().includes(q) && !e.body.toLowerCase().includes(q) && !e.linkedName.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [entries, filterKind, filterDiv, search]);

  const handleAdd = async () => {
    if (!form.subject.trim()) { showToast({ title: 'Subject required' }); return; }
    const opt = linkOptions.find(o => o.id === form.linkedId);
    const div: CommEntry['div'] = form.linkedId.startsWith('bid:') ? 'elec' : form.linkedId.startsWith('gen:') ? 'gen' : 'general';
    try {
      const { data } = await api.post('/comms', {
        kind: form.kind, div, subject: form.subject.trim(), body: form.body.trim(),
        linked_id: form.linkedId || null, linked_name: opt?.name || null,
      });
      const entry: CommEntry = {
        id: data.id, kind: data.kind, div: data.div,
        subject: data.subject, body: data.body ?? '',
        linkedId: data.linked_id ?? '', linkedName: data.linked_name ?? '',
        author: data.author, ts: data.created_at,
      };
      setPersisted(prev => [entry, ...prev]);
      setForm(BLANK_FORM);
      setAddOpen(false);
      showToast({ title: `${KIND_META[form.kind].label} logged` });
    } catch {
      showToast({ title: 'Failed to save', sub: 'Please try again' });
    }
  };

  const INPUT = {
    font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
    background: 'var(--surface)', border: '1px solid var(--border2)',
    borderRadius: 9, padding: '9px 12px', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        {/* Stats row */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'Total Entries',  val: String(entries.length),                                          sub: 'all communications',   tone: 'blue'  },
            { label: 'Notes',          val: String(entries.filter(e => e.kind === 'note').length),            sub: 'internal notes',       tone: 'amber' },
            { label: 'Calls Logged',   val: String(entries.filter(e => e.kind === 'call').length),            sub: 'phone calls',          tone: 'green' },
            { label: 'Emails',         val: String(entries.filter(e => e.kind === 'email').length),           sub: 'email exchanges',      tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="bell" size={16} stroke={1.8}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Add note form */}
        {addOpen && (
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Log Communication</span>
              <button onClick={() => setAddOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}>
                <Icon name="x" size={16} stroke={2}/>
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Type</label>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as CommKind }))} style={{ ...INPUT, cursor: 'pointer' }}>
                  {(['note','call','email','meeting'] as CommKind[]).map(k => (
                    <option key={k} value={k}>{KIND_META[k].label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Link to Bid / Proposal</label>
                <select value={form.linkedId} onChange={e => setForm(f => ({ ...f, linkedId: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                  {linkOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Subject</label>
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Brief summary…" style={INPUT}/>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Notes</label>
                <input value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Optional details…" style={INPUT}/>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
                <button className="btn" onClick={handleAdd} style={{ fontSize: 13 }}>
                  <Icon name="check" size={14} stroke={2.2}/> Save Entry
                </button>
                <button className="btn ghost" onClick={() => { setAddOpen(false); setForm(BLANK_FORM); }} style={{ fontSize: 13 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters + add button */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 9, padding: '7px 12px', flex: 1, minWidth: 200 }}>
            <Icon name="search" size={14} stroke={1.9}/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search communications…"
              style={{ border: 'none', background: 'transparent', font: 'inherit', fontSize: 13, color: 'var(--text)', outline: 'none', flex: 1 }}/>
          </div>

          <select value={filterKind} onChange={e => setFilterKind(e.target.value as any)} className="comm-filter">
            <option value="all">All Types</option>
            {(['note','call','email','meeting','bid','award'] as CommKind[]).map(k => (
              <option key={k} value={k}>{KIND_META[k].label}</option>
            ))}
          </select>

          <select value={filterDiv} onChange={e => setFilterDiv(e.target.value as any)} className="comm-filter">
            <option value="all">All Divisions</option>
            <option value="elec">Electrical</option>
            <option value="gen">Generator</option>
            <option value="general">General</option>
          </select>

          <button className="btn ghost" onClick={() => setAddOpen(true)} style={{ fontSize: 13, marginLeft: 'auto' }}>
            <Icon name="plus" size={14} stroke={2.2}/> Add Entry
          </button>
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No entries match these filters.
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {/* Vertical line */}
            <div style={{ position: 'absolute', left: 19, top: 0, bottom: 0, width: 2, background: 'var(--border)' }}/>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {filtered.map((e, i) => {
                const m = KIND_META[e.kind] ?? KIND_META.system;
                return (
                  <div key={e.id} style={{ display: 'flex', gap: 18, paddingBottom: 20, position: 'relative' }}>
                    {/* Icon dot */}
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                      background: m.bg, color: m.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid var(--surface)',
                      position: 'relative', zIndex: 1,
                    }}>
                      <Icon name={m.icon as any} size={16} stroke={1.9}/>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, paddingTop: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                            background: m.bg, color: m.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            {m.label}
                          </span>
                          {e.div !== 'general' && (
                            <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                              background: e.div === 'elec' ? 'var(--blue-soft)' : 'var(--amber-soft)',
                              color: e.div === 'elec' ? 'var(--blue)' : 'var(--amber)',
                              textTransform: 'uppercase', letterSpacing: '.04em' }}>
                              {e.div === 'elec' ? 'Electrical' : 'Generator'}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {timeAgo(e.ts)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: e.body || e.linkedName ? 4 : 0 }}>
                        {e.subject}
                      </div>
                      {e.body && (
                        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: e.linkedName ? 6 : 0 }}>
                          {e.body}
                        </div>
                      )}
                      {e.linkedName && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                          <Icon name="clip" size={12} stroke={1.8}/>{e.linkedName}
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6, fontWeight: 600 }}>
                        {e.author}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
