import React, { useState, useRef } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import { PC_STEPS, PC_TABS, SCOPE_SECS, PcWorkspace, PcTabKey, PcStepKey } from './constants';

interface Props {
  ws: PcWorkspace;
  bid: Bid;
  onUpdate: (ws: PcWorkspace) => void;
  onBack: () => void;
  onConverted: (bid: Bid) => void;
  showToast: (t: Toast) => void;
}

const STEP_ORDER: PcStepKey[] = ['intake','takeoff','scope','estimate','review','proposal','submitted'];

function StepTracker({ current }: { current: PcStepKey }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 2 }}>
      {PC_STEPS.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 72 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: done ? 'var(--green)' : active ? 'var(--blue)' : 'var(--surface2)',
                color:      done ? '#fff'         : active ? '#fff'        : 'var(--text3)',
                border:     active ? '2px solid var(--blue)' : 'none',
              }}>
                {done ? <Icon name="check" size={13} stroke={2.5}/> : s.short}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: active ? 'var(--text)' : done ? 'var(--green)' : 'var(--text3)', textAlign: 'center', maxWidth: 64 }}>
                {s.label}
              </div>
            </div>
            {i < PC_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < idx ? 'var(--green)' : 'var(--surface2)', minWidth: 16, marginBottom: 18 }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function PcWorkspaceView({ ws, bid, onUpdate, onBack, onConverted, showToast }: Props) {
  const [convertOpen, setConvertOpen] = useState(false);
  const [newRfi, setNewRfi] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wsRef = useRef(ws);
  wsRef.current = ws;

  function set(patchOrFn: Partial<PcWorkspace> | ((prev: PcWorkspace) => Partial<PcWorkspace>)) {
    const current = wsRef.current;
    if (typeof patchOrFn === 'function') {
      onUpdate({ ...current, ...patchOrFn(current) });
    } else {
      onUpdate({ ...current, ...patchOrFn });
    }
  }

  const advanceStep = () => {
    const idx = STEP_ORDER.indexOf(wsRef.current.step);
    if (idx < STEP_ORDER.length - 1) set({ step: STEP_ORDER[idx + 1] });
  };

  const runAI = () => {
    if (wsRef.current.aiRunning || wsRef.current.aiDone) return;
    set({ aiRunning: true, aiLog: ['Analyzing plan sheets…'] });
    const steps: [number, string][] = [
      [800,  'Identifying electrical service equipment…'],
      [1600, 'Counting branch circuit runs…'],
      [2400, 'Extracting lighting fixture schedule…'],
      [3200, 'Cross-referencing panel schedules…'],
      [4200, 'Generating takeoff summary…'],
    ];
    steps.forEach(([delay, msg]) => {
      setTimeout(() => {
        set(prev => ({ aiLog: [...(prev.aiLog ?? []), msg] }));
      }, delay);
    });
    setTimeout(() => {
      set(prev => ({ aiRunning: false, aiDone: true, aiLog: [...(prev.aiLog ?? []), '✓ Takeoff complete — review results in Takeoff Review tab.'] }));
    }, 4800);
  };

  const addRfi = () => {
    if (!newRfi.trim()) return;
    const rfi = { id: Date.now().toString(), question: newRfi.trim(), submitted: false, answer: '' };
    set({ rfis: [...ws.rfis, rfi] });
    setNewRfi('');
  };

  const submitRfi = (id: string) => {
    set({ rfis: ws.rfis.map(r => r.id === id ? { ...r, submitted: true } : r) });
    showToast({ title: 'RFI submitted', sub: 'GC will be notified' });
  };

  const generateProposal = () => {
    set({ proposalGenerated: true });
    showToast({ title: 'Proposal generated', sub: 'Ready to review and send' });
  };

  const handleConvert = () => {
    setConvertOpen(false);
    onConverted({ ...bid, stage: 'awarded' });
    showToast({ title: 'Project created!', sub: `${bid.name} moved to Electrical Projects` });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newFiles = files.map(f => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      type: f.name.split('.').pop()?.toUpperCase() ?? 'FILE',
      size: f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(f.size / 1024) + ' KB',
    }));
    set({ files: [...ws.files, ...newFiles] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const tab = ws.activeTab;

  const renderTab = () => {
    switch (tab) {
      case 'overview':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', padding: 0, marginBottom: 20 }}>
              {[
                { label: 'Est. Contract Value', val: '$' + Math.round(ws.amount).toLocaleString('en-US'), tone: 'green' },
                { label: 'Step Progress',        val: `${STEP_ORDER.indexOf(ws.step) + 1} / ${STEP_ORDER.length}`, tone: 'blue'  },
                { label: 'RFIs Open',            val: String(ws.rfis.filter(r => !r.submitted).length), tone: 'amber' },
              ].map(s => (
                <div className="stat" key={s.label}>
                  <div className="stat-top"><span className="stat-label">{s.label}</span></div>
                  <div className="stat-val num">{s.val}</div>
                </div>
              ))}
            </div>
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Workspace Notes</span></div>
              <div style={{ padding: 16 }}>
                <textarea style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 140, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                  value={ws.notes} onChange={e => set({ notes: e.target.value })} placeholder="Add notes, reminders, or key info about this bid…"/>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
              <button className="btn" onClick={advanceStep} disabled={ws.step === 'submitted'} style={{ fontSize: 13 }}>
                Advance to Next Step <Icon name="arrow" size={14} stroke={2.2}/>
              </button>
            </div>
          </div>
        );

      case 'files':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div style={{ marginBottom: 16 }}>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload}/>
              <button className="btn ghost" onClick={() => fileInputRef.current?.click()} style={{ fontSize: 13 }}>
                <Icon name="cloudup" size={14} stroke={1.9}/> Upload Files
              </button>
            </div>
            {ws.files.length === 0 ? (
              <div className="panel-empty" style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No files uploaded yet
              </div>
            ) : (
              <div className="panel">
                <table className="ctable">
                  <thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead>
                  <tbody>
                    {ws.files.map(f => (
                      <tr key={f.id}>
                        <td className="nm"><Icon name="file" size={13} stroke={1.8}/> {f.name}</td>
                        <td><span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft)', color: 'var(--blue)', textTransform: 'uppercase' }}>{f.type}</span></td>
                        <td className="sub">{f.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case 'bid':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                    <Icon name="sparkle" size={15} stroke={1.8}/>
                  </span>
                  AI Takeoff Engine
                </span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
                  Upload plan sheets in the Files tab, then run the AI engine to automatically count devices, circuits, and fixtures.
                </p>
                <button className="btn" onClick={runAI} disabled={ws.aiRunning || ws.aiDone} style={{ fontSize: 13, marginBottom: ws.aiLog.length ? 16 : 0 }}>
                  <Icon name="spark" size={14} stroke={1.9}/>
                  {ws.aiDone ? 'Takeoff Complete' : ws.aiRunning ? 'Running…' : 'Run AI Takeoff'}
                </button>
                {ws.aiLog.length > 0 && (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
                    {ws.aiLog.map((line, i) => <div key={i}>{line}</div>)}
                    {ws.aiRunning && <div style={{ color: 'var(--blue)' }}>▌</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'takeoff':
        return (
          <div style={{ padding: '20px 24px' }}>
            {!ws.aiDone ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                Run the AI Takeoff in the Bid Builder tab first.
              </div>
            ) : (
              <div className="panel">
                <div className="panel-hdr"><span className="panel-title">Takeoff Results</span></div>
                <table className="ctable">
                  <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Count</th><th>Notes</th></tr></thead>
                  <tbody>
                    {[
                      ['200A Service Entrance', '1', 'Main disconnect panel'],
                      ['100A Sub-panel', '3', 'Kitchen, HVAC, lighting'],
                      ['20A Branch Circuits', '48', 'General purpose + dedicated'],
                      ['15A Branch Circuits', '22', 'Lighting circuits'],
                      ['Duplex Receptacles', '186', 'Standard + GFCI'],
                      ['Single-Pole Switches', '94', 'Standard + 3-way'],
                      ['Fluorescent Fixtures', '112', 'Troffer 2x4'],
                      ['LED Downlights', '38', '6" recessed'],
                      ['Exit Signs', '14', 'Emergency battery backup'],
                      ['Emergency Lights', '22', 'Twin-head halogen'],
                    ].map(([cat, cnt, note]) => (
                      <tr key={cat}>
                        <td className="nm">{cat}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{cnt}</td>
                        <td className="sub">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case 'scope':
        return (
          <div style={{ padding: '20px 24px' }}>
            {SCOPE_SECS.map(sec => (
              <div key={sec.id} className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-hdr">
                  <span className="panel-title">
                    <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)', fontSize: 11, fontWeight: 800 }}>
                      {sec.id}
                    </span>
                    {sec.label}
                  </span>
                </div>
                <div style={{ padding: '10px 16px' }}>
                  <textarea style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 76, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                    value={ws.scope[sec.id] ?? ''} onChange={e => set({ scope: { ...ws.scope, [sec.id]: e.target.value } })}
                    placeholder={`Scope notes for ${sec.label}…`}/>
                </div>
              </div>
            ))}
          </div>
        );

      case 'rfis':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <input style={{ flex: 1, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px', outline: 'none' }}
                value={newRfi} onChange={e => setNewRfi(e.target.value)} placeholder="Enter RFI question…"
                onKeyDown={e => e.key === 'Enter' && addRfi()}/>
              <button className="btn" onClick={addRfi} style={{ fontSize: 13 }}>
                <Icon name="plus" size={14} stroke={2.2}/> Add RFI
              </button>
            </div>
            {ws.rfis.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No RFIs yet</div>
            ) : (
              <div className="panel">
                <table className="ctable">
                  <thead><tr><th>#</th><th>Question</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {ws.rfis.map((r, i) => (
                      <tr key={r.id}>
                        <td className="sub">{i + 1}</td>
                        <td style={{ fontSize: 13 }}>{r.question}</td>
                        <td>
                          <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                            background: r.submitted ? 'var(--blue-soft)' : 'var(--amber-soft)',
                            color: r.submitted ? 'var(--blue)' : 'var(--amber)', textTransform: 'uppercase' }}>
                            {r.submitted ? 'Submitted' : 'Draft'}
                          </span>
                        </td>
                        <td>
                          {!r.submitted && (
                            <button className="btn ghost" onClick={() => submitRfi(r.id)} style={{ height: 28, fontSize: 11, padding: '0 10px' }}>
                              Submit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );

      case 'proposal':
        return (
          <div style={{ padding: '20px 24px' }}>
            {!ws.proposalGenerated ? (
              <div className="panel">
                <div className="panel-hdr"><span className="panel-title">Generate Proposal</span></div>
                <div style={{ padding: '24px 20px', textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.6 }}>
                    Complete takeoff and scope of work, then generate the formal electrical proposal document.
                  </p>
                  <button className="btn" onClick={generateProposal} style={{ fontSize: 13 }}>
                    <Icon name="doc" size={14} stroke={1.9}/> Generate Proposal
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="panel" style={{ marginBottom: 16 }}>
                  <div className="panel-hdr">
                    <span className="panel-title">
                      <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                        <Icon name="check" size={15} stroke={2.2}/>
                      </span>
                      Proposal Ready
                    </span>
                  </div>
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
                      Electrical subcontractor proposal for <b>{bid.name}</b> — ready to send to {bid.gc}.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="btn ghost" onClick={() => window.print()} style={{ fontSize: 13 }}>
                        <Icon name="doc" size={14} stroke={1.9}/> Print / PDF
                      </button>
                      <button className="btn" onClick={() => setConvertOpen(true)}
                        style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                        <Icon name="check" size={14} stroke={2.2}/> Mark as Awarded
                      </button>
                    </div>
                  </div>
                </div>

                {convertOpen && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
                    <div className="panel" style={{ width: 380, padding: 28 }}>
                      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 12 }}>Convert to Awarded Project?</div>
                      <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 20 }}>
                        This will mark <b>{bid.name}</b> as Awarded and add it to Electrical Projects.
                      </p>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn ghost" onClick={() => setConvertOpen(false)} style={{ flex: 1, fontSize: 13 }}>Cancel</button>
                        <button className="btn" onClick={handleConvert}
                          style={{ flex: 1, fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                          Confirm
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'costs':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Historical Cost Comps</span></div>
              <table className="ctable">
                <thead><tr><th>Project</th><th>Year</th><th style={{ textAlign: 'right' }}>Contract Value</th><th style={{ textAlign: 'right' }}>$/SF</th></tr></thead>
                <tbody>
                  {[
                    ['Sarasota Medical Annex',   '2024', '$385,000', '$18.40'],
                    ['Lakewood Commons Phase 1', '2024', '$298,000', '$16.80'],
                    ['Venice Retail Center',     '2023', '$412,000', '$19.20'],
                    ['North Port Office',        '2023', '$215,000', '$14.60'],
                    ['Bradenton Warehouse',      '2022', '$178,000', '$11.20'],
                  ].map(([p, y, v, sf]) => (
                    <tr key={p}>
                      <td className="nm">{p}</td>
                      <td className="sub">{y}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{v}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{sf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'intel':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                    <Icon name="sparkle" size={15} stroke={1.8}/>
                  </span>
                  Bid Intelligence
                </span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {[
                  { label: 'Recommended Markup', val: '18–22%', sub: 'Based on similar scope + market conditions' },
                  { label: 'Competitor Activity', val: 'Moderate', sub: '3–4 subs likely bidding this scope' },
                  { label: 'Bid Win Probability', val: '62%', sub: 'Based on GC relationship + past wins' },
                  { label: 'Key Risk Factors', val: 'Schedule', sub: 'Tight 8-month timeline may impact labor cost' },
                ].map(item => (
                  <div key={item.label} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{item.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>{item.val}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="scroll view-enter">
      {/* Back bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
        <button className="btn ghost" onClick={onBack} style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
          ← All Bids
        </button>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', flex: 1 }}>{bid.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{bid.gc}</span>
      </div>

      {/* Step tracker */}
      <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid var(--border)' }}>
        <StepTracker current={ws.step}/>
      </div>

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', overflowX: 'auto' }}>
        {PC_TABS.map(t => (
          <button key={t.key} onClick={() => onUpdate({ ...ws, activeTab: t.key as PcTabKey })} style={{
            border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700,
            padding: '10px 14px', background: 'transparent',
            color: ws.activeTab === t.key ? 'var(--text)' : 'var(--text3)',
            borderBottom: ws.activeTab === t.key ? '2px solid var(--blue)' : '2px solid transparent',
            whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {renderTab()}
    </div>
  );
}
