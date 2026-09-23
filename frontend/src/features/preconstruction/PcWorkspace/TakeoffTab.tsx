import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { Bid } from '../../../types';
import { PcWorkspace } from '../constants';
import { AppSettings, checkAIPermission } from '../../../hooks/useAppSettings';
import { AiResults } from './shared';
import { parseAgentJson } from './parsing';
import { pill } from './ui';

type AnalysisTabKey = 'agent1' | 'agent2' | 'agent3' | 'raw';

interface TakeoffTabProps {
  ws: PcWorkspace;
  bid: Bid;
  aiResults: AiResults;
  analysisTab: AnalysisTabKey;
  setAnalysisTab: (k: AnalysisTabKey) => void;
  copied: string | null;
  copyToClipboard: (text: string, key: string) => void;
  svcVoltage: string;
  setSvcVoltage: (v: string) => void;
  svcAmpacity: string;
  setSvcAmpacity: (v: string) => void;
  svcPanel: string;
  setSvcPanel: (v: string) => void;
  handleConfirmService: () => void;
  settings?: AppSettings;
  userRole?: string;
}

// The Plan Review tab: Agent 1/2/3 output, the run-cost summary and the
// "Confirm Key Project Data" gate.
function TakeoffTab({ ws, bid, aiResults, analysisTab, setAnalysisTab, copied, copyToClipboard,
  svcVoltage, setSvcVoltage, svcAmpacity, setSvcAmpacity, svcPanel, setSvcPanel,
  handleConfirmService, settings, userRole }: TakeoffTabProps) {
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
    // Takeoff accuracy — corrected to the current list price ($5/$25; the
    // $15/$75 here was Opus 4.0/4.1 pricing) and the counter's default model.
    'claude-opus-4-8': [5.00, 25.00],
    'claude-opus-5': [5.00, 25.00],
    'claude-opus-5-5': [4.00, 20.00],
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
  // Takeoff accuracy — the counting stage (Agent 1C) is its own line.
  const usageC = aiResults?.usage_counter as { input_tokens: number; output_tokens: number } | null | undefined;
  const modelC = aiResults?.model_counter as string | null | undefined;
  const costC = estimateCost(usageC, modelC);
  const modelA1 = aiResults?.model_agent1 as string | null | undefined;
  const modelA2 = aiResults?.model_agent2 as string | null | undefined;
  const modelA3 = aiResults?.model_agent3 as string | null | undefined;
  const modelA4 = aiResults?.agent4_model  as string | null | undefined;
  const costA1 = estimateCost(usageA1, modelA1);
  const costA2 = estimateCost(usageA2, modelA2);
  const costA3 = estimateCost(usageA3, modelA3);
  const costA4 = estimateCost(usageA4, modelA4);
  const hasUsage = !!(usageA1 || usageC || usageA2 || usageA3 || usageA4);
  const totalIn  = (usageA1?.input_tokens  ?? 0) + (usageC?.input_tokens  ?? 0) + (usageA2?.input_tokens  ?? 0) + (usageA3?.input_tokens  ?? 0) + (usageA4?.input_tokens  ?? 0);
  const totalOut = (usageA1?.output_tokens ?? 0) + (usageC?.output_tokens ?? 0) + (usageA2?.output_tokens ?? 0) + (usageA3?.output_tokens ?? 0) + (usageA4?.output_tokens ?? 0);
  const totalCost = (costA1 ?? 0) + (costC ?? 0) + (costA2 ?? 0) + (costA3 ?? 0) + (costA4 ?? 0);
  // Task 2 (phase 2 takeoff fidelity): surface the page-classification
  // inventory so a low-fidelity run is visible instead of a silent log
  // line — "Prep: 14 of 62 pages sent (tiled+text)".
  const prepInventory = aiResults?.prep_inventory as Array<{ included?: boolean }> | null | undefined;
  const prepFidelity = aiResults?.prep_fidelity as string | null | undefined;
  const prepPagesSent  = prepInventory?.filter(p => p.included).length ?? 0;
  const prepPagesTotal = prepInventory?.length ?? 0;
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
          {/* Prep inventory — one line, visible instead of a silent low-fidelity run */}
          {prepFidelity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12.5, fontWeight: 700,
              color: prepFidelity === 'document-fallback' ? 'var(--amber)' : 'var(--text3)' }}>
              <Icon name={prepFidelity === 'document-fallback' ? 'shield' : 'doc'} size={13} stroke={2}/>
              Prep: {prepPagesSent} of {prepPagesTotal} page{prepPagesTotal === 1 ? '' : 's'} sent ({prepFidelity})
            </div>
          )}
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
                    ...(usageC ? [{ label: 'Symbol Counting', usage: usageC, model: modelC, cost: costC }] : []),
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
            const parsed = parseAgentJson(t.output);

            const riskColor = (r: string) =>
              r === 'HIGH' ? 'var(--red)' : r === 'MEDIUM' ? 'var(--amber)' : 'var(--green)';

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
                    {confidence !== undefined && pill(`Confidence: ${Math.round(confidence * 100)}%`, confidence >= 0.75 ? 'var(--green)' : confidence >= 0.5 ? 'var(--amber)' : 'var(--red)')}
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
                              <td style={{ padding: '5px 8px' }}>{pill(String(row.confidence ?? ''), row.confidence === 'VERIFIED' ? 'var(--green)' : 'var(--amber)')}</td>
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
                    <div style={{ background: 'var(--amber-soft)', border: '1px solid rgba(224,165,59,.4)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', marginBottom: 8 }}>Manual Count Required</div>
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
                    {confidence !== undefined && pill(`Confidence: ${Math.round(confidence * 100)}%`, confidence >= 0.75 ? 'var(--green)' : confidence >= 0.5 ? 'var(--amber)' : 'var(--red)')}
                    {readyToSubmit !== undefined && pill(readyToSubmit ? 'Ready to Submit' : 'Not Ready', readyToSubmit ? 'var(--green)' : 'var(--red)')}
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
                    <div style={{ background: 'var(--red-soft)', border: '1px solid rgba(224,106,106,.4)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--red)', marginBottom: 8 }}>Stop Items — Resolve Before Submitting</div>
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
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', marginBottom: 8 }}>Conflicts</div>
                      {conflicts.map((c, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>• {c}</div>)}
                    </div>
                  )}
                  {missing && missing.length > 0 && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--amber)', marginBottom: 8 }}>Missing from Scope</div>
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

export default memo(TakeoffTab);
