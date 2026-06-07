import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Icon from '../../components/Icon';
import DriveImage from '../../components/DriveImage';
import { Bid, WonJob, Toast } from '../../types';
import { useShowToast } from '../../contexts/AppContext';
import api from '../../api/client';
import { moneyFull, moneyShort as money } from '../../lib/money';

// ── Phase → Status mapping ───────────────────────────────────────
const FIELD_PHASES = new Set(['rough','inspection','trim','final']);
function phaseStatus(phase: string): 'contracted' | 'active' | 'closed' {
  if (phase === 'complete') return 'closed';
  if (FIELD_PHASES.has(phase)) return 'active';
  return 'contracted';
}
const STATUS_META = {
  contracted: { label: 'Contracted', color: '#7C8AA3' },
  active:     { label: 'Active',     color: '#34C588' },
  closed:     { label: 'Closed',     color: '#9B6DFF' },
} as const;

const ELEC_PHASES = [
  { key: 'signed',     label: 'Contract Signed' },
  { key: 'rough',      label: 'Rough-In'        },
  { key: 'inspection', label: 'Inspection'      },
  { key: 'trim',       label: 'Trim-Out'        },
  { key: 'final',      label: 'Final'           },
  { key: 'complete',   label: 'Complete'        },
] as const;
type ElecPhase = typeof ELEC_PHASES[number]['key'];

const WORKSPACE_TABS = [
  { key: 'overview',       label: 'Overview'       },
  { key: 'financials',     label: 'Financials'     },
  { key: 'change-orders',  label: 'Change Orders'  },
  { key: 'pay-apps',       label: 'Pay Apps'       },
  { key: 'rfis',           label: 'Request Log'    },
  { key: 'key-materials',  label: 'Key Materials'  },
  { key: 'field-notes',    label: 'Field Notes'    },
  { key: 'schedule',       label: 'Schedule'       },
  { key: 'closeout',       label: 'Closeout'       },
  { key: 'photos',         label: 'Photos'         },
  { key: 'docs',           label: 'Documents'      },
  { key: 'comms',          label: 'Comms'          },
] as const;
type WsTab = typeof WORKSPACE_TABS[number]['key'];

// ── Domain types ─────────────────────────────────────────────────
interface ChangeOrder  { id: string; number: number; description: string; amount: number; status: 'pending'|'approved'|'rejected'; submitted_date: string|null; }
interface FieldNote    { id: string; note_date: string|null; author: string; note: string; weather: string; crew_size: number; }
interface ProjectRfi   { id: string; rfi_number: string; question: string; submitted_to: string; submitted_date: string|null; due_date: string|null; status: 'open'|'answered'|'closed'; answer: string; }
interface PayApp       { id: string; number: number; period: string; scheduled_value: number; pct_complete: number; amount_billed: number; status: 'draft'|'submitted'|'approved'|'paid'; }
interface KeyMaterial  { id: string; name: string; supplier: string; po_number: string; order_date: string; eta: string; status: 'pending'|'ordered'|'delivered'; }
interface ProjDoc   { id: string; name: string; display_name: string; category: string; file_size: number; file_type: string; uploaded_by: string; created_at: string; }
interface ProjComm  { id: string; kind: string; subject: string; body: string; author: string; created_at: string; }
interface DrivePhoto { id: string; name: string; mimeType: string; webViewLink?: string; thumbnailLink?: string; size?: string; createdTime?: string; }

