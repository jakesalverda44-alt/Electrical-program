import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';
import { PC_STEPS, PC_TABS, SCOPE_SECS, PcWorkspace, PcTabKey, PcStepKey } from './constants';
import api from '../../api/client';
import { AppSettings, checkAIPermission } from '../../hooks/useAppSettings';

interface Props {
  ws: PcWorkspace;
  bid: Bid;
  onUpdate: (ws: PcWorkspace) => void;
  onBack: () => void;
  onConverted: (bid: Bid) => void;
  showToast: (t: Toast) => void;
  userRole?: string;
  settings?: AppSettings;
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

const ELEC_INCLUDE = /^E\d|electrical|one.?line|panel.?sched|equip.?sched/i;
const EXCLUDE_ONLY = /^(A|S|C|L|M)\d/i;
function isElecSheet(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  if (ELEC_INCLUDE.test(base)) return true;
  if (EXCLUDE_ONLY.test(base)) return false;
  return true;
}

export default function PcWorkspaceView({ ws, bid, onUpdate, onBack, onConverted, showToast, userRole, settings }: Props) {
  const [convertOpen, setConvertOpen] = useState(false);
  const [newRfi, setNewRfi] = useState('');
  const [rfiSuggesting, setRfiSuggesting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileObjectsRef = useRef<File[]>([]);
  const [aiResults, setAiResults] = useState<Record<string, unknown> | null>(null);
  const [analysisTab, setAnalysisTab] = useState<'agent1'|'agent2'|'agent3'|'raw'>('agent1');
  const [copied, setCopied] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [historicalCosts, setHistoricalCosts] = useState<Array<Record<string,unknown>>>([]);
  const [bidIntel, setBidIntel] = useState<Record<string,unknown> | null>(null);
  const pollRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsRef = useRef(ws);
  wsRef.current = ws;

  // Auto-save workspace to DB 800ms after last change (skip ephemeral fields)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put(`/preconstruction/${bid.id}/workspace`, {
        step: ws.step,
        active_tab: ws.activeTab,
        notes: ws.notes,
        scope: ws.scope,
        rfis: ws.rfis,
        files: ws.files,
        ai_done: ws.aiDone,
        proposal_generated: ws.proposalGenerated,
      }).catch(() => {});
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [ws.step, ws.activeTab, ws.notes, ws.scope, ws.rfis, ws.files, ws.aiDone, ws.proposalGenerated]);

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

  const pollForResults = (startMs = Date.now(), shownAgent2 = false, shownAgent3 = false) => {
    pollRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/preconstruction/${bid.id}/results`);
        const elapsed = Date.now() - startMs;
        let nextA2 = shownAgent2, nextA3 = shownAgent3;
        if (!shownAgent2 && (elapsed > 90_000 || data?.status === 'agent1_complete' || data?.status === 'agent2_running')) {
          set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 2 of 3: Building scope & estimate…'] }));
          nextA2 = true;
        }
        if (!shownAgent3 && (elapsed > 150_000 || data?.status === 'agent2_complete' || data?.status === 'agent3_running')) {
          set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 3 of 3: Running QA review & risk assessment…'] }));
          nextA3 = true;
        }
        if (data?.status === 'complete') {
          setAiResults(data);
          set(prev => ({ aiRunning: false, aiDone: true, aiLog: [...(prev.aiLog ?? []), '✓ Analysis complete — see Plan Review tab.'] }));
        } else if (data?.status === 'error') {
          set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), '✗ Analysis failed. Check server logs.'] }));
        } else {
          pollForResults(startMs, nextA2, nextA3);
        }
      } catch {
        set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), '✗ Could not reach server.'] }));
      }
    }, 3000);
  };

  useEffect(() => {
    if (ws.aiDone && !aiResults) {
      api.get(`/preconstruction/${bid.id}/results`).then(r => { if (r.data) setAiResults(r.data); }).catch(() => {});
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [bid.id]);

  useEffect(() => {
    api.get('/preconstruction/costs').then(r => setHistoricalCosts(r.data || [])).catch(() => {});
    api.get(`/preconstruction/intelligence/${bid.id}`).then(r => setBidIntel(r.data)).catch(() => {});
  }, [bid.id]);

  const runAI = async () => {
    if (wsRef.current.aiRunning || wsRef.current.aiDone) return;
    const elecFiles = fileObjectsRef.current.filter(f => isElecSheet(f.name));
    set({ aiRunning: true, aiLog: [`Uploading ${fileObjectsRef.current.length} file(s) (${elecFiles.length} electrical sheet${elecFiles.length !== 1 ? 's' : ''} identified)…`] });
    try {
      const formData = new FormData();
      formData.append('bidId', bid.id);
      fileObjectsRef.current.forEach(f => formData.append('files', f));
      await api.post('/preconstruction/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 1 of 3: Reading plans & extracting drawing data (1–2 min)…'] }));
      pollForResults(Date.now());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start analysis';
      set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${msg}`] }));
    }
  };

  const addRfi = () => {
    if (!newRfi.trim()) return;
    const rfi = { id: Date.now().toString(), question: newRfi.trim(), submitted: false, answer: '' };
    set({ rfis: [...ws.rfis, rfi] });
    setNewRfi('');
  };

  const suggestRfis = () => {
    const scopeText = Object.values(ws.scope).join(' ').toLowerCase();
    const existing = new Set(ws.rfis.map(r => r.question.toLowerCase().slice(0, 30)));
    const SUGGESTIONS: { keywords: string[]; question: string }[] = [
      { keywords: ['service','distribution','panel','switchboard'],  question: 'What is the available fault current at the utility service point?' },
      { keywords: ['service','distribution','panel','meter'],        question: 'Confirm service entrance rating and metering configuration with utility.' },
      { keywords: ['lighting','fixture','led'],                      question: 'Are lighting fixture submittals required prior to rough-in?' },
      { keywords: ['generator','transfer','ats'],                    question: 'What is the intended load profile for the generator? Confirm ATS type (open vs. closed transition).' },
      { keywords: ['fire alarm','fa','smoke'],                       question: 'Who is the fire alarm system designer of record? Is a separate permit required?' },
      { keywords: ['data','low voltage','cat','network'],            question: 'What is the structured cabling category requirement (Cat6 / Cat6A)? Who terminates?' },
      { keywords: ['conduit','raceway','underground','duct bank'],   question: 'Confirm conduit type and burial depth requirements for underground runs.' },
      { keywords: ['motor','mechanical','hvac','equipment'],         question: 'Confirm motor HP, voltage, and phase for all mechanical equipment to ensure proper circuit sizing.' },
      { keywords: ['parking','site','exterior','pole'],              question: 'Is a photometric plan required for exterior lighting? Confirm pole base details.' },
      { keywords: ['rough','inspection','trim'],                     question: 'What is the AHJ inspection sequence (rough-in, above-ceiling, final)?' },
    ];
    setRfiSuggesting(true);
    setTimeout(() => {
      const matched = SUGGESTIONS.filter(s =>
        s.keywords.some(k => scopeText.includes(k)) &&
        !existing.has(s.question.toLowerCase().slice(0, 30))
      );
      const toAdd = (matched.length ? matched : SUGGESTIONS.slice(0, 3)).slice(0, 5);
      const newRfis = toAdd.map(s => ({ id: Date.now().toString() + Math.random(), question: s.question, submitted: false, answer: '' }));
      set({ rfis: [...ws.rfis, ...newRfis] });
      setRfiSuggesting(false);
    }, 600);
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

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    fileObjectsRef.current = [...fileObjectsRef.current, ...files];
    const newFiles = files.map(f => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      type: f.name.split('.').pop()?.toUpperCase() ?? 'FILE',
      size: f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(f.size / 1024) + ' KB',
    }));
    set({ files: [...ws.files, ...newFiles] });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
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

      case 'files': {
        const elecCount = fileObjectsRef.current.filter(f => isElecSheet(f.name)).length;
        const totalCount = fileObjectsRef.current.length;
        return (
          <div style={{ padding: '20px 24px' }}>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileUpload}/>
            {/* Drag-and-drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 12, padding: '28px 20px',
                textAlign: 'center', cursor: 'pointer', marginBottom: 16, transition: 'border-color .15s, background .15s',
                background: dragOver ? 'var(--blue-soft)' : 'var(--surface2)' }}>
              <Icon name="cloudup" size={28} stroke={1.6}/>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginTop: 10, marginBottom: 4 }}>
                Drop plan sheets here or click to browse
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>PDF, JPG, PNG — electrical sheets auto-detected</div>
              {totalCount > 0 && (
                <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--text3)' }}>
                  {totalCount} file{totalCount !== 1 ? 's' : ''} · <span style={{ color: 'var(--blue)' }}>{elecCount} electrical sheet{elecCount !== 1 ? 's' : ''} identified</span>
                </div>
              )}
            </div>
            {ws.files.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No files uploaded yet.
              </div>
            ) : (
              <div className="panel">
                <table className="ctable">
                  <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Sheet Type</th></tr></thead>
                  <tbody>
                    {ws.files.map(f => {
                      const elec = isElecSheet(f.name);
                      return (
                        <tr key={f.id}>
                          <td className="nm"><Icon name="file" size={13} stroke={1.8}/> {f.name}</td>
                          <td><span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft)', color: 'var(--blue)', textTransform: 'uppercase' }}>{f.type}</span></td>
                          <td className="sub">{f.size}</td>
                          <td>
                            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase',
                              background: elec ? 'var(--green-soft)' : 'var(--surface2)',
                              color: elec ? 'var(--green)' : 'var(--text3)' }}>
                              {elec ? 'Electrical' : 'Other'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      }

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
                  Upload electrical plan sheets in the Files tab, then run the 3-agent AI pipeline: Agent 1 reads drawings, Agent 2 builds scope & estimate, Agent 3 runs QA review. Results appear in the Plan Review tab.
                </p>
                {settings && userRole && !checkAIPermission('run_analysis', userRole, settings) ? (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon name="shield" size={16} stroke={1.8}/>
                    AI analysis is not enabled for your role. Contact an administrator.
                  </div>
                ) : (
                  <button className="btn" onClick={runAI} disabled={ws.aiRunning || ws.aiDone} style={{ fontSize: 13, marginBottom: ws.aiLog.length ? 16 : 0 }}>
                    <Icon name="spark" size={14} stroke={1.9}/>
                    {ws.aiDone ? 'Takeoff Complete' : ws.aiRunning ? 'Running…' : 'Run AI Takeoff'}
                  </button>
                )}
                {ws.aiRunning && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ height: 4, background: 'var(--border2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '60%', background: 'var(--blue)', borderRadius: 2,
                        animation: 'pcprogress 2.5s ease-in-out infinite alternate' }}/>
                    </div>
                  </div>
                )}
                {ws.aiLog.length > 0 && (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
                    {ws.aiLog.map((line, i) => (
                      <div key={i} style={{ color: line.startsWith('✓') ? 'var(--green)' : line.startsWith('✗') ? 'var(--red)' : 'var(--text2)' }}>
                        {line}
                      </div>
                    ))}
                    {ws.aiRunning && <div style={{ color: 'var(--blue)' }}>▌</div>}
                  </div>
                )}
                {ws.aiDone && (
                  <button className="btn ghost" onClick={() => set({ activeTab: 'takeoff' })} style={{ fontSize: 13, marginTop: 10 }}>
                    View Results <Icon name="arrow" size={13} stroke={2}/>
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      case 'takeoff': {
        if (settings && userRole && !checkAIPermission('view_results', userRole, settings)) {
          return (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text3)' }}>
              <Icon name="shield" size={32} stroke={1.5}/>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12, color: 'var(--text2)' }}>Access Restricted</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>AI analysis results are not available for your role.</div>
            </div>
          );
        }
        const agent1 = aiResults?.agent1_output as string | undefined;
        const agent2 = aiResults?.agent2_output as string | undefined;
        const agent3 = aiResults?.agent3_output as string | undefined;
        const ANALYSIS_TABS = [
          { key: 'agent1' as const, label: 'Drawing Analysis',   output: agent1 },
          { key: 'agent2' as const, label: 'Scope & Estimate',   output: agent2 },
          { key: 'agent3' as const, label: 'QA Review & Risk',   output: agent3 },
          { key: 'raw'    as const, label: 'Raw Data',           output: aiResults ? JSON.stringify(aiResults, null, 2) : undefined },
        ];
        const exportMarkdown = () => {
          const parts = [
            `# Plan Review — ${bid.name}\n`,
            agent1 ? `## Drawing Analysis\n${agent1}` : '',
            agent2 ? `## Scope & Estimate\n${agent2}` : '',
            agent3 ? `## QA Review & Risk\n${agent3}` : '',
          ].filter(Boolean).join('\n\n');
          const blob = new Blob([parts], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${bid.name.replace(/\s+/g,'-')}-analysis.md`;
          a.click(); URL.revokeObjectURL(url);
        };
        return (
          <div style={{ padding: '20px 24px' }}>
            {!ws.aiDone ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                Run AI Takeoff in the Bid Builder tab first.
              </div>
            ) : !aiResults ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading results…</div>
            ) : (
              <>
                {/* Sub-tab bar */}
                <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0, alignItems: 'center' }}>
                  {ANALYSIS_TABS.map(t => (
                    <button key={t.key} onClick={() => setAnalysisTab(t.key)}
                      style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 700,
                        padding: '8px 14px', background: 'transparent',
                        color: analysisTab === t.key ? 'var(--text)' : 'var(--text3)',
                        borderBottom: analysisTab === t.key ? '2px solid var(--blue)' : '2px solid transparent',
                        whiteSpace: 'nowrap' }}>
                      {t.label}
                      {!t.output && t.key !== 'raw' && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text3)' }}>—</span>}
                    </button>
                  ))}
                  <button onClick={exportMarkdown}
                    style={{ marginLeft: 'auto', border: '1px solid var(--border2)', borderRadius: 7, cursor: 'pointer',
                      font: 'inherit', fontSize: 12, fontWeight: 700, padding: '5px 12px',
                      background: 'var(--surface2)', color: 'var(--text2)' }}>
                    ↓ Export
                  </button>
                </div>
                {/* Sub-tab content */}
                {ANALYSIS_TABS.map(t => t.key === analysisTab && (
                  <div key={t.key}>
                    {t.output ? (
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => copyToClipboard(t.output!, t.key)}
                          style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, border: '1px solid var(--border2)',
                            borderRadius: 7, background: 'var(--surface)', color: copied === t.key ? 'var(--green)' : 'var(--text3)',
                            fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
                          {copied === t.key ? '✓ Copied' : 'Copy'}
                        </button>
                        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px',
                          fontFamily: t.key === 'raw' ? 'monospace' : 'inherit', fontSize: t.key === 'raw' ? 12 : 13,
                          color: 'var(--text2)', lineHeight: 1.75,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '65vh', overflowY: 'auto' }}>
                          {t.output}
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                        No output yet for this agent.
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        );
      }

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
              <button className="btn ghost" onClick={suggestRfis} disabled={rfiSuggesting} style={{ fontSize: 13, color: 'var(--blue)' }}>
                <Icon name="sparkle" size={14} stroke={1.9}/> {rfiSuggesting ? 'Thinking…' : 'Suggest RFIs'}
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
              <div className="panel-hdr"><span className="panel-title">Historical Cost Comps — Awarded Jobs</span></div>
              {historicalCosts.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  No awarded jobs yet. Win bids to build your historical cost database.
                </div>
              ) : (
                <table className="ctable">
                  <thead><tr><th>Project</th><th>GC</th><th>Year</th><th style={{ textAlign: 'right' }}>Contract Value</th></tr></thead>
                  <tbody>
                    {historicalCosts.map((row, i) => (
                      <tr key={i}>
                        <td className="nm">{String(row.name)}</td>
                        <td className="sub">{String(row.gc)}</td>
                        <td className="sub">{String(row.year ?? '—')}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>${Math.round(Number(row.amount)).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                {bidIntel ? (
                  <>
                    {[
                      {
                        label: `Win Rate with ${String(bidIntel.gc)}`,
                        val: bidIntel.gcWinRate != null ? `${bidIntel.gcWinRate}%` : 'No history',
                        sub: `${bidIntel.gcWins ?? 0} won · ${bidIntel.gcLosses ?? 0} lost with this GC`,
                      },
                      {
                        label: 'Overall Company Win Rate',
                        val: bidIntel.overallWinRate != null ? `${bidIntel.overallWinRate}%` : 'No data',
                        sub: 'Across all electrical bids submitted',
                      },
                      ...(bidIntel.gcAvgWonAmount ? [{
                        label: 'Avg Won Contract (this GC)',
                        val: `$${Math.round(Number(bidIntel.gcAvgWonAmount)).toLocaleString()}`,
                        sub: 'Average value of won bids with this GC',
                      }] : []),
                    ].map(item => (
                      <div key={item.label} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{item.label}</span>
                          <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>{item.val}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{item.sub}</div>
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 8 }}>
                      Intelligence improves as more bids are entered and outcomes recorded.
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading intelligence data…</div>
                )}
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
      <div className="pc-tabs" style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', overflowX: 'auto' }}>
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
