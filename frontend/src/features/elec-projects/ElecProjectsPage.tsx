import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import api from '../../api/client';

const PHASES = [
  { key: 'signed',      label: 'Contract Signed', color: '#7C8AA3' },
  { key: 'rough',       label: 'Rough-In',        color: '#E0A53B' },
  { key: 'inspection',  label: 'Inspection',      color: '#4D8DF7' },
  { key: 'trim',        label: 'Trim-Out',        color: '#9B6DFF' },
  { key: 'final',       label: 'Final',           color: '#F2854F' },
  { key: 'complete',    label: 'Complete',        color: '#34C588' },
] as const;
type PhaseKey = typeof PHASES[number]['key'];

const PROJ_TABS = [
  { key: 'overview',      label: 'Overview'       },
  { key: 'financials',    label: 'Financials'     },
  { key: 'change-orders', label: 'Change Orders'  },
  { key: 'field-notes',   label: 'Field Notes'    },
  { key: 'rfis',          label: 'Request Log'    },
  { key: 'schedule',      label: 'Schedule'       },
  { key: 'closeout',      label: 'Closeout'       },
] as const;
type ProjTab = typeof PROJ_TABS[number]['key'];

interface ChangeOrder { id: string; number: number; description: string; amount: number; status: 'pending'|'approved'|'rejected'; submitted_date: string|null; }
interface FieldNote   { id: string; note_date: string|null; author: string; note: string; weather: string; crew_size: number; }
interface ProjectRfi  { id: string; rfi_number: string; question: string; submitted_to: string; submitted_date: string|null; due_date: string|null; status: 'open'|'answered'|'closed'; answer: string; answered_date: string|null; }

interface ProjectState { phase: PhaseKey; notes: string; }

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n);
}
function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtDate(s: string|null) { return s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const INPUT: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '8px 12px', outline: 'none', width: '100%', boxSizing: 'border-box',
};

const STATUS_COLORS: Record<string, string> = {
  pending:  '#E0A53B', approved: '#34C588', rejected: '#E06A6A',
  open:     '#4D8DF7', answered: '#34C588', closed:   '#7C8AA3',
};

interface Props { bids: Bid[]; showToast: (t: Toast) => void; }