// ── Helpers ──────────────────────────────────────────────────────
function fmtDate(s: string|null) {
  if (!s) return '—';
  return new Date(s.split('T')[0]+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

const INPUT: React.CSSProperties = {
  font:'inherit', fontSize:13, fontWeight:600, color:'var(--text)',
  background:'var(--surface)', border:'1px solid var(--border2)',
  borderRadius:9, padding:'8px 12px', outline:'none', width:'100%', boxSizing:'border-box',
};

const STATUS_CO: Record<string,string> = {
  pending:'#E0A53B', approved:'#34C588', rejected:'#E06A6A',
  open:'#4D8DF7', answered:'#34C588', closed:'#7C8AA3',
  draft:'#7C8AA3', submitted:'#4D8DF7', paid:'#34C588',
  ordered:'#4D8DF7', delivered:'#34C588',
};

// ── Project data store (loaded per project) ──────────────────────
interface ProjData {
  cos:      ChangeOrder[];
  fns:      FieldNote[];
  rfis:     ProjectRfi[];
  overview: Record<string,string>;
  schedule: Record<string,string>;
  payApps:  PayApp[];
  keyMats:  KeyMaterial[];
  closeout: Record<string,unknown>;
  docs:     ProjDoc[];
  comms:    ProjComm[];
  photos:   DrivePhoto[];
}
const emptyData = (): ProjData => ({
  cos:[], fns:[], rfis:[], overview:{}, schedule:{}, payApps:[], keyMats:[], closeout:{}, docs:[], comms:[], photos:[],
});

interface Props {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
}

export default function ElecProjectsPage({ bids, setBids, setWonJobs }: Props) {
  const showToast = useShowToast();
  const awarded = useMemo(() => bids.filter(b => b.stage === 'awarded'), [bids]);

  // Phase state (persisted via API)
  const [phases, setPhases] = useState<Record<string, ElecPhase>>(() =>
    Object.fromEntries(awarded.map(b => [b.id, (b.elec_project_phase as ElecPhase)||'signed']))
  );

  // Navigation: null = list, string = workspace
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [activeTab,  setActiveTab]  = useState<WsTab>('overview');

  // Per-project loaded data
  const [projData, setProjData] = useState<Record<string, ProjData>>({});

  const selectedBid = useMemo(() => awarded.find(b => b.id === selectedId) ?? null, [awarded, selectedId]);

  const loadProject = useCallback(async (id: string) => {
    if (projData[id]) return; // already loaded
    const [coRes, fnRes, rfiRes, ovRes, schRes, paRes, kmRes, clRes, docRes, commRes, photoRes] = await Promise.allSettled([
      api.get(`/projects/elec/${id}/change-orders`),
      api.get(`/projects/elec/${id}/field-notes`),
      api.get(`/projects/elec/${id}/rfis`),
      api.get(`/projects/elec/${id}/section/overview`),
      api.get(`/projects/elec/${id}/section/schedule`),
      api.get(`/projects/elec/${id}/section/pay-apps`),
      api.get(`/projects/elec/${id}/section/key-materials`),
      api.get(`/projects/elec/${id}/section/closeout`),
      api.get('/documents'),
      api.get('/comms'),
      api.get(`/bids/${id}/photos`),
    ]);
    setProjData(prev => ({
      ...prev,
      [id]: {
        cos:      coRes.status==='fulfilled'  ? coRes.value.data  : [],
        fns:      fnRes.status==='fulfilled'  ? fnRes.value.data  : [],
        rfis:     rfiRes.status==='fulfilled' ? rfiRes.value.data : [],
        overview: ovRes.status==='fulfilled'  ? ovRes.value.data  : {},
        schedule: schRes.status==='fulfilled' ? schRes.value.data : {},
        payApps:  (paRes.status==='fulfilled' && paRes.value.data?.items) ? paRes.value.data.items : [],
        keyMats:  (kmRes.status==='fulfilled' && kmRes.value.data?.items) ? kmRes.value.data.items : [],
        closeout: clRes.status==='fulfilled'  ? clRes.value.data  : {},
        docs:     docRes.status==='fulfilled'  ? (docRes.value.data as ProjDoc[]).filter(d => (d as any).linked_id === id) : [],
        comms:    commRes.status==='fulfilled' ? (commRes.value.data as ProjComm[]).filter(c => (c as any).linked_id === id) : [],
        photos:   photoRes.status==='fulfilled' ? photoRes.value.data as DrivePhoto[] : [],
      },
    }));
  }, [projData]);

  const openWorkspace = (id: string) => {
    setSelectedId(id);
    setActiveTab('overview');
    loadProject(id);
  };

  const setPhase = (id: string, phase: ElecPhase) => {
    setPhases(prev => ({ ...prev, [id]: phase }));
    api.patch(`/bids/${id}/phase`, { phase }).catch(() => {});
    showToast({ title: 'Status updated', sub: STATUS_META[phaseStatus(phase)].label });
  };

  const deleteProject = async (bid: Bid) => {
    if (!window.confirm(`Delete electrical project "${bid.name}" and its linked files/testing data? This cannot be undone.`)) return;
    try {
      await api.delete(`/bids/${bid.id}`);
      setBids(prev => prev.filter(b => b.id !== bid.id));
      setWonJobs(prev => prev.filter(w => w.proposal_id !== bid.id));
      setSelectedId(null);
      setProjData(prev => {
        const next = { ...prev };
        delete next[bid.id];
        return next;
      });
      showToast({ title: 'Electrical project deleted', sub: bid.name });
    } catch {
      showToast({ title: 'Delete failed', sub: 'Please try again' });
    }
  };

  const updateProjData = (id: string, patch: Partial<ProjData>) =>
    setProjData(prev => ({ ...prev, [id]: { ...(prev[id] ?? emptyData()), ...patch } }));

  // ── Summary stats for list view ──────────────────────────────
  const totalValue = awarded.reduce((s, b) => s + Number(b.amount??0), 0);

  // ── Workspace views ──────────────────────────────────────────
  if (selectedId && selectedBid) {
    return <Workspace
      bid={selectedBid}
      phase={phases[selectedBid.id]||'signed'}
      data={projData[selectedBid.id] ?? emptyData()}
      activeTab={activeTab}
      onBack={() => setSelectedId(null)}
      onTabChange={setActiveTab}
      onPhaseChange={phase => setPhase(selectedBid.id, phase)}
      onDataChange={patch => updateProjData(selectedBid.id, patch)}
      onDelete={() => deleteProject(selectedBid)}
      showToast={showToast}
    />;
  }

  // ── List view ────────────────────────────────────────────────
  return (
    <div className="scroll view-enter">
      <div style={{ padding:'20px 28px 40px' }}>
        {/* Stats row */}
        <div className="stats" style={{ gridTemplateColumns:'repeat(4,1fr)', padding:0, marginBottom:24 }}>
          {[
            { label:'Active Contract Value', val:moneyFull(totalValue),
              sub:`${awarded.length} jobs awarded`, tone:'green' },
            { label:'In Progress',
              val:String(awarded.filter(b => FIELD_PHASES.has(phases[b.id]??'signed')).length),
              sub:'currently in field', tone:'blue' },
            { label:'Completed',
              val:String(awarded.filter(b => (phases[b.id]??'signed')==='complete').length),
              sub:'this year', tone:'amber' },
            { label:'Contracted',
              val:String(awarded.filter(b => (phases[b.id]??'signed')==='signed').length),
              sub:'not yet mobilized', tone:'green' },
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

        <div style={{ fontSize:13, fontWeight:700, color:'var(--text3)', marginBottom:14 }}>
          {awarded.length} project{awarded.length!==1?'s':''} · {money(totalValue)} total contract value
        </div>

        {awarded.length === 0 ? (
          <div style={{ padding:60, textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>
            No awarded jobs yet. Mark bids as Awarded in the Electrical Proposals board.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {awarded.map(bid => {
              const phase  = phases[bid.id] ?? 'signed';
              const status = phaseStatus(phase);
              const smeta  = STATUS_META[status];
              // CO badges come from projData if loaded
              const pd = projData[bid.id];
              const approvedCOs = pd ? pd.cos.filter(c=>c.status==='approved') : [];
              const pendingCOs  = pd ? pd.cos.filter(c=>c.status==='pending')  : [];
              const coApprovedVal = approvedCOs.reduce((s,c)=>s+Number(c.amount),0);

              return (
                <div key={bid.id} className="panel" style={{ padding:'18px 22px', cursor:'pointer' }} onClick={() => openWorkspace(bid.id)}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:16, fontWeight:800, color:'var(--text)', marginBottom:6 }}>
                        {bid.name}
                      </div>
                      <div style={{ display:'flex', gap:14, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                        <span style={{ fontSize:12.5, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                          <Icon name="building" size={12} stroke={1.8}/>{bid.gc}
                        </span>
                        <span style={{ fontSize:12.5, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                          <Icon name="pin" size={12} stroke={1.8}/>{bid.loc}
                        </span>
                        {bid.salesperson_name && (
                          <span style={{ fontSize:12.5, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="users" size={12} stroke={1.8}/>{bid.salesperson_name}
                          </span>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        {/* Status chip */}
                        <span style={{ fontSize:11, fontWeight:800, padding:'3px 10px', borderRadius:6,
                          background:smeta.color+'22', color:smeta.color,
                          textTransform:'uppercase', letterSpacing:'.04em' }}>
                          {smeta.label}
                        </span>
                        {/* CO badges (only if data loaded) */}
                        {approvedCOs.length > 0 && (
                          <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:6,
                            background:'var(--green-soft)', color:'var(--green)',
                            display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="check" size={10} stroke={2.5}/>{moneyFull(coApprovedVal)} in approved COs
                          </span>
                        )}
                        {pendingCOs.length > 0 && (
                          <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:6,
                            background:'var(--amber-soft)', color:'var(--amber)',
                            display:'flex', alignItems:'center', gap:5 }}>
                            ⓘ {pendingCOs.length} pending CO{pendingCOs.length!==1?'s':''}
                          </span>
                        )}
                        {bid.sheets > 0 && (
                          <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginLeft:4 }}>
                            {bid.sheets} sheets
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:10, flexShrink:0 }}>
                      <span className="num" style={{ fontSize:17, fontWeight:900, color:'var(--text)' }}>
                        {moneyFull(bid.amount??0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Workspace component
// ─────────────────────────────────────────────────────────────────
interface WsProps {
  bid: Bid;
  phase: ElecPhase;
  data: ProjData;
  activeTab: WsTab;
  onBack: () => void;
  onTabChange: (t: WsTab) => void;
  onPhaseChange: (p: ElecPhase) => void;
  onDataChange: (patch: Partial<ProjData>) => void;
  onDelete: () => void;
  showToast: (t: Toast) => void;
}

function Workspace({ bid, phase, data, activeTab, onBack, onTabChange, onPhaseChange, onDataChange, onDelete, showToast }: WsProps) {
  const id     = bid.id;
  const status = phaseStatus(phase);
  const smeta  = STATUS_META[status];
  const contractVal = Number(bid.amount??0);

  const coApproved = data.cos.filter(c=>c.status==='approved').reduce((s,c)=>s+Number(c.amount),0);
  const coPending  = data.cos.filter(c=>c.status==='pending').reduce((s,c)=>s+Number(c.amount),0);

  // ── form state for new items ─────────────────────────────────
  const [coForm,  setCoForm]  = useState({ description:'', amount:'', status:'pending', submitted_date:'' });
  const [fnForm,  setFnForm]  = useState({ note:'', note_date:'', weather:'', crew_size:'' });
  const [rfiForm, setRfiForm] = useState({ question:'', submitted_to:'', submitted_date:'', due_date:'' });
  const [paForm,  setPaForm]  = useState({ period:'', scheduled_value:'', pct_complete:'', amount_billed:'', status:'draft' });
  const [kmForm,  setKmForm]  = useState({ name:'', supplier:'', po_number:'', order_date:'', eta:'', status:'pending' });

  // ── Overview section editable state ─────────────────────────
  const [ovDraft, setOvDraft]   = useState<Record<string,string>>(data.overview);
  const [schDraft, setSchDraft] = useState<Record<string,string>>(data.schedule);

  useEffect(() => { setOvDraft(data.overview); }, [data.overview]);
  useEffect(() => { setSchDraft(data.schedule); }, [data.schedule]);

  const saveSection = async (section: string, payload: unknown) => {
    await api.put(`/projects/elec/${id}/section/${section}`, { data: payload });
    showToast({ title: 'Saved' });
  };

  // ── Closeout ─────────────────────────────────────────────────
  const CLOSEOUT_ITEMS = [
    { key:'as_builts',     label:'As-Built Drawings'     },
    { key:'om_manuals',    label:'O&M Manuals'           },
    { key:'test_reports',  label:'Test Reports'          },
    { key:'permit_final',  label:'Permit Final'          },
    { key:'warranty',      label:'Warranty Letters'      },
    { key:'lien_waivers',  label:'Lien Waivers'         },
    { key:'final_invoice', label:'Final Invoice Sent'    },
    { key:'payment',       label:'Payment Received'      },
  ];
  const [clDraft, setClDraft] = useState<Record<string,unknown>>(data.closeout);
  const [clNotes, setClNotes] = useState((data.closeout.notes as string)||'');
  useEffect(() => { setClDraft(data.closeout); setClNotes((data.closeout.notes as string)||''); }, [data.closeout]);
  const clDone = CLOSEOUT_ITEMS.filter(i=>!!clDraft[i.key]).length;

  const renderTab = () => {
    switch (activeTab) {

      // ── Overview ─────────────────────────────────────────────
      case 'overview': return (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
          {/* Left col */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <SCard title="Contract Overview" icon="doc">
              <EditGrid fields={[
                { label:'General Contractor', key:'gc',              val:ovDraft.gc||bid.gc },
                { label:'Location',           key:'location',        val:ovDraft.location||bid.loc },
                { label:'Project Manager',    key:'project_manager', val:ovDraft.project_manager||'' },
                { label:'Contract Date',      key:'contract_date',   val:ovDraft.contract_date||'', type:'date' },
                { label:'Contract Value',     key:'_contract_val',   val:moneyFull(contractVal), readonly:true },
                { label:'Retainage',          key:'retainage',       val:ovDraft.retainage||'', placeholder:'e.g. 10%' },
              ]} onChange={(k,v) => setOvDraft(d=>({...d,[k]:v}))}/>
              <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end' }}>
                <button className="btn ghost" style={{ fontSize:12, height:34 }}
                  onClick={async () => { await saveSection('overview', ovDraft); onDataChange({ overview: ovDraft }); }}>
                  <Icon name="check" size={13} stroke={2}/> Save
                </button>
              </div>
            </SCard>

            <SCard title="Scope of Work" icon="doc">
              <textarea value={ovDraft.scope_of_work||''}
                onChange={e=>setOvDraft(d=>({...d,scope_of_work:e.target.value}))}
                placeholder="Describe the full scope of electrical work…"
                style={{ ...INPUT, height:100, resize:'vertical' }}/>
              <div style={{ marginTop:10, display:'flex', justifyContent:'flex-end' }}>
                <button className="btn ghost" style={{ fontSize:12, height:34 }}
                  onClick={async () => { await saveSection('overview', ovDraft); onDataChange({ overview: ovDraft }); }}>
                  <Icon name="check" size={13} stroke={2}/> Save
                </button>
              </div>
            </SCard>
          </div>

          {/* Right col */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <SCard title="Schedule" icon="clock">
              <EditGrid fields={[
                { label:'Contract Date',      key:'contract_date',    val:schDraft.contract_date||'',    type:'date' },
                { label:'Start Date',         key:'start_date',       val:schDraft.start_date||'',       type:'date' },
                { label:'Est. Completion',    key:'est_completion',   val:schDraft.est_completion||'',   type:'date' },
                { label:'Mobilization Date',  key:'mobilize',         val:schDraft.mobilize||'',         type:'date' },
                { label:'Rough-In Complete',  key:'rough_done',       val:schDraft.rough_done||'',       type:'date' },
                { label:'Inspection Date',    key:'inspection',       val:schDraft.inspection||'',       type:'date' },
                { label:'Closeout Due',       key:'closeout',         val:schDraft.closeout||'',         type:'date' },
              ]} onChange={(k,v) => setSchDraft(d=>({...d,[k]:v}))}/>
              <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end' }}>
                <button className="btn ghost" style={{ fontSize:12, height:34 }}
                  onClick={async () => { await saveSection('schedule', schDraft); onDataChange({ schedule: schDraft }); }}>
                  <Icon name="check" size={13} stroke={2}/> Save
                </button>
              </div>
            </SCard>

            <SCard title="Quick Financials" icon="dollar">
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <FinRow label="Original Contract"      val={moneyFull(contractVal)}              />
                <FinRow label="Approved Change Orders" val={moneyFull(coApproved)} color="var(--green)"/>
                <FinRow label="Pending Change Orders"  val={`${data.cos.filter(c=>c.status==='pending').length} pending`} color="var(--amber)"/>
                <div style={{ height:1, background:'var(--border)', margin:'4px 0' }}/>
                <FinRow label="Adjusted Total" val={moneyFull(contractVal+coApproved)} bold/>
              </div>
            </SCard>
          </div>
        </div>
      );

      // ── Financials ───────────────────────────────────────────
      case 'financials': return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
            {[
              { label:'Original Contract', val:moneyFull(contractVal),           color:'var(--blue)'  },
              { label:'Approved COs',      val:moneyFull(coApproved),            color:'var(--green)' },
              { label:'Revised Total',     val:moneyFull(contractVal+coApproved),color:'var(--text)'  },
              { label:'Pending COs',       val:moneyFull(coPending),             color:'var(--amber)' },
            ].map(f => (
              <div key={f.label} style={{ background:'var(--surface2)', borderRadius:10, padding:'14px 16px' }}>
                <FL>{f.label}</FL>
                <div className="num" style={{ fontSize:20, fontWeight:900, color:f.color }}>{f.val}</div>
              </div>
            ))}
          </div>
          {data.cos.length > 0 && (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {data.cos.map(co => (
                    <tr key={co.id}>
                      <td className="sub">CO-{String(co.number).padStart(3,'0')}</td>
                      <td><span className="nm">{co.description}</span></td>
                      <td className="num" style={{ color:co.amount>=0?'var(--green)':'#E06A6A' }}>
                        {co.amount>=0?'+':''}{moneyFull(co.amount)}
                      </td>
                      <td><StatusPill status={co.status}/></td>
                      <td className="sub">{fmtDate(co.submitted_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.cos.length === 0 && <Empty text="No change orders yet"/>}
        </div>
      );

      // ── Change Orders ────────────────────────────────────────
      case 'change-orders': return (
        <div>
          <div className="panel" style={{ marginBottom:16, padding:'18px 20px' }}>
            <SL>New Change Order</SL>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
              <div><FL>Description</FL><input value={coForm.description} onChange={e=>setCoForm(f=>({...f,description:e.target.value}))} placeholder="CO description…" style={INPUT}/></div>
              <div><FL>Amount ($)</FL><input type="number" value={coForm.amount} onChange={e=>setCoForm(f=>({...f,amount:e.target.value}))} placeholder="0" style={INPUT}/></div>
              <div><FL>Status</FL>
                <select value={coForm.status} onChange={e=>setCoForm(f=>({...f,status:e.target.value}))} style={{...INPUT,cursor:'pointer'}}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div><FL>Submitted</FL><input type="date" value={coForm.submitted_date} onChange={e=>setCoForm(f=>({...f,submitted_date:e.target.value}))} style={INPUT}/></div>
              <button className="btn" style={{ fontSize:13 }}
                onClick={async () => {
                  if (!coForm.description.trim()) { showToast({title:'Description required'}); return; }
                  const res = await api.post(`/projects/elec/${id}/change-orders`, {
                    description:coForm.description, amount:Number(coForm.amount)||0,
                    status:coForm.status, submitted_date:coForm.submitted_date||null,
                  });
                  onDataChange({ cos:[...data.cos, res.data] });
                  setCoForm({description:'',amount:'',status:'pending',submitted_date:''});
                  showToast({title:'Change order added'});
                }}>
                <Icon name="plus" size={14} stroke={2.2}/> Add
              </button>
            </div>
          </div>
          {data.cos.length === 0 ? <Empty text="No change orders yet"/> : (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
                <tbody>
                  {data.cos.map(co => (
                    <tr key={co.id}>
                      <td className="sub">CO-{String(co.number).padStart(3,'0')}</td>
                      <td><span className="nm">{co.description}</span></td>
                      <td className="num" style={{ color:co.amount>=0?'var(--green)':'#E06A6A' }}>
                        {co.amount>=0?'+':''}{moneyFull(co.amount)}
                      </td>
                      <td>
                        <select value={co.status}
                          onChange={async e => {
                            await api.patch(`/projects/elec/${id}/change-orders/${co.id}`,{status:e.target.value});
                            onDataChange({cos:data.cos.map(c=>c.id===co.id?{...c,status:e.target.value as any}:c)});
                            showToast({title:'Status updated'});
                          }}
                          style={{font:'inherit',fontSize:12,fontWeight:700,border:'none',background:'transparent',
                            color:STATUS_CO[co.status]||'var(--text)',cursor:'pointer',outline:'none'}}>
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td className="sub">{fmtDate(co.submitted_date)}</td>
                      <td>
                        <button onClick={async()=>{
                          await api.delete(`/projects/elec/${id}/change-orders/${co.id}`);
                          onDataChange({cos:data.cos.filter(c=>c.id!==co.id)});
                          showToast({title:'Removed'});
                        }} style={{border:'none',background:'none',cursor:'pointer',color:'var(--text3)',padding:4}}>
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

      // ── Pay Apps ─────────────────────────────────────────────
      case 'pay-apps': return (
        <div>
          <div className="panel" style={{ marginBottom:16, padding:'18px 20px' }}>
            <SL>New Pay Application</SL>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
              <div><FL>Period</FL><input value={paForm.period} onChange={e=>setPaForm(f=>({...f,period:e.target.value}))} placeholder="e.g. June 2026" style={INPUT}/></div>
              <div><FL>Scheduled Value ($)</FL><input type="number" value={paForm.scheduled_value} onChange={e=>setPaForm(f=>({...f,scheduled_value:e.target.value}))} placeholder="0" style={INPUT}/></div>
              <div><FL>% Complete</FL><input type="number" value={paForm.pct_complete} onChange={e=>setPaForm(f=>({...f,pct_complete:e.target.value}))} placeholder="0" style={INPUT}/></div>
              <div><FL>Amount Billed ($)</FL><input type="number" value={paForm.amount_billed} onChange={e=>setPaForm(f=>({...f,amount_billed:e.target.value}))} placeholder="0" style={INPUT}/></div>
              <div><FL>Status</FL>
                <select value={paForm.status} onChange={e=>setPaForm(f=>({...f,status:e.target.value}))} style={{...INPUT,cursor:'pointer'}}>
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <button className="btn" style={{ fontSize:13 }}
                onClick={async () => {
                  if (!paForm.period.trim()) { showToast({title:'Period required'}); return; }
                  const newPa: PayApp = {
                    id: Date.now().toString(),
                    number: data.payApps.length + 1,
                    period: paForm.period,
                    scheduled_value: Number(paForm.scheduled_value)||0,
                    pct_complete: Number(paForm.pct_complete)||0,
                    amount_billed: Number(paForm.amount_billed)||0,
                    status: paForm.status as any,
                  };
                  const updated = [...data.payApps, newPa];
                  await api.put(`/projects/elec/${id}/section/pay-apps`, { data:{items:updated} });
                  onDataChange({payApps:updated});
                  setPaForm({period:'',scheduled_value:'',pct_complete:'',amount_billed:'',status:'draft'});
                  showToast({title:'Pay app added'});
                }}>
                <Icon name="plus" size={14} stroke={2.2}/> Add
              </button>
            </div>
          </div>
          {data.payApps.length === 0 ? <Empty text="No pay applications yet"/> : (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>App #</th><th>Period</th><th>Scheduled Value</th><th>% Complete</th><th>Amount Billed</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.payApps.map(pa => (
                    <tr key={pa.id}>
                      <td className="sub">#{pa.number}</td>
                      <td><span className="nm">{pa.period}</span></td>
                      <td className="num">{moneyFull(pa.scheduled_value)}</td>
                      <td className="num">{pa.pct_complete}%</td>
                      <td className="num">{moneyFull(pa.amount_billed)}</td>
                      <td><StatusPill status={pa.status}/></td>
                      <td>
                        <button onClick={async()=>{
                          const updated = data.payApps.filter(p=>p.id!==pa.id);
                          await api.put(`/projects/elec/${id}/section/pay-apps`,{data:{items:updated}});
                          onDataChange({payApps:updated});
                          showToast({title:'Removed'});
                        }} style={{border:'none',background:'none',cursor:'pointer',color:'var(--text3)',padding:4}}>
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

      // ── Request Log (RFIs) ────────────────────────────────────
      case 'rfis': return (
        <div>
          <div className="panel" style={{ marginBottom:16, padding:'18px 20px' }}>
            <SL>Submit RFI</SL>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:10, marginBottom:10 }}>
              <div><FL>Question</FL><input value={rfiForm.question} onChange={e=>setRfiForm(f=>({...f,question:e.target.value}))} placeholder="Describe the information request…" style={INPUT}/></div>
              <div><FL>Submitted To</FL><input value={rfiForm.submitted_to} onChange={e=>setRfiForm(f=>({...f,submitted_to:e.target.value}))} placeholder="GC / Architect" style={INPUT}/></div>
              <div><FL>Submitted</FL><input type="date" value={rfiForm.submitted_date} onChange={e=>setRfiForm(f=>({...f,submitted_date:e.target.value}))} style={INPUT}/></div>
              <div><FL>Due Date</FL><input type="date" value={rfiForm.due_date} onChange={e=>setRfiForm(f=>({...f,due_date:e.target.value}))} style={INPUT}/></div>
            </div>
            <button className="btn" style={{ fontSize:13 }}
              onClick={async()=>{
                if (!rfiForm.question.trim()) { showToast({title:'Question required'}); return; }
                const res = await api.post(`/projects/elec/${id}/rfis`,{
                  question:rfiForm.question, submitted_to:rfiForm.submitted_to,
                  submitted_date:rfiForm.submitted_date||null, due_date:rfiForm.due_date||null,
                });
                onDataChange({rfis:[res.data,...data.rfis]});
                setRfiForm({question:'',submitted_to:'',submitted_date:'',due_date:''});
                showToast({title:'RFI submitted'});
              }}>
              <Icon name="plus" size={14} stroke={2.2}/> Submit RFI
            </button>
          </div>
          {data.rfis.length === 0 ? <Empty text="No RFIs yet"/> : (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>RFI #</th><th>Question</th><th>To</th><th>Submitted</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {data.rfis.map(rfi => (
                    <tr key={rfi.id}>
                      <td className="sub" style={{fontWeight:800}}>{rfi.rfi_number}</td>
                      <td><span className="nm">{rfi.question}</span></td>
                      <td className="sub">{rfi.submitted_to||'—'}</td>
                      <td className="sub">{fmtDate(rfi.submitted_date)}</td>
                      <td className="sub">{fmtDate(rfi.due_date)}</td>
                      <td>
                        <select value={rfi.status}
                          onChange={async e=>{
                            await api.patch(`/projects/elec/${id}/rfis/${rfi.id}`,{status:e.target.value});
                            onDataChange({rfis:data.rfis.map(r=>r.id===rfi.id?{...r,status:e.target.value as any}:r)});
                          }}
                          style={{font:'inherit',fontSize:12,fontWeight:700,border:'none',background:'transparent',
                            color:STATUS_CO[rfi.status]||'var(--text)',cursor:'pointer',outline:'none'}}>
                          <option value="open">Open</option>
                          <option value="answered">Answered</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );

      // ── Key Materials ─────────────────────────────────────────
      case 'key-materials': return (
        <div>
          <div className="panel" style={{ marginBottom:16, padding:'18px 20px' }}>
            <SL>Add Material</SL>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
              <div><FL>Material</FL><input value={kmForm.name} onChange={e=>setKmForm(f=>({...f,name:e.target.value}))} placeholder="e.g. 4000A Switchgear" style={INPUT}/></div>
              <div><FL>Supplier</FL><input value={kmForm.supplier} onChange={e=>setKmForm(f=>({...f,supplier:e.target.value}))} placeholder="Supplier name" style={INPUT}/></div>
              <div><FL>PO Number</FL><input value={kmForm.po_number} onChange={e=>setKmForm(f=>({...f,po_number:e.target.value}))} placeholder="PO-001" style={INPUT}/></div>
              <div><FL>Order Date</FL><input type="date" value={kmForm.order_date} onChange={e=>setKmForm(f=>({...f,order_date:e.target.value}))} style={INPUT}/></div>
              <div><FL>ETA</FL><input type="date" value={kmForm.eta} onChange={e=>setKmForm(f=>({...f,eta:e.target.value}))} style={INPUT}/></div>
              <div><FL>Status</FL>
                <select value={kmForm.status} onChange={e=>setKmForm(f=>({...f,status:e.target.value}))} style={{...INPUT,cursor:'pointer'}}>
                  <option value="pending">Pending</option>
                  <option value="ordered">Ordered</option>
                  <option value="delivered">Delivered</option>
                </select>
              </div>
              <button className="btn" style={{ fontSize:13 }}
                onClick={async()=>{
                  if (!kmForm.name.trim()) { showToast({title:'Material name required'}); return; }
                  const newKm: KeyMaterial = { id:Date.now().toString(), ...kmForm as any };
                  const updated = [...data.keyMats, newKm];
                  await api.put(`/projects/elec/${id}/section/key-materials`,{data:{items:updated}});
                  onDataChange({keyMats:updated});
                  setKmForm({name:'',supplier:'',po_number:'',order_date:'',eta:'',status:'pending'});
                  showToast({title:'Material added'});
                }}>
                <Icon name="plus" size={14} stroke={2.2}/> Add
              </button>
            </div>
          </div>
          {data.keyMats.length === 0 ? <Empty text="No key materials tracked yet"/> : (
            <div className="panel">
              <table className="ctable">
                <thead><tr><th>Material</th><th>Supplier</th><th>PO #</th><th>Order Date</th><th>ETA</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.keyMats.map(km => (
                    <tr key={km.id}>
                      <td><span className="nm">{km.name}</span></td>
                      <td className="sub">{km.supplier||'—'}</td>
                      <td className="sub">{km.po_number||'—'}</td>
                      <td className="sub">{fmtDate(km.order_date)}</td>
                      <td className="sub">{fmtDate(km.eta)}</td>
                      <td><StatusPill status={km.status}/></td>
                      <td>
                        <button onClick={async()=>{
                          const updated = data.keyMats.filter(m=>m.id!==km.id);
                          await api.put(`/projects/elec/${id}/section/key-materials`,{data:{items:updated}});
                          onDataChange({keyMats:updated});
                          showToast({title:'Removed'});
                        }} style={{border:'none',background:'none',cursor:'pointer',color:'var(--text3)',padding:4}}>
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

      // ── Field Notes ───────────────────────────────────────────
      case 'field-notes': return (
        <div>
          <div className="panel" style={{ marginBottom:16, padding:'18px 20px' }}>
            <SL>Add Field Note</SL>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
              <div><FL>Date</FL><input type="date" value={fnForm.note_date} onChange={e=>setFnForm(f=>({...f,note_date:e.target.value}))} style={INPUT}/></div>
              <div><FL>Weather</FL><input value={fnForm.weather} onChange={e=>setFnForm(f=>({...f,weather:e.target.value}))} placeholder="e.g. Sunny 82°F" style={INPUT}/></div>
              <div><FL>Crew Size</FL><input type="number" value={fnForm.crew_size} onChange={e=>setFnForm(f=>({...f,crew_size:e.target.value}))} placeholder="0" style={INPUT}/></div>
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <FL>Note</FL>
                <textarea value={fnForm.note} onChange={e=>setFnForm(f=>({...f,note:e.target.value}))}
                  placeholder="Daily progress, site conditions, work completed…"
                  style={{ ...INPUT, height:72, resize:'vertical' }}/>
              </div>
              <button className="btn" style={{ fontSize:13, whiteSpace:'nowrap' }}
                onClick={async()=>{
                  if (!fnForm.note.trim()) { showToast({title:'Note required'}); return; }
                  const res = await api.post(`/projects/elec/${id}/field-notes`,{
                    note:fnForm.note, note_date:fnForm.note_date||null,
                    weather:fnForm.weather, crew_size:Number(fnForm.crew_size)||0,
                  });
                  onDataChange({fns:[res.data,...data.fns]});
                  setFnForm({note:'',note_date:'',weather:'',crew_size:''});
                  showToast({title:'Field note added'});
                }}>
                <Icon name="plus" size={14} stroke={2.2}/> Add Note
              </button>
            </div>
          </div>
          {data.fns.length === 0 ? <Empty text="No field notes yet"/> : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {data.fns.map(fn => (
                <div key={fn.id} className="panel" style={{ padding:'14px 18px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                    <div style={{ display:'flex', gap:16, alignItems:'center' }}>
                      <span style={{ fontSize:13, fontWeight:800, color:'var(--text)' }}>{fmtDate(fn.note_date)}</span>
                      {fn.weather && <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>{fn.weather}</span>}
                      {fn.crew_size > 0 && <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}><Icon name="users" size={11} stroke={1.8}/> {fn.crew_size} crew</span>}
                      <span style={{ fontSize:12, color:'var(--text3)', fontWeight:600 }}>by {fn.author}</span>
                    </div>
                    <button onClick={async()=>{
                      await api.delete(`/projects/elec/${id}/field-notes/${fn.id}`);
                      onDataChange({fns:data.fns.filter(n=>n.id!==fn.id)});
                      showToast({title:'Note removed'});
                    }} style={{border:'none',background:'none',cursor:'pointer',color:'var(--text3)',padding:4}}>
                      <Icon name="x" size={13} stroke={2}/>
                    </button>
                  </div>
                  <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{fn.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );

      // ── Schedule ──────────────────────────────────────────────
      case 'schedule': return (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:16 }}>
            {[
              { label:'Mobilization Date',    key:'mobilize'   },
              { label:'Rough-In Complete',    key:'rough_done' },
              { label:'Inspection Date',      key:'inspection' },
              { label:'Trim-Out Start',       key:'trim_start' },
              { label:'Substantial Complete', key:'sub_comp'   },
              { label:'Final Walkthrough',    key:'final_walk' },
              { label:'Closeout Package Due', key:'closeout'   },
            ].map(m => (
              <div key={m.key}>
                <FL>{m.label}</FL>
                <input type="date" value={schDraft[m.key]||''} onChange={e=>setSchDraft(d=>({...d,[m.key]:e.target.value}))} style={INPUT}/>
              </div>
            ))}
          </div>
          <button className="btn" style={{ fontSize:13 }}
            onClick={async()=>{ await saveSection('schedule',schDraft); onDataChange({schedule:schDraft}); }}>
            <Icon name="check" size={14} stroke={2}/> Save Schedule
          </button>
        </div>
      );

      // ── Closeout ──────────────────────────────────────────────
      case 'closeout': {
        return (
          <div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text3)', marginBottom:10 }}>
                {clDone} / {CLOSEOUT_ITEMS.length} items complete
              </div>
              <div style={{ height:6, background:'var(--surface2)', borderRadius:4, overflow:'hidden', marginBottom:18 }}>
                <div style={{ height:'100%', width:`${(clDone/CLOSEOUT_ITEMS.length)*100}%`,
                  background:clDone===CLOSEOUT_ITEMS.length?'var(--green)':'var(--blue)', borderRadius:4, transition:'width .3s' }}/>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
                {CLOSEOUT_ITEMS.map(item => (
                  <label key={item.key} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer',
                    background:clDraft[item.key]?'var(--green-soft)':'var(--surface2)', borderRadius:8,
                    padding:'10px 14px', fontSize:13, fontWeight:700,
                    color:clDraft[item.key]?'var(--green)':'var(--text2)' }}>
                    <input type="checkbox" checked={!!clDraft[item.key]}
                      onChange={e=>setClDraft(d=>({...d,[item.key]:e.target.checked}))}
                      style={{width:16,height:16,accentColor:'var(--green)',cursor:'pointer'}}/>
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <FL>Closeout Notes</FL>
              <textarea value={clNotes} onChange={e=>setClNotes(e.target.value)}
                placeholder="Punch list items, outstanding items, special notes…"
                style={{ ...INPUT, height:80, resize:'vertical' }}/>
            </div>
            <button className="btn" style={{ fontSize:13 }}
              onClick={async()=>{
                const payload = {...clDraft, notes:clNotes};
                await saveSection('closeout',payload);
                onDataChange({closeout:payload});
              }}>
              <Icon name="check" size={14} stroke={2}/> Save Closeout
            </button>
          </div>
        );
      }

      case 'photos':
        return <PhotosTab bid={bid} photos={data.photos} onPhotosChange={photos => onDataChange({ photos })} showToast={showToast}/>;
      case 'docs':
        return <DocsTab id={id} docs={data.docs} onDocsChange={docs => onDataChange({ docs })} showToast={showToast} bid={bid}/>;

      case 'comms':
        return <CommsTab id={id} comms={data.comms} onCommsChange={comms => onDataChange({ comms })} showToast={showToast} bid={bid}/>;

      default: return null;
    }
  };

  return (
    <div className="scroll view-enter" style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Workspace header */}
      <div style={{ padding:'0 28px', borderBottom:'1px solid var(--border)', background:'var(--panel)' }}>
        {/* Top row */}
        <div style={{ display:'flex', alignItems:'center', gap:16, paddingTop:16, paddingBottom:14 }}>
          <button onClick={onBack}
            style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:700,
              color:'var(--text3)', background:'none', border:'none', cursor:'pointer', padding:'4px 0', flexShrink:0 }}>
            <Icon name="arrow" size={14} stroke={2} style={{ transform:'rotate(180deg)' }}/> Projects
          </button>
          <div style={{ width:1, height:20, background:'var(--border)' }}/>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ fontSize:16, fontWeight:800, color:'var(--text)' }}>{bid.name}</span>
            <span style={{ fontSize:13, color:'var(--text3)', fontWeight:600, marginLeft:10 }}>
              {bid.gc} · {bid.loc}
            </span>
          </div>
          {/* Status buttons */}
          <div style={{ display:'flex', gap:4, flexShrink:0 }}>
            {(['contracted','active','closed'] as const).map(s => {
              const m = STATUS_META[s];
              const active = status === s;
              const phaseForStatus: ElecPhase = s==='contracted'?'signed':s==='active'?'rough':'complete';
              return (
                <button key={s} onClick={() => onPhaseChange(phaseForStatus)}
                  style={{ fontSize:12.5, fontWeight:700, padding:'6px 14px', borderRadius:8, border:'none',
                    cursor:'pointer', background:active?m.color+'22':'var(--surface2)',
                    color:active?m.color:'var(--text3)' }}>
                  {m.label}
                </button>
              );
            })}
          </div>
          <span className="num" style={{ fontSize:18, fontWeight:900, color:'var(--text)', flexShrink:0 }}>
            {moneyFull(contractVal + coApproved)}
          </span>
          <button className="btn ghost"
            style={{ height: 32, fontSize: 12, padding: '0 10px', color: '#E06A6A', borderColor: 'rgba(224,106,106,.45)', flexShrink: 0 }}
            onClick={onDelete}>
            <Icon name="x" size={13} stroke={2}/>Delete
          </button>
        </div>
        {/* Tab bar */}
        <div style={{ display:'flex', overflowX:'auto' }}>
          {WORKSPACE_TABS.map(tab => (
            <button key={tab.key} onClick={() => onTabChange(tab.key)}
              style={{ fontSize:13, fontWeight:700, padding:'10px 16px', border:'none', background:'none',
                cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
                color:activeTab===tab.key?'var(--blue)':'var(--text3)',
                borderBottom:activeTab===tab.key?'2px solid var(--blue)':'2px solid transparent',
                marginBottom:-1 }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {/* Tab content */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px' }}>
        {renderTab()}
      </div>
    </div>
  );
}

function PhotosTab({ bid, photos, onPhotosChange, showToast }: {
  bid: Bid; photos: DrivePhoto[];
  onPhotosChange: (p: DrivePhoto[]) => void;
  showToast: (t: Toast) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<DrivePhoto | null>(null);

  const isImage = (m: string) => m.startsWith('image/');
  const fmtSize = (s?: string) => {
    if (!s) return '';
    const n = parseInt(s);
    return isNaN(n) ? '' : n >= 1048576 ? ` · ${(n/1048576).toFixed(1)} MB` : ` · ${Math.round(n/1024)} KB`;
  };
  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const form = new FormData();
        form.append('file', f);
        form.append('linked_id', bid.id);
        form.append('linked_name', bid.name);
        form.append('div', 'elec');
        form.append('category', 'photo');
        await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      // Refresh photos list from Drive
      const { data } = await api.get(`/bids/${bid.id}/photos`);
      onPhotosChange(data);
      showToast({ title: `${files.length} photo${files.length > 1 ? 's' : ''} uploaded` });
    } catch {
      showToast({ title: 'Upload failed', sub: 'Try again' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <input ref={fileRef} type="file" multiple accept="image/*,video/*" style={{ display:'none' }}
        onChange={e => upload(Array.from(e.target.files ?? []))}/>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div style={{ fontSize:13, color:'var(--text3)', fontWeight:600 }}>
          {photos.length > 0 ? `${photos.length} photo${photos.length !== 1 ? 's' : ''} from Drive` : 'No photos in Drive folder yet'}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {bid.drive_photos_folder_id && (
            <a href={`https://drive.google.com/drive/folders/${bid.drive_photos_folder_id}`} target="_blank" rel="noreferrer"
              className="btn ghost" style={{ fontSize:12, height:34, padding:'0 12px', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
              <Icon name="cloud" size={13} stroke={1.8}/>Open Drive Folder
            </a>
          )}
          <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ fontSize:12, height:34, padding:'0 12px' }}>
            <Icon name="cloudup" size={13} stroke={1.9}/>{uploading ? 'Uploading…' : 'Upload Photos'}
          </button>
        </div>
      </div>

      {photos.length === 0 ? (
        <div style={{ padding:'48px 0', textAlign:'center', border:'1.5px dashed var(--border2)', borderRadius:12 }}>
          <div style={{ width:52, height:52, borderRadius:14, background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
            <Icon name="clip" size={22} stroke={1.6} style={{ color:'var(--text3)' }}/>
          </div>
          <div style={{ fontSize:13.5, fontWeight:700, color:'var(--text2)', marginBottom:5 }}>No photos yet</div>
          <div style={{ fontSize:12.5, color:'var(--text3)', fontWeight:600 }}>
            Upload photos here or add them directly to the Drive folder.
          </div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:12 }}>
          {photos.map(p => (
            <div key={p.id}
              onClick={() => p.webViewLink ? window.open(p.webViewLink, '_blank') : undefined}
              style={{ cursor: p.webViewLink ? 'pointer' : 'default',
                background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
                overflow:'hidden', transition:'border-color .15s, transform .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}>
              {/* Thumbnail area */}
              <div style={{ position:'relative' }}>
                <DriveImage fileId={p.id} alt={p.name} height={120} isImage={isImage(p.mimeType)}/>
                {!isImage(p.mimeType) && (
                  <div style={{ position:'absolute', top:6, right:6, background:'var(--surface)', borderRadius:6, padding:'2px 6px', fontSize:10, fontWeight:800, color:'var(--text3)' }}>
                    FILE
                  </div>
                )}
              </div>
              {/* Info */}
              <div style={{ padding:'10px 11px 11px' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }} title={p.name}>{p.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)', fontWeight:600 }}>{fmtDate(p.createdTime)}{fmtSize(p.size)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsTab({ id, docs, onDocsChange, showToast, bid }: {
  id: string; docs: ProjDoc[]; onDocsChange: (d: ProjDoc[]) => void;
  showToast: (t: Toast) => void; bid: Bid;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const newDocs: ProjDoc[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('file', f);
        form.append('linked_id', id);
        form.append('linked_name', bid.name);
        form.append('div', 'elec');
        form.append('category', 'other');
        const res = await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        newDocs.push(res.data);
      }
      onDocsChange([...newDocs, ...docs]);
      showToast({ title: `${newDocs.length} file${newDocs.length > 1 ? 's' : ''} uploaded` });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Open inline in a new tab. Opens the tab synchronously (user gesture) before the
  // async fetch so popup blockers don't kill it.
  const view = async (doc: ProjDoc) => {
    const w = window.open('', '_blank');
    try {
      const res = await api.get(`/documents/${doc.id}/view`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      if (w) w.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (w) w.close();
      showToast({ title: 'Preview failed', sub: 'Try downloading instead' });
    }
  };

  const download = async (doc: ProjDoc) => {
    try {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = doc.display_name || doc.name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast({ title: 'Download failed' });
    }
  };

  const remove = async (docId: string) => {
    await api.delete(`/documents/${docId}`).catch(() => {});
    onDocsChange(docs.filter(d => d.id !== docId));
    showToast({ title: 'Document removed' });
  };

  const fmtSize = (b: number) => b >= 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB';
  const extOf = (name: string) => (name.split('.').pop() ?? 'FILE').toUpperCase();

  return (
    <div>
      <input ref={fileRef} type="file" multiple style={{ display:'none' }}
        onChange={e => upload(Array.from(e.target.files ?? []))}/>
      <div style={{ marginBottom:16 }}>
        <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ fontSize:13 }}>
          <Icon name="cloudup" size={14} stroke={1.9}/> {uploading ? 'Uploading…' : 'Upload Files'}
        </button>
      </div>
      {docs.length === 0 ? (
        <Empty text="No documents uploaded for this project yet"/>
      ) : (
        <div className="panel">
          <table className="ctable">
            <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id}>
                  <td className="nm"><Icon name="file" size={13} stroke={1.8}/> {doc.display_name || doc.name}</td>
                  <td><span style={{ fontSize:10, fontWeight:800, padding:'2px 7px', borderRadius:5, background:'var(--blue-soft)', color:'var(--blue)', textTransform:'uppercase' }}>{extOf(doc.name)}</span></td>
                  <td className="sub">{fmtSize(doc.file_size)}</td>
                  <td className="sub">{new Date(doc.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                  <td style={{ display:'flex', gap:6 }}>
                    <button onClick={() => view(doc)} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--blue)', padding:4, borderRadius:6 }} title="View"><Icon name="eye" size={14} stroke={1.9}/></button>
                    <button onClick={() => download(doc)} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text2)', padding:4, borderRadius:6 }} title="Download"><Icon name="cloud" size={13} stroke={1.8}/></button>
                    <button onClick={() => remove(doc.id)} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text3)', padding:4, borderRadius:6 }} title="Remove"><Icon name="x" size={13} stroke={2}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CommsTab({ id, comms, onCommsChange, showToast, bid }: {
  id: string; comms: ProjComm[]; onCommsChange: (c: ProjComm[]) => void;
  showToast: (t: Toast) => void; bid: Bid;
}) {
  const [form, setForm] = useState({ kind: 'note', subject: '', body: '' });
  const [saving, setSaving] = useState(false);

  const KIND_OPTS = [
    { key: 'note',  label: 'Note'  },
    { key: 'email', label: 'Email' },
    { key: 'call',  label: 'Call'  },
    { key: 'meeting', label: 'Meeting' },
  ];
  const KIND_COLOR: Record<string,string> = { note:'var(--blue)', email:'var(--amber)', call:'var(--green)', meeting:'#9B6DFF' };

  const submit = async () => {
    if (!form.subject.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/comms', {
        kind: form.kind, subject: form.subject, body: form.body,
        linked_id: id, linked_name: bid.name, div: 'elec',
      });
      onCommsChange([data, ...comms]);
      setForm({ kind: 'note', subject: '', body: '' });
      showToast({ title: 'Communication logged' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16, padding: '16px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <FL>Type</FL>
            <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} style={INPUT as React.CSSProperties}>
              {KIND_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <FL>Subject</FL>
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="What happened?" style={INPUT as React.CSSProperties}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submit()}/>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <FL>Notes (optional)</FL>
          <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="Additional details…" style={{ ...INPUT as React.CSSProperties, height: 60, resize: 'vertical' }}/>
        </div>
        <button className="btn" onClick={submit} disabled={saving || !form.subject.trim()} style={{ fontSize: 13 }}>
          <Icon name="plus" size={14} stroke={2.2}/> {saving ? 'Saving…' : 'Log Communication'}
        </button>
      </div>

      {comms.length === 0 ? <Empty text="No communications logged for this project yet"/> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comms.map(c => (
            <div key={c.id} style={{ padding: '12px 16px', background: 'var(--surface2)', borderRadius: 10,
              borderLeft: `3px solid ${KIND_COLOR[c.kind] ?? 'var(--border2)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: c.body ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                    background: (KIND_COLOR[c.kind] ?? 'var(--border2)') + '22',
                    color: KIND_COLOR[c.kind] ?? 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {c.kind}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.subject}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>
                  {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {c.author}
                </span>
              </div>
              {c.body && <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────
function SL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>{children}</div>;
}
function FL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:5 }}>{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding:'32px 0', textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>{text}</div>;
}
function StatusPill({ status }: { status: string }) {
  const color = STATUS_CO[status]||'var(--text3)';
  return <span style={{ fontSize:10.5, fontWeight:800, padding:'2px 8px', borderRadius:5,
    background:color+'22', color, textTransform:'uppercase', letterSpacing:'.04em' }}>{status}</span>;
}
function FinRow({ label, val, color, bold }: { label:string; val:string; color?:string; bold?:boolean }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:13, fontWeight:600, color:'var(--text3)' }}>{label}</span>
      <span className="num" style={{ fontSize:bold?15:13, fontWeight:bold?900:700, color:color||'var(--text)' }}>{val}</span>
    </div>
  );
}
function SCard({ title, icon, children }: { title:string; icon:string; children:React.ReactNode }) {
  return (
    <div className="panel" style={{ padding:'16px 18px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <span style={{ fontSize:11, fontWeight:800, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function EditGrid({ fields, onChange }: {
  fields: { label:string; key:string; val:string; type?:string; readonly?:boolean; placeholder?:string }[];
  onChange: (key:string, val:string) => void;
}) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {fields.map(f => (
        <div key={f.key} style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:10, alignItems:'center' }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--text3)' }}>{f.label}</span>
          {f.readonly
            ? <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{f.val}</span>
            : <input type={f.type||'text'} value={f.val} placeholder={f.placeholder||''}
                onChange={e=>onChange(f.key,e.target.value)}
                style={{ font:'inherit', fontSize:13, fontWeight:600, color:'var(--text)',
                  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:7,
                  padding:'5px 10px', outline:'none', width:'100%', boxSizing:'border-box' }}/>
          }
        </div>
      ))}
    </div>
  );
}
