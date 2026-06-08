import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast, BidEstimate, EstimateLineItem } from '../../types';
import { PC_STEPS, PC_TABS, SCOPE_SECS, PcWorkspace, PcTabKey, PcStepKey, PROJECT_TYPES, ConfirmedService } from './constants';
import api from '../../api/client';
import { AppSettings, checkAIPermission } from '../../hooks/useAppSettings';
import { moneyFull } from '../../lib/money';

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

// Parse Agent 2's "Scope of Work" prose into its lettered sections (A–H).
// Tolerant of markdown headers (#, *, -) and ".", ")" after the letter.
function parseScopeSections(agent2: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!agent2) return result;
  // Isolate the Scope of Work region so lettered headers elsewhere
  // (Quantity Takeoff, BOM, etc.) aren't captured.
  let region = agent2;
  const scopeStart = region.search(/scope of work/i);
  if (scopeStart >= 0) {
    region = region.slice(scopeStart);
    const exclIdx = region.search(/\n\s*[#*>-]*\s*exclusions/i);
    if (exclIdx > 0) region = region.slice(0, exclIdx);
  }
  const headerRe = /^[#*\s>-]*([A-H])[.)]\s+[^\n]+/gm;
  const matches = [...region.matchAll(headerRe)];
  for (let i = 0; i < matches.length; i++) {
    const letter = matches[i][1].toUpperCase();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : region.length;
    const body = region.slice(start, end).trim();
    if (body) result[letter] = body;
  }
  return result;
}

// Strip markdown so Agent 2 output reads cleanly inside plain textareas:
// removes bold/italic/heading/code markers and flattens markdown tables to readable lines.
function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map(raw => {
      let l = raw;
      // Drop table separator rows like |---|---| or | :--- | ---: |
      if (/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(l)) return null;
      // Flatten table data rows: | a | b | c | → a · b · c
      if (/^\s*\|.*\|\s*$/.test(l)) {
        const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()).filter(Boolean);
        l = cells.join(' · ');
      }
      l = l.replace(/^\s*#{1,6}\s+/, '');        // heading markers
      l = l.replace(/^\s*>\s?/, '');             // blockquote
      l = l.replace(/^\s*[-*+]\s+/, '• ');       // list markers → bullet
      l = l.replace(/\*\*(.+?)\*\*/g, '$1');     // bold
      l = l.replace(/__(.+?)__/g, '$1');
      l = l.replace(/\*(.+?)\*/g, '$1');         // italics
      l = l.replace(/`([^`]+)`/g, '$1');         // inline code
      return l;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Map Agent 2 output into the Scope of Work tab's 7 sections (A–G).
// Handles both the new compact JSON format and the old prose format.
function buildScopeFromAgent2(agent2?: string): Record<string, string> {
  if (!agent2) return {};

  // Try new JSON format first
  try {
    const j = JSON.parse(agent2) as Record<string, unknown>;
    const sow = j.scopeOfWork as Record<string, string[]> | undefined;
    if (sow) {
      const join = (arr?: string[]) => (arr ?? []).join('\n');
      const out: Record<string, string> = {};
      const put = (key: string, val: string) => { const c = cleanMarkdown(val); if (c) out[key] = c; };
      put('A', join(sow.A_ServiceDistribution));
      put('B', join(sow.B_BranchPower));
      put('C', join(sow.C_LightingControls));
      put('D', join(sow.E_LowVoltage));                         // Low Voltage → D
      put('F', join(sow.D_SiteLightingUnderground));            // Site → F
      put('G', join(sow.F_Coordination));                       // Coordination → G (Special Systems)
      return out;
    }
  } catch { /* fall through to prose parser */ }

  // Fall back to prose parser for old format
  const s = parseScopeSections(agent2);
  const out: Record<string, string> = {};
  const put = (key: string, val?: string) => {
    if (!val) return;
    const cleaned = cleanMarkdown(val);
    if (cleaned) out[key] = cleaned;
  };
  put('A', s.A);
  put('B', s.B);
  put('C', s.C);
  put('D', s.E);
  put('E', s.F);
  put('F', s.D);
  put('G', [s.G, s.H].filter(Boolean).join('\n\n'));
  return out;
}

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

// Mirror of backend isElectricalSheet (preconstruction.ts) — keep in sync.
const ELEC_INCLUDE = /^E\d|electrical|one.?line|panel.?sched|equip.?sched|fixture|lumin|lighting|schedule/i;
const EXCLUDE_ONLY = /^(A|S|C|L|M|P|G|FP|PL|CV|CI|LS)\d/i;
function isElecSheet(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  if (ELEC_INCLUDE.test(base)) return true;
  if (EXCLUDE_ONLY.test(base)) return false;
  return true;
}

function analysisErrorMessage(data: Record<string, unknown> | null | undefined) {
  const parts = [
    data?.agent1_output,
    data?.agent2_output,
    data?.agent3_output,
    data?.raw_response,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const first = parts[0];
  if (!first) return 'Analysis failed. Check server logs.';
  if (first.length <= 700) return first;
  return `${first.slice(0, 700)}...`;
}

interface ProjectDoc { id: string; name: string; display_name: string; category: string; file_type: string; }

function lookupUnitCost(
  cat: string,
  lib: { global: Record<string,number>; by_project_type: Record<string,Record<string,number>> },
  projectType?: string | null
): number {
  if (projectType && lib.by_project_type[projectType]?.[cat] !== undefined) {
    return lib.by_project_type[projectType][cat];
  }
  return lib.global[cat] ?? 0;
}

function buildLineItemsFromTakeoff(
  agent2Output: string | undefined,
  lib: { global: Record<string,number>; by_project_type: Record<string,Record<string,number>> },
  projectType: string | null | undefined,
  overrides: Record<string, number>
): EstimateLineItem[] {
  if (!agent2Output) return [];
  try {
    const raw = agent2Output.trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const start = candidate.indexOf('{');
    const j = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as { takeoff?: { category: string; item: string; qty: number; unit: string; spec?: string; confidence?: string; notes?: string }[] };
    if (!j.takeoff?.length) return [];
    return j.takeoff.map(row => {
      const key = `${row.category}||${row.item}`;
      const base = lookupUnitCost(row.category, lib, projectType);
      const unit_cost = overrides[key] !== undefined ? overrides[key] : base;
      return { category: row.category, item: row.item, qty: row.qty, unit: row.unit || 'EA', unit_cost, total: row.qty * unit_cost, overridden: overrides[key] !== undefined };
    });
  } catch {
    return [];
  }
}

function parseAgent1Service(output: string): { voltage: string; ampacity: string; panel: string } {
  try {
    const raw = output.trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;
    const start = candidate.indexOf('{');
    const j = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as {
      service?: { voltage?: string; mainAmps?: number };
      panels?: Array<{ name?: string }>;
    };
    const voltage  = j.service?.voltage ?? '';
    const ampacity = j.service?.mainAmps != null ? String(j.service.mainAmps) : '';
    const panels   = j.panels ?? [];
    const main = panels.find(p => /^(MDP|MTP|MSB|MAIN|MPS|MLO)/i.test(p.name ?? '')) ?? panels[0];
    return { voltage, ampacity, panel: main?.name ?? '' };
  } catch {
    return { voltage: '', ampacity: '', panel: '' };
  }
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
  const [expandedCostRow, setExpandedCostRow] = useState<number | null>(null);
  const [costTypeFilter, setCostTypeFilter] = useState<string>('all');
  const [savedEstimate, setSavedEstimate] = useState<BidEstimate | null>(null);
  const [unitCostLib, setUnitCostLib] = useState<{ global: Record<string,number>; by_project_type: Record<string,Record<string,number>> }>({ global: {}, by_project_type: {} });
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [estimateSaved, setEstimateSaved] = useState(false);
  const [bidIntel, setBidIntel] = useState<Record<string,unknown> | null>(null);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [svcVoltage,  setSvcVoltage]  = useState(() => ws.confirmedService?.voltage  ?? '');
  const [svcAmpacity, setSvcAmpacity] = useState(() => ws.confirmedService?.ampacity ?? '');
  const [svcPanel,    setSvcPanel]    = useState(() => ws.confirmedService?.panel    ?? '');
  const [propPrice,  setPropPrice]  = useState('');
  const [propNotes,  setPropNotes]  = useState('');
  const [agent4Running, setAgent4Running] = useState(false);
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
        confirmed_service: ws.confirmedService ?? null,
      }).catch(() => {});
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [ws.step, ws.activeTab, ws.notes, ws.scope, ws.rfis, ws.files, ws.aiDone, ws.proposalGenerated, ws.confirmedService]);

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

  const pollForResults = (startMs = Date.now(), shownAgent2 = false, shownAgent3 = false, failStreak = 0) => {
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
          const scopeFill = buildScopeFromAgent2(data?.agent2_output);
          const filled = Object.keys(scopeFill).length > 0;
          set(prev => ({
            aiRunning: false, aiDone: true,
            scope: filled ? { ...prev.scope, ...scopeFill } : prev.scope,
            aiLog: [...(prev.aiLog ?? []), filled
              ? '✓ Analysis complete — Scope of Work auto-filled. See Plan Review tab.'
              : '✓ Analysis complete — see Plan Review tab.'],
          }));
        } else if (data?.status === 'error') {
          setAiResults(data);
          set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${analysisErrorMessage(data)}`] }));
        } else {
          pollForResults(startMs, nextA2, nextA3, 0);
        }
      } catch {
        // Retry up to 5 times before giving up — handles transient connection drops
        if (failStreak < 5) {
          pollForResults(startMs, shownAgent2, shownAgent3, failStreak + 1);
        } else {
          set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), '✗ Could not reach server after several retries. The analysis may still be running — check the Plan Review tab in a minute.'] }));
        }
      }
    }, 3000);
  };

  useEffect(() => {
    const RUNNING_STATUSES = ['running', 'agent1_complete', 'agent2_running', 'agent2_complete', 'agent3_running'];
    api.get(`/preconstruction/${bid.id}/results`).then(r => {
      if (!r.data) return;
      setAiResults(r.data);
      // Reconnect polling if a pipeline was in progress when the page was refreshed
      if (RUNNING_STATUSES.includes(r.data?.status)) {
        const shownA2 = ['agent2_running', 'agent2_complete', 'agent3_running'].includes(r.data.status);
        const shownA3 = r.data.status === 'agent3_running';
        set({ aiRunning: true, aiLog: ['Analysis in progress — reconnecting…'] });
        pollForResults(Date.now(), shownA2, shownA3);
      }
    }).catch(() => {});
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [bid.id]);

  useEffect(() => {
    api.get('/preconstruction/costs').then(r => setHistoricalCosts(r.data || [])).catch(() => {});
    api.get(`/preconstruction/intelligence/${bid.id}`).then(r => setBidIntel(r.data)).catch(() => {});
    api.get('/estimates/unit-costs').then(r => setUnitCostLib(r.data || { global: {}, by_project_type: {} })).catch(() => {});
    api.get(`/estimates/${bid.id}`).then(r => { if (r.data) setSavedEstimate(r.data); }).catch(() => {});
    api.get(`/documents?linked_id=${bid.id}`).then(r => {
      const docs: ProjectDoc[] = (r.data || []).filter((d: ProjectDoc) => {
        const t = (d.file_type || '').toLowerCase();
        const n = (d.name || '').toLowerCase();
        return t === 'application/pdf' || t.startsWith('image/')
          || n.endsWith('.pdf') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
      });
      setProjectDocs(docs);
    }).catch(() => {});
  }, [bid.id]);

  // Pre-fill service fields from Agent 1 output when it becomes available (skips already-filled fields)
  useEffect(() => {
    const agent1 = aiResults?.agent1_output as string | undefined;
    if (!agent1) return;
    const p = parseAgent1Service(agent1);
    setSvcVoltage(v => v || p.voltage);
    setSvcAmpacity(v => v || p.ampacity);
    setSvcPanel(v => v || p.panel);
  }, [aiResults?.agent1_output]);

  // Pre-fill proposal price from saved estimate grand total
  useEffect(() => {
    if (savedEstimate?.grand_total && !propPrice) {
      setPropPrice(String(Math.round(savedEstimate.grand_total)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedEstimate?.grand_total]);

  const runAI = async (force = false) => {
    if (wsRef.current.aiRunning || (!force && wsRef.current.aiDone)) return;
    const elecUploaded = fileObjectsRef.current.filter(f => isElecSheet(f.name)).length;
    const elecSelected = projectDocs.filter(d => selectedDocIds.has(d.id) && isElecSheet(d.name)).length;
    const elecCount = elecUploaded + elecSelected;
    const hasUploaded = fileObjectsRef.current.length > 0;
    const hasSelected = selectedDocIds.size > 0;
    if (!hasUploaded && !hasSelected) {
      const msg = ws.files.length > 0
        ? '✗ Files from a previous session can\'t be re-sent automatically. Go to the Files tab and check the boxes under "From Project Files" to include them, or re-upload the plan files.'
        : '✗ Upload plan files or select from Project Files before running AI analysis.';
      set({ aiLog: [msg] });
      return;
    }
    const totalCount = fileObjectsRef.current.length + selectedDocIds.size;
    set({ aiRunning: true, aiLog: [`Sending ${totalCount} file(s) (${elecCount} electrical sheet${elecCount !== 1 ? 's' : ''} identified)…`] });
    try {
      const formData = new FormData();
      formData.append('bidId', bid.id);
      fileObjectsRef.current.forEach(f => formData.append('files', f));
      selectedDocIds.forEach(id => formData.append('document_ids', id));
      await api.post('/preconstruction/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 1 of 3: Reading plans & extracting drawing data (1–2 min)…'] }));
      pollForResults(Date.now());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start analysis';
      set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${msg}`] }));
    }
  };

  const resumeAI = async () => {
    if (wsRef.current.aiRunning || wsRef.current.aiDone) return;
    set({ aiRunning: true, aiLog: ['Resuming from Agent 2 — reusing saved plan analysis…'] });
    try {
      const formData = new FormData();
      formData.append('bidId', bid.id);
      formData.append('resume', 'true');
      const { data } = await api.post('/preconstruction/analyze', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const startMsg = data.resumed
        ? 'Agent 2 of 3: Building scope & estimate…'
        : 'Agent 1 of 3: Reading plans & extracting drawing data (1–2 min)…';
      set(prev => ({ aiLog: [...(prev.aiLog ?? []), startMsg] }));
      pollForResults(Date.now(), !!data.resumed, false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to resume analysis';
      set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${msg}`] }));
    }
  };

  const addRfi = () => {
    if (!newRfi.trim()) return;
    const rfi = { id: Date.now().toString(), question: newRfi.trim(), submitted: false, answer: '' };
    set({ rfis: [...ws.rfis, rfi] });
    setNewRfi('');
  };

  const rerunAI = () => {
    if (!window.confirm('Re-run the AI analysis? This will permanently delete the previous takeoff results and clear the Scope of Work.')) return;
    setAiResults(null);
    set({ aiDone: false, aiRunning: false, aiLog: [], scope: {}, confirmedService: undefined });
    setSvcVoltage(''); setSvcAmpacity(''); setSvcPanel('');
    runAI(true);
  };

  const handleConfirmService = () => {
    const data: ConfirmedService = { voltage: svcVoltage.trim(), ampacity: svcAmpacity.trim(), panel: svcPanel.trim(), confirmed: true };
    set({ confirmedService: data });
    showToast({ title: 'Project data confirmed', sub: 'Pricing is now unlocked' });
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

  const computePricingItems = (): EstimateLineItem[] => {
    if (savedEstimate?.line_items?.length) {
      return savedEstimate.line_items.map(li => {
        const key = `${li.category}||${li.item}`;
        const ov = ws.estimateOverrides[key];
        const unit_cost = ov !== undefined ? ov : li.unit_cost;
        return { ...li, unit_cost, total: li.qty * unit_cost, overridden: ov !== undefined || li.overridden };
      });
    }
    return buildLineItemsFromTakeoff(
      aiResults?.agent2_output as string | undefined,
      unitCostLib,
      bid.project_type,
      ws.estimateOverrides
    );
  };

  const saveEstimate = async () => {
    const items = computePricingItems();
    if (!items.length) return;
    setSavingEstimate(true);
    try {
      const { data } = await api.put(`/estimates/${bid.id}`, {
        line_items: items,
        overhead_pct: ws.overheadPct,
        profit_pct: ws.profitPct,
      });
      setSavedEstimate(data);
      setEstimateSaved(true);
      setTimeout(() => setEstimateSaved(false), 3000);
      showToast({ title: 'Estimate saved', sub: `Grand total: ${moneyFull(data.grand_total)}` });
    } finally {
      setSavingEstimate(false);
    }
  };

  const generateProposal = () => {
    set({ proposalGenerated: true });
    showToast({ title: 'Proposal generated', sub: 'Ready to review and send' });
  };

  const runAgent4Proposal = async () => {
    if (!propPrice.trim()) {
      showToast({ title: 'Price required', sub: 'Enter the total bid price before generating the proposal' });
      return;
    }
    setAgent4Running(true);
    try {
      await api.post(`/preconstruction/${bid.id}/run-agent4`, {
        price: propPrice,
        internalNotes: propNotes,
      });
      // Re-fetch full results from DB to confirm storage and update all fields
      const fresh = await api.get(`/preconstruction/${bid.id}/results`);
      if (fresh.data) setAiResults(fresh.data);
      set({ proposalGenerated: true });
      showToast({ title: 'Proposal generated', sub: 'Review the preview and download the .docx' });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to run proposal formatter';
      showToast({ title: 'Agent 4 error', sub: msg });
    } finally {
      setAgent4Running(false);
    }
  };

  const downloadDocx = async () => {
    try {
      const response = await api.get(`/preconstruction/${bid.id}/generate-docx`, { responseType: 'blob' });
      const blob = new Blob([response.data as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Proposal — ${bid.name}.docx`.replace(/[<>:"/\\|?*]/g, '-');
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast({ title: 'Download failed', sub: 'Could not generate the proposal document' });
    }
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

    // Persist to Documents so files survive page refresh
    Promise.all(files.map(f => {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('linked_id', bid.id);
      fd.append('linked_name', bid.name);
      fd.append('div', 'elec');
      fd.append('category', 'plans');
      fd.append('display_name', f.name);
      return api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    })).then(() => {
      api.get(`/documents?linked_id=${bid.id}`).then(r => {
        setProjectDocs((r.data || []).filter((d: ProjectDoc) => {
          const t = (d.file_type || '').toLowerCase();
          const n = (d.name || '').toLowerCase();
          return t === 'application/pdf' || t.startsWith('image/')
            || n.endsWith('.pdf') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png');
        }));
      }).catch(() => {});
    }).catch(() => {});
  };

  const removeFile = (id: string, name: string) => {
    let removed = false;
    fileObjectsRef.current = fileObjectsRef.current.filter(f => {
      if (!removed && f.name === name) {
        removed = true;
        return false;
      }
      return true;
    });
    set({ files: ws.files.filter(f => f.id !== id) });
  };

  const clearFiles = () => {
    fileObjectsRef.current = [];
    set({ files: [] });
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
                { label: 'Est. Contract Value', val: moneyFull(ws.amount), tone: 'green' },
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
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.zip" style={{ display: 'none' }} onChange={handleFileUpload}/>
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
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>PDF, JPG, PNG, ZIP — electrical sheets auto-detected</div>
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
                <div className="panel-hdr">
                  <span className="panel-title">
                    <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                      <Icon name="file" size={15} stroke={1.8}/>
                    </span>
                    Uploaded Plan Files
                  </span>
                  <button className="btn ghost" onClick={clearFiles} style={{ height: 30, fontSize: 12, padding: '0 10px', color: '#E06A6A', borderColor: 'rgba(224,106,106,.45)' }}>
                    <Icon name="x" size={13} stroke={2}/>Clear All
                  </button>
                </div>
                <table className="ctable">
                  <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Sheet Type</th><th></th></tr></thead>
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
                          <td style={{ textAlign: 'right' }}>
                            <button
                              title="Remove file"
                              onClick={() => removeFile(f.id, f.name)}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6 }}
                            >
                              <Icon name="x" size={13} stroke={2}/>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Files already attached to this bid in the Documents tab */}
            {projectDocs.length > 0 && (
              <div className="panel" style={{ marginTop: 16 }}>
                <div className="panel-hdr">
                  <span className="panel-title">
                    <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                      <Icon name="file" size={15} stroke={1.8}/>
                    </span>
                    From Project Files
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                    {selectedDocIds.size > 0 ? `${selectedDocIds.size} selected` : 'Select to include in takeoff'}
                  </span>
                </div>
                <div style={{ padding: '4px 0' }}>
                  {projectDocs.map(d => {
                    const checked = selectedDocIds.has(d.id);
                    const elec = isElecSheet(d.name);
                    return (
                      <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer',
                        background: checked ? 'var(--blue-soft)' : 'transparent', transition: 'background .1s' }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setSelectedDocIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.id); else next.delete(d.id);
                            return next;
                          })}
                          style={{ width: 15, height: 15, accentColor: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <Icon name="file" size={13} stroke={1.8}/>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.display_name || d.name}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', flexShrink: 0,
                          background: elec ? 'var(--green-soft)' : 'var(--surface2)',
                          color: elec ? 'var(--green)' : 'var(--text3)' }}>
                          {elec ? 'Electrical' : d.category}
                        </span>
                      </label>
                    );
                  })}
                </div>
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
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: ws.aiLog.length ? 16 : 0 }}>
                    <button className="btn" onClick={() => runAI()} disabled={ws.aiRunning || ws.aiDone} style={{ fontSize: 13 }}>
                      <Icon name="spark" size={14} stroke={1.9}/>
                      {ws.aiDone ? 'Takeoff Complete' : ws.aiRunning ? 'Running…' : 'Run AI Takeoff'}
                    </button>
                    {!ws.aiRunning && !ws.aiDone && !!aiResults?.agent1_output && (
                      <button className="btn ghost" onClick={resumeAI} style={{ fontSize: 13, color: 'var(--blue)' }}
                        title="Skip re-reading plans — reuse saved Agent 1 output and run Agents 2 & 3 only">
                        <Icon name="arrow" size={14} stroke={2}/> Resume from Agent 2
                      </button>
                    )}
                  </div>
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
                  <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    <button className="btn ghost" onClick={() => set({ activeTab: 'takeoff' })} style={{ fontSize: 13 }}>
                      View Results <Icon name="arrow" size={13} stroke={2}/>
                    </button>
                    <button className="btn ghost" onClick={rerunAI}
                      style={{ fontSize: 13, color: 'var(--red, #EF4444)', borderColor: 'rgba(239,68,68,.35)' }}
                      title="Delete previous results and run a fresh AI analysis">
                      Re-run Analysis
                    </button>
                  </div>
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
        const MODEL_PRICING: Record<string, [number, number]> = {
          'claude-haiku-4-5-20251001': [0.80, 4.00],
          'claude-sonnet-4-6': [3.00, 15.00],
          'claude-opus-4-8': [15.00, 75.00],
        };
        function estimateCost(usage: { input_tokens: number; output_tokens: number } | null | undefined, model: string | null | undefined): number | null {
          if (!usage || !model) return null;
          const pricing = MODEL_PRICING[model];
          if (!pricing) return null;
          return (usage.input_tokens / 1_000_000) * pricing[0] + (usage.output_tokens / 1_000_000) * pricing[1];
        }
        const usageA1 = aiResults?.usage_agent1 as { input_tokens: number; output_tokens: number } | null | undefined;
        const usageA2 = aiResults?.usage_agent2 as { input_tokens: number; output_tokens: number } | null | undefined;
        const usageA3 = aiResults?.usage_agent3 as { input_tokens: number; output_tokens: number } | null | undefined;
        const usageA4 = aiResults?.usage_agent4 as { input_tokens: number; output_tokens: number } | null | undefined;
        const modelA1 = aiResults?.model_agent1 as string | null | undefined;
        const modelA2 = aiResults?.model_agent2 as string | null | undefined;
        const modelA3 = aiResults?.model_agent3 as string | null | undefined;
        const modelA4 = aiResults?.agent4_model  as string | null | undefined;
        const costA1 = estimateCost(usageA1, modelA1);
        const costA2 = estimateCost(usageA2, modelA2);
        const costA3 = estimateCost(usageA3, modelA3);
        const costA4 = estimateCost(usageA4, modelA4);
        const hasUsage = !!(usageA1 || usageA2 || usageA3 || usageA4);
        const totalIn  = (usageA1?.input_tokens  ?? 0) + (usageA2?.input_tokens  ?? 0) + (usageA3?.input_tokens  ?? 0) + (usageA4?.input_tokens  ?? 0);
        const totalOut = (usageA1?.output_tokens ?? 0) + (usageA2?.output_tokens ?? 0) + (usageA3?.output_tokens ?? 0) + (usageA4?.output_tokens ?? 0);
        const totalCost = (costA1 ?? 0) + (costA2 ?? 0) + (costA3 ?? 0) + (costA4 ?? 0);
        const agent1 = aiResults?.agent1_output as string | undefined;
        const agent2 = aiResults?.agent2_output as string | undefined;
        const agent3 = aiResults?.agent3_output as string | undefined;
        const ANALYSIS_TABS = [
          { key: 'agent1' as const, label: 'Drawing Analysis',   output: agent1 },
          { key: 'agent2' as const, label: 'Scope & Estimate',   output: agent2 },
          { key: 'agent3' as const, label: 'QA Review & Risk',   output: agent3 },
          { key: 'raw'    as const, label: 'Raw Data',           output: aiResults ? JSON.stringify(aiResults, null, 2) : undefined },
        ];
        const slug = bid.name.replace(/\s+/g, '-');
        const downloadFile = (content: string, filename: string, mime: string) => {
          const blob = new Blob([content], { type: mime });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          a.click(); URL.revokeObjectURL(url);
        };
        // Export only the sub-tab currently being viewed.
        const exportActive = () => {
          const tab = ANALYSIS_TABS.find(t => t.key === analysisTab);
          if (!tab?.output) return;
          if (tab.key === 'raw') {
            downloadFile(tab.output, `${slug}-raw-data.json`, 'application/json');
          } else {
            downloadFile(`# ${tab.label} — ${bid.name}\n\n${tab.output}`, `${slug}-${tab.key}.md`, 'text/markdown');
          }
        };
        // Export all three agent outputs combined into one file.
        const exportAll = () => {
          const parts = [
            `# Plan Review — ${bid.name}\n`,
            agent1 ? `## Drawing Analysis\n${agent1}` : '',
            agent2 ? `## Scope & Estimate\n${agent2}` : '',
            agent3 ? `## QA Review & Risk\n${agent3}` : '',
          ].filter(Boolean).join('\n\n');
          downloadFile(parts, `${slug}-analysis.md`, 'text/markdown');
        };
        const activeTabMeta = ANALYSIS_TABS.find(t => t.key === analysisTab);
        return (
          <div style={{ padding: '20px 24px' }}>
            {!aiResults?.agent1_output && !aiResults?.agent2_output ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {ws.aiRunning ? 'Analysis running…' : 'Run AI Takeoff in the Bid Builder tab first.'}
              </div>
            ) : !aiResults ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading results…</div>
            ) : (
              <>
                {/* Confirm Key Project Data */}
                {aiResults?.agent1_output && (() => {
                  const isConfirmed = ws.confirmedService?.confirmed;
                  const fieldStyle: React.CSSProperties = {
                    width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
                    color: 'var(--text)', background: 'var(--surface)',
                    border: '1px solid var(--border2)', borderRadius: 8,
                    padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
                  };
                  const labelStyle: React.CSSProperties = {
                    fontSize: 11, fontWeight: 800, color: 'var(--text3)',
                    textTransform: 'uppercase', letterSpacing: '.05em',
                    display: 'block', marginBottom: 6,
                  };
                  return (
                    <div className="panel" style={{ marginBottom: 16, borderColor: isConfirmed ? 'rgba(16,185,129,.35)' : 'rgba(224,165,59,.4)' }}>
                      <div className="panel-hdr" style={{ background: isConfirmed ? 'rgba(16,185,129,.08)' : 'var(--amber-soft)' }}>
                        <span className="panel-title" style={{ color: isConfirmed ? 'var(--green)' : 'var(--amber)' }}>
                          <span className="pt-ic" style={{ background: isConfirmed ? 'rgba(16,185,129,.15)' : 'rgba(224,165,59,.2)', color: isConfirmed ? 'var(--green)' : 'var(--amber)' }}>
                            <Icon name={isConfirmed ? 'check' : 'shield'} size={14} stroke={2.2}/>
                          </span>
                          Confirm Key Project Data
                        </span>
                        {isConfirmed && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>✓ Confirmed — Pricing unlocked</span>
                        )}
                      </div>
                      <div style={{ padding: '14px 20px 6px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
                        <div>
                          <label style={labelStyle}>Service Voltage</label>
                          <input type="text" value={svcVoltage} onChange={e => setSvcVoltage(e.target.value)}
                            placeholder="e.g. 480/277V 3Ø" style={fieldStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>Service Ampacity (A)</label>
                          <input type="text" value={svcAmpacity} onChange={e => setSvcAmpacity(e.target.value)}
                            placeholder="e.g. 400" style={fieldStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>Main Panel Designation</label>
                          <input type="text" value={svcPanel} onChange={e => setSvcPanel(e.target.value)}
                            placeholder="e.g. MDP" style={fieldStyle}/>
                        </div>
                      </div>
                      <div style={{ padding: '10px 20px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button className="btn" style={{ fontSize: 12, height: 32, padding: '0 14px',
                          ...(isConfirmed ? { background: 'var(--green)', borderColor: 'var(--green)' } : {}) }}
                          onClick={handleConfirmService}>
                          <Icon name="check" size={13} stroke={2.2}/>
                          {isConfirmed ? 'Update Confirmation' : 'Confirm Data'}
                        </button>
                        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>
                          Pre-filled from AI analysis — correct as needed before confirming.
                        </span>
                      </div>
                    </div>
                  );
                })()}

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
                  <button onClick={exportActive} disabled={!activeTabMeta?.output}
                    title={`Export only the ${activeTabMeta?.label ?? 'current'} tab`}
                    style={{ marginLeft: 'auto', border: '1px solid var(--border2)', borderRadius: 7,
                      cursor: activeTabMeta?.output ? 'pointer' : 'default',
                      font: 'inherit', fontSize: 12, fontWeight: 700, padding: '5px 12px',
                      background: 'var(--surface2)', color: 'var(--text2)', opacity: activeTabMeta?.output ? 1 : 0.5 }}>
                    ↓ Export {activeTabMeta?.label ?? ''}
                  </button>
                  <button onClick={exportAll}
                    title="Export all three agent outputs combined into one file"
                    style={{ marginLeft: 6, border: '1px solid var(--border2)', borderRadius: 7, cursor: 'pointer',
                      font: 'inherit', fontSize: 12, fontWeight: 700, padding: '5px 12px',
                      background: 'var(--surface2)', color: 'var(--text2)' }}>
                    ↓ All
                  </button>
                </div>
                {/* Run cost summary */}
                {aiResults?.status === 'complete' && hasUsage && (
                  <div style={{ marginBottom: 16, border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
                    <div style={{ padding: '8px 14px', background: 'var(--surface2)', fontWeight: 800, fontSize: 12, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      Run Cost Summary
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                          {['Agent', 'Model', 'Input Tokens', 'Output Tokens', 'Est. Cost'].map(h => (
                            <th key={h} style={{ padding: '6px 14px', textAlign: h === 'Agent' || h === 'Model' ? 'left' : 'right', fontWeight: 700, color: 'var(--text3)', fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: 'Drawing Analysis',  usage: usageA1, model: modelA1, cost: costA1 },
                          { label: 'Scope & Estimate',  usage: usageA2, model: modelA2, cost: costA2 },
                          { label: 'QA Review',         usage: usageA3, model: modelA3, cost: costA3 },
                          { label: 'Proposal Formatter', usage: usageA4, model: modelA4, cost: costA4 },
                        ].map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 14px', fontWeight: 700, color: 'var(--text)' }}>Agent {i + 1} — {row.label}</td>
                            <td style={{ padding: '6px 14px', color: 'var(--text3)', fontFamily: 'monospace', fontSize: 11 }}>{row.model ?? '—'}</td>
                            <td style={{ padding: '6px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.usage ? row.usage.input_tokens.toLocaleString() : '—'}</td>
                            <td style={{ padding: '6px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{row.usage ? row.usage.output_tokens.toLocaleString() : '—'}</td>
                            <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{row.cost != null ? `$${row.cost.toFixed(4)}` : '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--surface2)', fontWeight: 800 }}>
                          <td colSpan={2} style={{ padding: '6px 14px', color: 'var(--text2)' }}>Total</td>
                          <td style={{ padding: '6px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{totalIn.toLocaleString()}</td>
                          <td style={{ padding: '6px 14px', textAlign: 'right', fontFamily: 'monospace' }}>{totalOut.toLocaleString()}</td>
                          <td style={{ padding: '6px 14px', textAlign: 'right', color: 'var(--blue)' }}>{hasUsage && totalCost > 0 ? `$${totalCost.toFixed(4)}` : '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Sub-tab content */}
                {ANALYSIS_TABS.map(t => {
                  if (t.key !== analysisTab) return null;
                  if (!t.output) return (
                    <div key={t.key} style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                      No output yet for this agent.
                    </div>
                  );

                  // Try to parse JSON for structured agents (fence-tolerant)
                  let parsed: Record<string, unknown> | null = null;
                  try {
                    const raw = t.output.trim();
                    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
                    const candidate = fenced ? fenced[1].trim() : raw;
                    const start = candidate.indexOf('{');
                    parsed = JSON.parse(start >= 0 ? candidate.slice(start) : candidate) as Record<string, unknown>;
                  } catch { /* raw text */ }

                  const riskColor = (r: string) =>
                    r === 'HIGH' ? '#EF4444' : r === 'MEDIUM' ? '#F59E0B' : 'var(--green)';
                  const pill = (label: string, color: string) => (
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11,
                      fontWeight: 700, background: color + '22', color }}>
                      {label}
                    </span>
                  );

                  // ── Agent 2 structured view ──────────────────────────────
                  if (t.key === 'agent2' && parsed) {
                    const sow = parsed.scopeOfWork as Record<string, string[]> | undefined;
                    const takeoff = parsed.takeoff as Array<Record<string,unknown>> | undefined;
                    const rfis = parsed.rfis as Array<Record<string,unknown>> | undefined;
                    const exclusions = parsed.exclusions as string[] | undefined;
                    const confidence = parsed.confidence as number | undefined;
                    const manual = parsed.manualCountRequired as string[] | undefined;
                    const SOW_LABELS: [string, string][] = [
                      ['A_ServiceDistribution','A. Service & Distribution'],
                      ['B_BranchPower','B. Branch Power'],
                      ['C_LightingControls','C. Lighting & Controls'],
                      ['D_SiteLightingUnderground','D. Site Lighting, Underground & Allowances'],
                      ['E_LowVoltage','E. Low Voltage Infrastructure'],
                      ['F_Coordination','F. Project Coordination & Closeout'],
                    ];
                    return (
                      <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          {confidence !== undefined && pill(`Confidence: ${Math.round(confidence * 100)}%`, confidence >= 0.75 ? '#10B981' : confidence >= 0.5 ? '#F59E0B' : '#EF4444')}
                          <button onClick={() => copyToClipboard(t.output!, t.key)}
                            style={{ marginLeft: 'auto', border: '1px solid var(--border2)', borderRadius: 7,
                              background: 'var(--surface)', color: copied === t.key ? 'var(--green)' : 'var(--text3)',
                              fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
                            {copied === t.key ? '✓ Copied' : 'Copy JSON'}
                          </button>
                        </div>
                        {sow && SOW_LABELS.map(([key, label]) => {
                          const bullets = sow[key] ?? [];
                          if (!bullets.length) return null;
                          return (
                            <div key={key} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--blue)', marginBottom: 8 }}>{label}</div>
                              {bullets.map((b, i) => (
                                <div key={i} style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, paddingLeft: 12,
                                  borderLeft: '2px solid var(--border2)', marginBottom: 4 }}>
                                  {b}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {takeoff && takeoff.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Quantity Takeoff</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                                  {['Category','Item','Spec','Qty','Unit','Conf'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text3)', fontWeight: 700 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {takeoff.map((row, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                                    <td style={{ padding: '5px 8px', fontSize: 11, color: 'var(--text3)' }}>{String(row.category ?? '')}</td>
                                    <td style={{ padding: '5px 8px' }}>{String(row.item ?? '')}</td>
                                    <td style={{ padding: '5px 8px', fontSize: 11 }}>{String(row.spec ?? '')}</td>
                                    <td style={{ padding: '5px 8px', fontWeight: 700 }}>{String(row.qty ?? '')}</td>
                                    <td style={{ padding: '5px 8px' }}>{String(row.unit ?? '')}</td>
                                    <td style={{ padding: '5px 8px' }}>{pill(String(row.confidence ?? ''), row.confidence === 'VERIFIED' ? '#10B981' : '#F59E0B')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {rfis && rfis.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>RFIs</div>
                            {rfis.map((r, i) => (
                              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6, fontSize: 13 }}>
                                {pill(String(r.risk ?? 'RFI'), riskColor(String(r.risk ?? '')))}
                                <span style={{ color: 'var(--text2)' }}><strong>{String(r.item ?? '')}</strong> — {String(r.question ?? '')}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {exclusions && exclusions.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Exclusions</div>
                            {exclusions.map((e, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 2 }}>• {e}</div>)}
                          </div>
                        )}
                        {manual && manual.length > 0 && (
                          <div style={{ background: '#FEF3C722', border: '1px solid #F59E0B44', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 8 }}>Manual Count Required</div>
                            {manual.map((m, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 2 }}>• {m}</div>)}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── Agent 3 structured view ──────────────────────────────
                  if (t.key === 'agent3' && parsed) {
                    const overallRisk = String(parsed.overallRisk ?? '');
                    const confidence = parsed.confidence as number | undefined;
                    const readyToSubmit = parsed.readyToSubmit as boolean | undefined;
                    const stopItems = parsed.stopItems as string[] | undefined;
                    const catRisk = parsed.categoryRisk as Array<Record<string,unknown>> | undefined;
                    const conflicts = parsed.conflicts as string[] | undefined;
                    const missing = parsed.missingFromScope as string[] | undefined;
                    const topRfis = parsed.topRfis as string[] | undefined;
                    const contingency = String(parsed.contingencyRecommended ?? '');
                    const recommendation = String(parsed.recommendation ?? '');
                    return (
                      <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          {overallRisk && pill(`Overall Risk: ${overallRisk}`, riskColor(overallRisk))}
                          {confidence !== undefined && pill(`Confidence: ${Math.round(confidence * 100)}%`, confidence >= 0.75 ? '#10B981' : confidence >= 0.5 ? '#F59E0B' : '#EF4444')}
                          {readyToSubmit !== undefined && pill(readyToSubmit ? 'Ready to Submit' : 'Not Ready', readyToSubmit ? '#10B981' : '#EF4444')}
                          <button onClick={() => copyToClipboard(t.output!, t.key)}
                            style={{ marginLeft: 'auto', border: '1px solid var(--border2)', borderRadius: 7,
                              background: 'var(--surface)', color: copied === t.key ? 'var(--green)' : 'var(--text3)',
                              fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}>
                            {copied === t.key ? '✓ Copied' : 'Copy JSON'}
                          </button>
                        </div>
                        {recommendation && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>Recommendation</div>
                            {recommendation}
                            {contingency && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text3)' }}>Contingency: <strong>{contingency}</strong></div>}
                          </div>
                        )}
                        {stopItems && stopItems.length > 0 && (
                          <div style={{ background: '#FEE2E222', border: '1px solid #EF444444', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', marginBottom: 8 }}>Stop Items — Resolve Before Submitting</div>
                            {stopItems.map((s, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>• {s}</div>)}
                          </div>
                        )}
                        {catRisk && catRisk.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Category Risk</div>
                            {catRisk.map((r, i) => (
                              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
                                {pill(String(r.risk ?? ''), riskColor(String(r.risk ?? '')))}
                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{String(r.category ?? '')}</span>
                                {r.note ? <span style={{ color: 'var(--text3)', fontSize: 12 }}>— {String(r.note)}</span> : null}
                              </div>
                            ))}
                          </div>
                        )}
                        {conflicts && conflicts.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 8 }}>Conflicts</div>
                            {conflicts.map((c, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>• {c}</div>)}
                          </div>
                        )}
                        {missing && missing.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 8 }}>Missing from Scope</div>
                            {missing.map((m, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>• {m}</div>)}
                          </div>
                        )}
                        {topRfis && topRfis.length > 0 && (
                          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Top RFIs</div>
                            {topRfis.map((r, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>• {r}</div>)}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── Default: raw text / JSON / agent 1 ───────────────────
                  return (
                    <div key={t.key} style={{ position: 'relative' }}>
                      <button onClick={() => copyToClipboard(t.output!, t.key)}
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
                  );
                })}
              </>
            )}
          </div>
        );
      }

      case 'scope': {
        const agent2Scope = aiResults?.agent2_output as string | undefined;
        const importScope = () => {
          const scopeFill = buildScopeFromAgent2(agent2Scope);
          if (!Object.keys(scopeFill).length) {
            showToast({ title: 'Nothing to import', sub: 'No scope sections found in the AI takeoff output' });
            return;
          }
          set({ scope: { ...ws.scope, ...scopeFill } });
          showToast({ title: 'Scope imported', sub: 'Filled from the AI takeoff — review and edit as needed' });
        };
        return (
          <div style={{ padding: '20px 24px' }}>
            {agent2Scope && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <button className="btn ghost" onClick={importScope} style={{ fontSize: 13, color: 'var(--blue)' }}
                  title="Fill these sections from the completed AI takeoff (Agent 2). Existing text in sections the AI didn't produce is kept.">
                  <Icon name="spark" size={14} stroke={1.9}/> Import from AI Takeoff
                </button>
              </div>
            )}
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
      }

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

      case 'proposal': {
        const agent4Raw = aiResults?.agent4_output as string | undefined;
        let propData: Record<string, unknown> | null = null;
        let propParseError = false;
        if (agent4Raw) {
          try { propData = JSON.parse(agent4Raw); }
          catch { propParseError = true; }
        }
        const sow = propData?.scopeOfWork as Record<string, string[]> | undefined;
        const fieldStyle: React.CSSProperties = {
          width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', background: 'var(--surface)',
          border: '1px solid var(--border2)', borderRadius: 8,
          padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
        };
        const labelStyle: React.CSSProperties = {
          fontSize: 11, fontWeight: 800, color: 'var(--text3)',
          textTransform: 'uppercase', letterSpacing: '.05em',
          display: 'block', marginBottom: 6,
        };
        return (
          <div style={{ padding: '20px 24px' }}>
            {/* Input + action panel */}
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic"><Icon name="doc" size={14} stroke={1.9}/></span>
                  Agent 4 — Proposal Formatter
                </span>
                {propData && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
                    <Icon name="check" size={12} stroke={2.2}/> Proposal ready
                  </span>
                )}
              </div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Total Bid Price ($)</label>
                    <input type="number" value={propPrice} onChange={e => setPropPrice(e.target.value)}
                      placeholder="e.g. 285000" style={fieldStyle}/>
                  </div>
                  <div>
                    <label style={labelStyle}>Internal Notes for Agent 4 (optional)</label>
                    <textarea value={propNotes} onChange={e => setPropNotes(e.target.value)}
                      placeholder="Manual items, RFI outcomes, scope adjustments, pricing notes..."
                      rows={3} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}/>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn" onClick={runAgent4Proposal}
                    disabled={agent4Running || !propPrice.trim() || !aiResults?.agent2_output}
                    style={{ fontSize: 13 }}>
                    {agent4Running
                      ? 'Running Agent 4…'
                      : (propData || propParseError) ? '↺ Re-run Agent 4' : 'Run Agent 4 — Generate Proposal'}
                  </button>
                  {(propData || propParseError) && (
                    <button className="btn" onClick={downloadDocx} style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)' }}>
                      <Icon name="doc" size={14} stroke={1.9}/> Download .docx
                    </button>
                  )}
                  {propData && (
                    <button className="btn" onClick={() => setConvertOpen(true)}
                      style={{ fontSize: 13, background: 'var(--green)', borderColor: 'var(--green)', marginLeft: 'auto' }}>
                      <Icon name="check" size={14} stroke={2.2}/> Mark as Awarded
                    </button>
                  )}
                </div>
                {!aiResults?.agent2_output && (
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>
                    ⚠ Run the 3-agent plan analysis first — Agent 4 needs scope data from Agent 2.
                  </div>
                )}
              </div>
            </div>

            {/* Parse error fallback — stored output is not valid JSON (likely a previous truncated run) */}
            {propParseError && agent4Raw && (
              <div className="panel" style={{ marginBottom: 16, borderColor: 'rgba(224,165,59,.4)' }}>
                <div className="panel-hdr" style={{ background: 'var(--amber-soft)' }}>
                  <span className="panel-title" style={{ color: 'var(--amber)' }}>
                    <span className="pt-ic" style={{ background: 'rgba(224,165,59,.2)', color: 'var(--amber)' }}>
                      <Icon name="zap" size={14} stroke={2}/>
                    </span>
                    Previous Proposal Incomplete
                  </span>
                </div>
                <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  The previous Agent 4 run was cut off before it finished — the response was truncated and couldn't be parsed. Click <strong>↺ Re-run Agent 4</strong> above to regenerate (max tokens have been increased to fix this).
                </div>
              </div>
            )}
            {/* Proposal preview */}
            {propData && (
              <div className="panel">
                <div className="panel-hdr">
                  <span className="panel-title">Proposal Preview</span>
                </div>
                <div style={{ padding: '16px 20px', fontSize: 13 }}>
                  {/* Header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, padding: '12px 16px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border2)' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Prepared For</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{String(propData.gcName ?? '—')}</div>
                      {propData.gcContact ? <div style={{ color: 'var(--text3)' }}>{String(propData.gcContact)}</div> : null}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Project</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{String(propData.projectName ?? bid.name)}</div>
                      {propData.projectAddress ? <div style={{ color: 'var(--text3)' }}>{String(propData.projectAddress)}</div> : null}
                    </div>
                  </div>

                  {/* Price */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(31,56,100,.06)', border: '1px solid rgba(31,56,100,.2)', borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>Total Proposed Contract Value:</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1F3864' }}>{String(propData.totalPrice ?? propPrice)}</div>
                  </div>

                  {/* Scope sections */}
                  {sow && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Scope of Work</div>
                      {[
                        ['A. Service & Distribution',                  sow.A_ServiceDistribution],
                        ['B. Branch Power',                            sow.B_BranchPower],
                        ['C. Lighting & Controls',                     sow.C_LightingControls],
                        ['D. Site Lighting, Underground & Allowances', sow.D_SiteLightingUnderground],
                        ['E. Low Voltage Infrastructure',              sow.E_LowVoltage],
                        ['F. Project Coordination & Closeout',         sow.F_Coordination],
                      ].map(([label, bullets]) => {
                        const arr = bullets as string[] | undefined;
                        if (!arr?.length) return null;
                        return (
                          <div key={label as string} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#1F3864', marginBottom: 4 }}>{label as string}</div>
                            <ul style={{ margin: 0, paddingLeft: 18, listStyleType: 'disc' }}>
                              {arr.map((b, i) => <li key={i} style={{ color: 'var(--text2)', marginBottom: 3, lineHeight: 1.5 }}>{b}</li>)}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Exclusions */}
                  {Array.isArray(propData.exclusions) && (propData.exclusions as string[]).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Exclusions</div>
                      <ul style={{ margin: 0, paddingLeft: 18, listStyleType: 'disc' }}>
                        {(propData.exclusions as string[]).map((e, i) => <li key={i} style={{ color: 'var(--text2)', marginBottom: 3, lineHeight: 1.5 }}>{e}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* RFIs to resolve */}
                  {Array.isArray(propData.rfisToResolve) && (propData.rfisToResolve as string[]).length > 0 && (
                    <div style={{ padding: '10px 14px', background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.35)', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', marginBottom: 6 }}>⚠ Open Items to Resolve Before Sending</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {(propData.rfisToResolve as string[]).map((r, i) => <li key={i} style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 3 }}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

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
        );
      }

      case 'pricing': {
        const pricingLineItems = computePricingItems();
        const grouped: Record<string, EstimateLineItem[]> = {};
        for (const li of pricingLineItems) {
          if (!grouped[li.category]) grouped[li.category] = [];
          grouped[li.category].push(li);
        }
        const totalDirect = pricingLineItems.reduce((s, li) => s + li.total, 0);
        const totalOverhead = totalDirect * (ws.overheadPct / 100);
        const totalProfit   = (totalDirect + totalOverhead) * (ws.profitPct / 100);
        const grandTotal    = totalDirect + totalOverhead + totalProfit;
        const compCount = savedEstimate?.comp_count ?? 0;
        const confidence = savedEstimate?.confidence ?? (compCount >= 3 ? 'HIGH' : compCount >= 1 ? 'MEDIUM' : 'LOW');
        const confColor = confidence === 'HIGH' ? 'var(--green)' : confidence === 'MEDIUM' ? 'var(--amber)' : 'var(--text3)';
        const svc = ws.confirmedService;
        return (
          <div style={{ padding: '20px 24px' }}>
            {/* Service data reference / confirmation gate */}
            {svc?.confirmed ? (
              <div style={{ display: 'flex', gap: 20, padding: '10px 16px', background: 'rgba(16,185,129,.08)',
                border: '1px solid rgba(16,185,129,.25)', borderRadius: 10, fontSize: 13, marginBottom: 16,
                flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="check" size={13} stroke={2.2}/>Service Data Confirmed
                </span>
                {svc.voltage && <span style={{ color: 'var(--text2)' }}><strong>Voltage:</strong> {svc.voltage}</span>}
                {svc.ampacity && <span style={{ color: 'var(--text2)' }}><strong>Service:</strong> {svc.ampacity}A</span>}
                {svc.panel && <span style={{ color: 'var(--text2)' }}><strong>Main Panel:</strong> {svc.panel}</span>}
                <button className="btn ghost" style={{ marginLeft: 'auto', height: 26, fontSize: 11, padding: '0 10px' }}
                  onClick={() => set({ activeTab: 'takeoff' })}>
                  Edit →
                </button>
              </div>
            ) : aiResults?.agent1_output ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--amber-soft)',
                border: '1px solid rgba(224,165,59,.35)', borderRadius: 10, fontSize: 13, color: 'var(--amber)', marginBottom: 16 }}>
                <Icon name="shield" size={16} stroke={1.8}/>
                <span style={{ flex: 1, fontWeight: 600 }}>Confirm key project data on the Plan Review tab before pricing to ensure accuracy.</span>
                <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 12px', color: 'var(--amber)', borderColor: 'rgba(224,165,59,.45)', flexShrink: 0 }}
                  onClick={() => set({ activeTab: 'takeoff' })}>
                  Plan Review →
                </button>
              </div>
            ) : null}

            {!pricingLineItems.length ? (
              <div className="panel" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                No takeoff data yet. Complete the AI analysis (Plan Review tab) to populate pricing.
              </div>
            ) : (
              <>
                <div className="panel" style={{ marginBottom: 16 }}>
                  <div className="panel-hdr">
                    <span className="panel-title">Line-Item Estimate</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {savedEstimate && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>
                          {confidence} confidence · {savedEstimate.comp_count} comp{savedEstimate.comp_count !== 1 ? 's' : ''}
                        </span>
                      )}
                      <button className="btn" style={{ height: 30, fontSize: 12, padding: '0 14px' }}
                        onClick={saveEstimate} disabled={savingEstimate}>
                        {savingEstimate ? 'Saving…' : 'Save Estimate'}
                      </button>
                      {estimateSaved && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ctable" style={{ minWidth: 640 }}>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Spec</th>
                          <th style={{ textAlign: 'right' }}>Qty</th>
                          <th>Unit</th>
                          <th style={{ textAlign: 'right' }}>Unit Cost</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(grouped).map(([cat, items]) => {
                          const catTotal = items.reduce((s, li) => s + li.total, 0);
                          return (
                            <React.Fragment key={cat}>
                              <tr style={{ background: 'var(--surface2)' }}>
                                <td colSpan={6} style={{ fontWeight: 800, fontSize: 12, color: 'var(--text2)', padding: '8px 16px', textTransform: 'uppercase', letterSpacing: '.04em' }}>{cat}</td>
                              </tr>
                              {items.map((li, idx) => (
                                <tr key={idx}>
                                  <td className="nm">{li.item}</td>
                                  <td className="sub" style={{ fontSize: 11 }}>—</td>
                                  <td className="num" style={{ textAlign: 'right' }}>{li.qty}</td>
                                  <td className="sub">{li.unit}</td>
                                  <td style={{ textAlign: 'right', padding: '4px 8px' }}>
                                    <input
                                      type="number"
                                      min={0}
                                      value={li.unit_cost}
                                      onChange={e => {
                                        const key = `${li.category}||${li.item}`;
                                        const val = Number(e.target.value);
                                        set({ estimateOverrides: { ...ws.estimateOverrides, [key]: val } });
                                      }}
                                      style={{ width: 90, textAlign: 'right', font: 'inherit', fontSize: 13, fontWeight: 700, color: li.overridden ? 'var(--blue)' : 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '4px 8px', outline: 'none' }}
                                    />
                                  </td>
                                  <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(li.total)}</td>
                                </tr>
                              ))}
                              <tr style={{ borderTop: '2px solid var(--border)' }}>
                                <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, fontSize: 12, color: 'var(--text2)', padding: '6px 16px' }}>{cat} Subtotal</td>
                                <td className="num" style={{ textAlign: 'right', fontWeight: 900 }}>{moneyFull(catTotal)}</td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Total Direct Cost</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{moneyFull(totalDirect)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Grand Total</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--blue)' }}>{moneyFull(grandTotal)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Overhead %</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" min={0} max={100} value={ws.overheadPct}
                          onChange={e => set({ overheadPct: Number(e.target.value) })}
                          style={{ width: 70, font: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 10px', outline: 'none' }}
                        />
                        <span style={{ fontSize: 13, color: 'var(--text3)' }}>{moneyFull(totalOverhead)}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Profit %</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" min={0} max={100} value={ws.profitPct}
                          onChange={e => set({ profitPct: Number(e.target.value) })}
                          style={{ width: 70, font: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 10px', outline: 'none' }}
                        />
                        <span style={{ fontSize: 13, color: 'var(--text3)' }}>{moneyFull(totalProfit)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      }

      case 'costs': {
        const filteredCosts = costTypeFilter === 'all'
          ? historicalCosts
          : historicalCosts.filter(r => r.project_type === costTypeFilter);
        const usedTypes = Array.from(new Set(historicalCosts.map(r => String(r.project_type || '')).filter(Boolean)));
        return (
          <div style={{ padding: '20px 24px' }}>
            {/* Project type filter chips */}
            {usedTypes.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {['all', ...usedTypes].map(val => {
                  const label = val === 'all' ? 'All' : (PROJECT_TYPES.find(t => t.value === val)?.label ?? val);
                  const active = costTypeFilter === val;
                  return (
                    <button key={val} onClick={() => setCostTypeFilter(val)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                        background: active ? 'var(--accent)' : 'var(--surface2)',
                        color: active ? '#fff' : 'var(--text2)' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="panel">
              <div className="panel-hdr"><span className="panel-title">Historical Cost Comps — Awarded Jobs</span></div>
              {filteredCosts.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  {historicalCosts.length === 0 ? 'No awarded jobs yet. Win bids to build your historical cost database.' : 'No jobs match the selected filter.'}
                </div>
              ) : (
                <table className="ctable">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>GC</th>
                      <th>Type</th>
                      <th>Year</th>
                      <th style={{ textAlign: 'right' }}>Sq Ft</th>
                      <th style={{ textAlign: 'right' }}>Contract Value</th>
                      <th style={{ textAlign: 'right' }}>$/SF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCosts.map((row, i) => {
                      const sqFt = row.sq_ft ? Number(row.sq_ft) : null;
                      const amount = Number(row.amount);
                      const perSF = sqFt ? amount / sqFt : null;
                      const subtotals = (row.subtotals as Record<string,number> | null) ?? null;
                      const isExpanded = expandedCostRow === i;
                      const typePt = PROJECT_TYPES.find(t => t.value === String(row.project_type || ''));
                      return (
                        <React.Fragment key={i}>
                          <tr
                            onClick={() => setExpandedCostRow(isExpanded ? null : i)}
                            style={{ cursor: subtotals ? 'pointer' : 'default' }}
                          >
                            <td className="nm">{String(row.name)}</td>
                            <td className="sub">{String(row.gc)}</td>
                            <td className="sub">
                              {typePt ? (
                                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                                  {typePt.label}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="sub">{String(row.year ?? '—')}</td>
                            <td className="num" style={{ textAlign: 'right' }}>{sqFt ? sqFt.toLocaleString() : '—'}</td>
                            <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(amount)}</td>
                            <td className="num" style={{ textAlign: 'right', color: 'var(--text3)' }}>{perSF ? `$${perSF.toFixed(0)}/sf` : '—'}</td>
                          </tr>
                          {isExpanded && subtotals && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--surface2)', padding: '12px 20px' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Category Breakdown</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 16px' }}>
                                  {Object.entries(subtotals).map(([cat, val]) => (
                                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                      <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{cat}</span>
                                      <span style={{ fontWeight: 800 }}>{moneyFull(Number(val))}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      }

      case 'intel':
        return (
          <div style={{ padding: '20px 24px' }}>
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                    <Icon name="sparkle" size={15} stroke={1.8}/>
                  </span>
                  Win-Rate Insights
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
                        val: moneyFull(Number(bidIntel.gcAvgWonAmount)),
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
                      These win-rate stats improve as more bids are entered and outcomes recorded.
                    </div>
                  </>
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading win-rate insights…</div>
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