export default function ElecProjectsPage({ bids, showToast }: Props) {
  const awarded = useMemo(() => bids.filter(b => b.stage === 'awarded'), [bids]);

  const [states,     setStates]     = useState<Record<string, ProjectState>>(() =>
    Object.fromEntries(awarded.map(b => [b.id, { phase: (b.elec_project_phase as PhaseKey)||'signed', notes: '' }]))
  );
  const [expandedId, setExpandedId] = useState<string|null>(null);
  const [activeTab,  setActiveTab]  = useState<ProjTab>('overview');
  const [filterPhase, setFilterPhase] = useState<PhaseKey|'all'>('all');
  const [filterRep,   setFilterRep]   = useState('all');

  // Per-project data (loaded lazily)
  const [coMap,   setCoMap]   = useState<Record<string, ChangeOrder[]>>({});
  const [fnMap,   setFnMap]   = useState<Record<string, FieldNote[]>>({});
  const [rfiMap,  setRfiMap]  = useState<Record<string, ProjectRfi[]>>({});
  const [secMap,  setSecMap]  = useState<Record<string, Record<string, unknown>>>({});

  // New CO form
  const [coForm, setCoForm] = useState({ description:'', amount:'', status:'pending', submitted_date:'' });
  // New field note form
  const [fnForm, setFnForm] = useState({ note:'', note_date:'', weather:'', crew_size:'' });
  // New RFI form
  const [rfiForm, setRfiForm] = useState({ question:'', submitted_to:'', submitted_date:'', due_date:'' });

  const salespeople = useMemo(() => Array.from(new Set(awarded.map(b => b.salesperson_name))).sort(), [awarded]);

  const loadProjectData = useCallback(async (id: string) => {
    const [coRes, fnRes, rfiRes] = await Promise.allSettled([
      api.get(`/projects/elec/${id}/change-orders`),
      api.get(`/projects/elec/${id}/field-notes`),
      api.get(`/projects/elec/${id}/rfis`),
    ]);
    if (coRes.status  === 'fulfilled') setCoMap(p  => ({ ...p,  [id]: coRes.value.data  }));
    if (fnRes.status  === 'fulfilled') setFnMap(p  => ({ ...p,  [id]: fnRes.value.data  }));
    if (rfiRes.status === 'fulfilled') setRfiMap(p => ({ ...p,  [id]: rfiRes.value.data }));
  }, []);

  const openProject = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setActiveTab('overview');
    loadProjectData(id);
  };

  const setPhase = (id: string, phase: PhaseKey) => {
    setStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? { phase: 'signed', notes: '' }), phase } }));
    showToast({ title: 'Phase updated', sub: PHASES.find(p => p.key === phase)?.label });
    api.patch(`/bids/${id}/phase`, { phase }).catch(() => {});
  };

  const ensureState = (b: Bid): ProjectState =>
    states[b.id] ?? { phase: (b.elec_project_phase as PhaseKey)||'signed', notes: '' };

  const filtered = awarded.filter(b => {
    const st = ensureState(b);
    if (filterPhase !== 'all' && st.phase !== filterPhase) return false;
    if (filterRep   !== 'all' && b.salesperson_name !== filterRep) return false;
    return true;
  });

  const totalValue  = awarded.reduce((s, b) => s + Number(b.amount??0), 0);
  const activeCount = awarded.filter(b => (states[b.id]?.phase??'signed') !== 'complete').length;
  const doneCount   = awarded.filter(b => states[b.id]?.phase === 'complete').length;
  const avgVal      = awarded.length ? Math.round(totalValue / awarded.length) : 0;

  // ── Tab Content ─────────────────────────────────────────────
  const TabContent = ({ bid }: { bid: Bid }) => {
    const id  = bid.id;
    const st  = ensureState(bid);
    const cos = coMap[id]  ?? [];
    const fns = fnMap[id]  ?? [];
    const rfis = rfiMap[id] ?? [];
    const coTotal = cos.filter(c => c.status==='approved').reduce((s,c) => s+Number(c.amount),0);
    const contractVal = Number(bid.amount??0);

    if (activeTab === 'overview') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <SectionLabel>Project Details</SectionLabel>
          <InfoGrid rows={[
            ['Contract Value',  moneyFull(contractVal)],
            ['General Contractor', bid.gc || '—'],
            ['Location',        bid.loc || '—'],
            ['Contact',         bid.contact || '—'],
            ['Plan Sheets',     bid.sheets ? `${bid.sheets} sheets` : '—'],
            ['Salesperson',     bid.salesperson_name],
          ]}/>
        </div>
        <div>
          <SectionLabel>Set Phase</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
            {PHASES.map(p => (
              <button key={p.key} onClick={() => setPhase(id, p.key)}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: st.phase===p.key ? p.color : 'var(--surface2)',
                  color: st.phase===p.key ? '#fff' : 'var(--text2)' }}>
                {p.label}
              </button>
            ))}
          </div>
          <SectionLabel>Job Notes</SectionLabel>
          <textarea value={st.notes}
            onChange={e => setStates(prev => ({ ...prev, [id]: { ...st, notes: e.target.value } }))}
            placeholder="Site conditions, schedule notes, change orders…"
            style={{ ...INPUT, height: 100, resize: 'vertical' }}/>
        </div>
      </div>
    );

    if (activeTab === 'financials') {
      const pending  = cos.filter(c => c.status==='pending').reduce((s,c)=>s+Number(c.amount),0);
      const rejected = cos.filter(c => c.status==='rejected').reduce((s,c)=>s+Number(c.amount),0);
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'Original Contract', val: moneyFull(contractVal),            color: 'var(--blue)'   },
              { label: 'Approved COs',      val: moneyFull(coTotal),                color: 'var(--green)'  },
              { label: 'Revised Contract',  val: moneyFull(contractVal + coTotal),  color: 'var(--text)'   },
              { label: 'Pending COs',       val: moneyFull(pending),                color: 'var(--amber)'  },
            ].map(f => (
              <div key={f.label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{f.label}</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 900, color: f.color }}>{f.val}</div>
              </div>
            ))}
          </div>
          {cos.length > 0 && (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {cos.map(co => (
                    <tr key={co.id}>
                      <td className="sub">CO-{String(co.number).padStart(3,'0')}</td>
                      <td><span className="nm">{co.description}</span></td>
                      <td className="num">{co.amount>=0?'+':''}{moneyFull(co.amount)}</td>
                      <td><StatusChip status={co.status}/></td>
                      <td className="sub">{fmtDate(co.submitted_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cos.length === 0 && <Empty text="No change orders yet"/>}
        </div>
      );
    }

    if (activeTab === 'change-orders') return (
      <div>
        <div className="panel" style={{ marginBottom: 16, padding: '18px 20px' }}>
          <SectionLabel>New Change Order</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <FieldLabel>Description</FieldLabel>
              <input value={coForm.description} onChange={e => setCoForm(f=>({...f,description:e.target.value}))}
                placeholder="CO description…" style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Amount ($)</FieldLabel>
              <input type="number" value={coForm.amount} onChange={e => setCoForm(f=>({...f,amount:e.target.value}))}
                placeholder="0" style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={coForm.status} onChange={e => setCoForm(f=>({...f,status:e.target.value}))} style={{...INPUT,cursor:'pointer'}}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div>
              <FieldLabel>Submitted</FieldLabel>
              <input type="date" value={coForm.submitted_date} onChange={e => setCoForm(f=>({...f,submitted_date:e.target.value}))} style={INPUT}/>
            </div>
            <button className="btn" style={{ fontSize: 13, whiteSpace: 'nowrap' }}
              onClick={async () => {
                if (!coForm.description.trim()) { showToast({ title: 'Description required' }); return; }
                const res = await api.post(`/projects/elec/${id}/change-orders`, {
                  description: coForm.description, amount: Number(coForm.amount)||0,
                  status: coForm.status, submitted_date: coForm.submitted_date||null,
                });
                setCoMap(p => ({ ...p, [id]: [...(p[id]??[]), res.data] }));
                setCoForm({ description:'', amount:'', status:'pending', submitted_date:'' });
                showToast({ title: 'Change order added' });
              }}>
              <Icon name="plus" size={14} stroke={2.2}/> Add
            </button>
          </div>
        </div>

        {cos.length === 0 ? <Empty text="No change orders yet"/> : (
          <div className="panel">
            <table className="ctable">
              <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
              <tbody>
                {cos.map(co => (
                  <tr key={co.id}>
                    <td className="sub">CO-{String(co.number).padStart(3,'0')}</td>
                    <td><span className="nm">{co.description}</span></td>
                    <td className="num" style={{ color: co.amount>=0?'var(--green)':'var(--red,#E06A6A)' }}>
                      {co.amount>=0?'+':''}{moneyFull(co.amount)}
                    </td>
                    <td>
                      <select value={co.status}
                        onChange={async e => {
                          await api.patch(`/projects/elec/${id}/change-orders/${co.id}`, { status: e.target.value });
                          setCoMap(p => ({ ...p, [id]: (p[id]??[]).map(c => c.id===co.id ? {...c,status:e.target.value as any} : c) }));
                          showToast({ title: 'Status updated' });
                        }}
                        style={{ font:'inherit', fontSize:12, fontWeight:700, border:'none', background:'transparent',
                          color: STATUS_COLORS[co.status]||'var(--text)', cursor:'pointer', outline:'none' }}>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="sub">{fmtDate(co.submitted_date)}</td>
                    <td>
                      <button onClick={async () => {
                        await api.delete(`/projects/elec/${id}/change-orders/${co.id}`);
                        setCoMap(p => ({ ...p, [id]: (p[id]??[]).filter(c => c.id!==co.id) }));
                        showToast({ title: 'Change order removed' });
                      }} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text3)', padding:4 }}>
                        <Icon name="x" size={13} stroke={2}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );

    if (activeTab === 'field-notes') return (
      <div>
        <div className="panel" style={{ marginBottom: 16, padding: '18px 20px' }}>
          <SectionLabel>Add Field Note</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <FieldLabel>Date</FieldLabel>
              <input type="date" value={fnForm.note_date} onChange={e=>setFnForm(f=>({...f,note_date:e.target.value}))} style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Weather</FieldLabel>
              <input value={fnForm.weather} onChange={e=>setFnForm(f=>({...f,weather:e.target.value}))}
                placeholder="e.g. Sunny 82°F" style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Crew Size</FieldLabel>
              <input type="number" value={fnForm.crew_size} onChange={e=>setFnForm(f=>({...f,crew_size:e.target.value}))}
                placeholder="0" style={INPUT}/>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Note</FieldLabel>
              <textarea value={fnForm.note} onChange={e=>setFnForm(f=>({...f,note:e.target.value}))}
                placeholder="Daily progress, site conditions, work completed…"
                style={{ ...INPUT, height: 72, resize: 'vertical' }}/>
            </div>
            <button className="btn" style={{ fontSize: 13, whiteSpace: 'nowrap', marginBottom: 0 }}
              onClick={async () => {
                if (!fnForm.note.trim()) { showToast({ title: 'Note required' }); return; }
                const res = await api.post(`/projects/elec/${id}/field-notes`, {
                  note: fnForm.note, note_date: fnForm.note_date||null,
                  weather: fnForm.weather, crew_size: Number(fnForm.crew_size)||0,
                });
                setFnMap(p => ({ ...p, [id]: [res.data, ...(p[id]??[])] }));
                setFnForm({ note:'', note_date:'', weather:'', crew_size:'' });
                showToast({ title: 'Field note added' });
              }}>
              <Icon name="plus" size={14} stroke={2.2}/> Add Note
            </button>
          </div>
        </div>

        {fns.length === 0 ? <Empty text="No field notes yet"/> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fns.map(fn => (
              <div key={fn.id} className="panel" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{fmtDate(fn.note_date)}</span>
                    {fn.weather && <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{fn.weather}</span>}
                    {fn.crew_size > 0 && <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}><Icon name="users" size={11} stroke={1.8}/> {fn.crew_size} crew</span>}
                    <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>by {fn.author}</span>
                  </div>
                  <button onClick={async () => {
                    await api.delete(`/projects/elec/${id}/field-notes/${fn.id}`);
                    setFnMap(p => ({ ...p, [id]: (p[id]??[]).filter(n => n.id!==fn.id) }));
                    showToast({ title: 'Note removed' });
                  }} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text3)', padding:4 }}>
                    <Icon name="x" size={13} stroke={2}/>
                  </button>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{fn.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );

    if (activeTab === 'rfis') return (
      <div>
        <div className="panel" style={{ marginBottom: 16, padding: '18px 20px' }}>
          <SectionLabel>Submit RFI</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <FieldLabel>Question</FieldLabel>
              <input value={rfiForm.question} onChange={e=>setRfiForm(f=>({...f,question:e.target.value}))}
                placeholder="Describe the information request…" style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Submitted To</FieldLabel>
              <input value={rfiForm.submitted_to} onChange={e=>setRfiForm(f=>({...f,submitted_to:e.target.value}))}
                placeholder="GC / Architect" style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Submitted</FieldLabel>
              <input type="date" value={rfiForm.submitted_date} onChange={e=>setRfiForm(f=>({...f,submitted_date:e.target.value}))} style={INPUT}/>
            </div>
            <div>
              <FieldLabel>Due Date</FieldLabel>
              <input type="date" value={rfiForm.due_date} onChange={e=>setRfiForm(f=>({...f,due_date:e.target.value}))} style={INPUT}/>
            </div>
          </div>
          <button className="btn" style={{ fontSize: 13 }}
            onClick={async () => {
              if (!rfiForm.question.trim()) { showToast({ title: 'Question required' }); return; }
              const res = await api.post(`/projects/elec/${id}/rfis`, {
                question: rfiForm.question, submitted_to: rfiForm.submitted_to,
                submitted_date: rfiForm.submitted_date||null, due_date: rfiForm.due_date||null,
              });
              setRfiMap(p => ({ ...p, [id]: [res.data, ...(p[id]??[])] }));
              setRfiForm({ question:'', submitted_to:'', submitted_date:'', due_date:'' });
              showToast({ title: 'RFI submitted' });
            }}>
            <Icon name="plus" size={14} stroke={2.2}/> Submit RFI
          </button>
        </div>

        {rfis.length === 0 ? <Empty text="No RFIs yet"/> : (
          <div className="panel">
            <table className="ctable">
              <thead><tr><th>RFI #</th><th>Question</th><th>To</th><th>Submitted</th><th>Due</th><th>Status</th><th>Answer</th></tr></thead>
              <tbody>
                {rfis.map(rfi => (
                  <tr key={rfi.id}>
                    <td className="sub" style={{ fontWeight: 800 }}>{rfi.rfi_number}</td>
                    <td><span className="nm">{rfi.question}</span></td>
                    <td className="sub">{rfi.submitted_to||'—'}</td>
                    <td className="sub">{fmtDate(rfi.submitted_date)}</td>
                    <td className="sub">{fmtDate(rfi.due_date)}</td>
                    <td>
                      <select value={rfi.status}
                        onChange={async e => {
                          await api.patch(`/projects/elec/${id}/rfis/${rfi.id}`, { status: e.target.value });
                          setRfiMap(p => ({ ...p, [id]: (p[id]??[]).map(r => r.id===rfi.id ? {...r,status:e.target.value as any} : r) }));
                        }}
                        style={{ font:'inherit', fontSize:12, fontWeight:700, border:'none', background:'transparent',
                          color: STATUS_COLORS[rfi.status]||'var(--text)', cursor:'pointer', outline:'none' }}>
                        <option value="open">Open</option>
                        <option value="answered">Answered</option>
                        <option value="closed">Closed</option>
                      </select>
                    </td>
                    <td className="sub" style={{ maxWidth: 200, whiteSpace: 'pre-wrap' }}>{rfi.answer||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );

    if (activeTab === 'schedule') {
      const sec = (secMap[id]?.schedule as any) ?? {};
      const milestones: {label:string;key:string}[] = [
        { label:'Mobilization Date',    key:'mobilize'   },
        { label:'Rough-In Complete',    key:'rough_done' },
        { label:'Inspection Date',      key:'inspection' },
        { label:'Trim-Out Start',       key:'trim_start' },
        { label:'Substantial Complete', key:'sub_comp'   },
        { label:'Final Walkthrough',    key:'final_walk' },
        { label:'Closeout Package Due', key:'closeout'   },
      ];
      const [draft, setDraft] = useState<Record<string,string>>(sec);
      const save = async () => {
        await api.put(`/projects/elec/${id}/section/schedule`, { data: draft });
        setSecMap(p => ({ ...p, [id]: { ...(p[id]??{}), schedule: draft } }));
        showToast({ title: 'Schedule saved' });
      };
      return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
            {milestones.map(m => (
              <div key={m.key}>
                <FieldLabel>{m.label}</FieldLabel>
                <input type="date" value={draft[m.key]||''} onChange={e=>setDraft(d=>({...d,[m.key]:e.target.value}))} style={INPUT}/>
              </div>
            ))}
          </div>
          <button className="btn" style={{ fontSize: 13 }} onClick={save}>
            <Icon name="check" size={14} stroke={2}/> Save Schedule
          </button>
        </div>
      );
    }

    if (activeTab === 'closeout') {
      const sec = (secMap[id]?.closeout as any) ?? {};
      const items = [
        { label:'As-Built Drawings',    key:'as_builts'    },
        { label:'O&M Manuals',          key:'om_manuals'   },
        { label:'Test Reports',         key:'test_reports' },
        { label:'Permit Final',         key:'permit_final' },
        { label:'Warranty Letters',     key:'warranty'     },
        { label:'Lien Waivers',         key:'lien_waivers' },
        { label:'Final Invoice Sent',   key:'final_invoice'},
        { label:'Payment Received',     key:'payment'      },
      ];
      const [draft, setDraft] = useState<Record<string,boolean>>(sec);
      const notes = (sec.notes as string)||(secMap[id]?.closeout_notes as string)||'';
      const [closeNotes, setCloseNotes] = useState(notes);
      const save = async () => {
        await api.put(`/projects/elec/${id}/section/closeout`, { data: { ...draft, notes: closeNotes } });
        setSecMap(p => ({ ...p, [id]: { ...(p[id]??{}), closeout: { ...draft, notes: closeNotes } } }));
        showToast({ title: 'Closeout saved' });
      };
      const done = items.filter(i => draft[i.key]).length;
      return (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text3)', marginBottom: 10 }}>
              {done} / {items.length} items complete
            </div>
            <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden', marginBottom: 18 }}>
              <div style={{ height:'100%', width: `${(done/items.length)*100}%`, background: done===items.length?'var(--green)':'var(--blue)', borderRadius: 4, transition: 'width .3s' }}/>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              {items.map(item => (
                <label key={item.key} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer',
                  background: draft[item.key] ? 'var(--green-soft)' : 'var(--surface2)', borderRadius: 8,
                  padding: '10px 14px', fontSize: 13, fontWeight: 700, color: draft[item.key] ? 'var(--green)' : 'var(--text2)' }}>
                  <input type="checkbox" checked={!!draft[item.key]}
                    onChange={e => setDraft(d => ({ ...d, [item.key]: e.target.checked }))}
                    style={{ width:16, height:16, accentColor:'var(--green)', cursor:'pointer' }}/>
                  {item.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Closeout Notes</FieldLabel>
            <textarea value={closeNotes} onChange={e=>setCloseNotes(e.target.value)}
              placeholder="Punch list items, outstanding items, special notes…"
              style={{ ...INPUT, height: 80, resize: 'vertical' }}/>
          </div>
          <button className="btn" style={{ fontSize: 13 }} onClick={save}>
            <Icon name="check" size={14} stroke={2}/> Save Closeout
          </button>
        </div>
      );
    }

    return null;
  };

  const PhaseChip = ({ phase }: { phase: PhaseKey }) => {
    const p = PHASES.find(x => x.key === phase)!;
    return (
      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 5,
        background: p.color+'22', color: p.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {p.label}
      </span>
    );
  };

  const PhaseTracker = ({ id, currentPhase }: { id: string; currentPhase: PhaseKey }) => {
    const idx = PHASES.findIndex(p => p.key === currentPhase);
    return (
      <div style={{ display:'flex', alignItems:'center', gap:0, marginTop:14 }}>
        {PHASES.map((p, i) => {
          const done = i < idx, active = i === idx;
          return (
            <React.Fragment key={p.key}>
              <button onClick={e => { e.stopPropagation(); setPhase(id, p.key); }} title={p.label}
                style={{ width:28, height:28, borderRadius:'50%', border:'none', cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800,
                  background: done?p.color:active?p.color:'var(--surface2)',
                  color: (done||active)?'#fff':'var(--text3)',
                  outline: active?`2px solid ${p.color}`:'none', outlineOffset:2, flexShrink:0 }}>
                {done ? <Icon name="check" size={12} stroke={2.5}/> : i+1}
              </button>
              {i < PHASES.length-1 && <div style={{ flex:1, height:2, background: i<idx?PHASES[i].color:'var(--surface2)', minWidth:8 }}/>}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        <div className="stats" style={{ gridTemplateColumns:'repeat(4,1fr)', padding:0, marginBottom:20 }}>
          {[
            { label:'Active Contract Value', val:moneyFull(totalValue),     sub:`${awarded.length} jobs awarded`,    tone:'green' },
            { label:'Jobs In Progress',      val:String(activeCount),        sub:'currently in field',                tone:'blue'  },
            { label:'Jobs Completed',        val:String(doneCount),          sub:'this year',                         tone:'amber' },
            { label:'Avg Job Value',         val:moneyFull(avgVal),          sub:'per awarded contract',              tone:'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic '+s.tone}><Icon name="trend" size={16} stroke={1.9}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, fontWeight:600, color:'var(--text3)' }}>
            <Icon name="filter" size={14} stroke={1.8}/> Phase
            <select value={filterPhase} onChange={e => setFilterPhase(e.target.value as any)}
              style={{ font:'inherit', fontSize:13, fontWeight:700, color:'var(--text)', background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:9, padding:'6px 10px', cursor:'pointer', outline:'none' }}>
              <option value="all">All Phases</option>
              {PHASES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, fontWeight:600, color:'var(--text3)' }}>
            <Icon name="users" size={14} stroke={1.8}/> Rep
            <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
              style={{ font:'inherit', fontSize:13, fontWeight:700, color:'var(--text)', background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:9, padding:'6px 10px', cursor:'pointer', outline:'none' }}>
              <option value="all">All Reps</option>
              {salespeople.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <span style={{ marginLeft:'auto', fontSize:12.5, color:'var(--text3)', fontWeight:600 }}>
            {filtered.length} of {awarded.length} jobs
          </span>
        </div>

        {awarded.length === 0 ? (
          <div style={{ padding:60, textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>
            No awarded jobs yet. Mark bids as Awarded in the Electrical Proposals board.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>
            No jobs match these filters.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {filtered.map(bid => {
              const st       = ensureState(bid);
              const expanded = expandedId === bid.id;

              return (
                <div key={bid.id} className="panel" style={{ cursor:'pointer' }}
                  onClick={() => openProject(bid.id)}>
                  <div style={{ padding:'16px 20px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:'var(--text)', marginBottom:4 }}>{bid.name}</div>
                        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                          <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="building" size={12} stroke={1.8}/>{bid.gc}
                          </span>
                          <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="pin" size={12} stroke={1.8}/>{bid.loc}
                          </span>
                          <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="users" size={12} stroke={1.8}/>{bid.salesperson_name}
                          </span>
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:14, flexShrink:0 }}>
                        <PhaseChip phase={st.phase}/>
                        <span className="num" style={{ fontSize:16, fontWeight:900, color:'var(--text)' }}>{money(bid.amount??0)}</span>
                        <Icon name={expanded?'minus':'plus'} size={16} stroke={2}/>
                      </div>
                    </div>
                    <PhaseTracker id={bid.id} currentPhase={st.phase}/>
                    <div style={{ display:'flex', gap:0, marginTop:6 }}>
                      {PHASES.map((p,i) => (
                        <div key={p.key} style={{ flex:1, fontSize:9, fontWeight:700, color:p.key===st.phase?p.color:'var(--text3)', textAlign:'center', textTransform:'uppercase', letterSpacing:'.03em' }}>
                          {i===0||i===PHASES.length-1||p.key===st.phase ? p.label.split(' ')[0] : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ borderTop:'1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                      {/* Tab bar */}
                      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', paddingLeft:20, overflowX:'auto' }}>
                        {PROJ_TABS.map(tab => (
                          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                            style={{ fontSize:13, fontWeight:700, padding:'12px 16px', border:'none', background:'none',
                              cursor:'pointer', whiteSpace:'nowrap',
                              color: activeTab===tab.key ? 'var(--blue)' : 'var(--text3)',
                              borderBottom: activeTab===tab.key ? '2px solid var(--blue)' : '2px solid transparent',
                              marginBottom:-1 }}>
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      {/* Tab content */}
                      <div style={{ padding:'20px 24px' }}>
                        <TabContent bid={bid}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>{children}</div>;
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:5 }}>{children}</div>;
}
function InfoGrid({ rows }: { rows: [string,string|React.ReactNode][] }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {rows.map(([k,v]) => (
        <div key={k}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>{k}</div>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{v}</div>
        </div>
      ))}
    </div>
  );
}
function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLORS[status]||'var(--text3)';
  return (
    <span style={{ fontSize:10.5, fontWeight:800, padding:'2px 8px', borderRadius:5,
      background:color+'22', color, textTransform:'uppercase', letterSpacing:'.04em' }}>
      {status}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding:'32px 0', textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>{text}</div>;
}
