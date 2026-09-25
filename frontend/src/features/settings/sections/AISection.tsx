import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { useApi } from '../../../hooks/useApi';
import { useMutation } from '../../../hooks/useMutation';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';

// Current models first. Older ids stay listed so a saved value never falls off
// the list (a <select> whose value isn't an option would save the first option).
const VISION_MODELS = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];
// Takeoff accuracy Task 1 — the counting stage defaults to Opus 5.5 (Decision 1).
const COUNTER_MODELS = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-4-6'];
const TEXT_MODELS   = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];
// Evidence round — the narrow readers (viewports, typical packages, schedule rows).
const EVIDENCE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-opus-4-8'];

const ALL_KEYS = [
  'ai_anthropic_key',
  'ai_model', 'ai_takeoff_agent2_model', 'ai_takeoff_agent3_model', 'ai_takeoff_agent4_model',
  'ai_max_tokens_agent1', 'ai_max_tokens_agent2', 'ai_max_tokens_agent3', 'ai_max_tokens_agent4',
  'ai_temperature',
  'ai_prompt_agent1', 'ai_prompt_agent2', 'ai_prompt_agent3', 'ai_prompt_agent4',
  'ai_reply_draft_model', 'ai_build_from_notes_model',
  'ai_prep_classifier_model',
  'ai_takeoff_counter_model', 'ai_max_tokens_counter',
  'ai_takeoff_evidence_model', 'ai_max_tokens_evidence',
  'ai_job_profile_model',
  'ai_prep_dpi_schedule', 'ai_prep_dpi_plan', 'ai_prep_tiles_schedule', 'ai_prep_tiles_plan',
];

// Task 3 (phase 2 takeoff fidelity): per-class DPI / max-tiles-per-page overrides
// for Stage 0 doc prep. tileInches itself isn't configurable — it's the fixed
// lever the fidelity math is built on (see documentPrep.ts's tileSettingsFor);
// only rendering cost (DPI) and billing cost (tile count) are settings-driven.
const DOC_PREP_ROWS = [
  { label: 'Schedule DPI',  key: 'ai_prep_dpi_schedule',   placeholder: '200', min: 72,  max: 300 },
  { label: 'Plan DPI',      key: 'ai_prep_dpi_plan',       placeholder: '130', min: 72,  max: 300 },
  { label: 'Schedule Tiles/Page', key: 'ai_prep_tiles_schedule', placeholder: '15', min: 1, max: 24 },
  { label: 'Plan Tiles/Page',     key: 'ai_prep_tiles_plan',     placeholder: '6',  min: 1, max: 24 },
] as const;

const AGENT_LABELS = ['Drawing Analysis', 'Scope & Estimate', 'QA Review', 'Proposal Formatter'];
const PROMPT_KEYS = ['ai_prompt_agent1', 'ai_prompt_agent2', 'ai_prompt_agent3', 'ai_prompt_agent4'] as const;
const MODEL_KEYS  = ['ai_model', 'ai_takeoff_agent2_model', 'ai_takeoff_agent3_model', 'ai_takeoff_agent4_model'] as const;
const TOKEN_KEYS  = ['ai_max_tokens_agent1', 'ai_max_tokens_agent2', 'ai_max_tokens_agent3', 'ai_max_tokens_agent4'] as const;
const SONNET_FIRST = ['claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'];
const MODEL_LISTS = [VISION_MODELS, TEXT_MODELS, TEXT_MODELS, SONNET_FIRST];
const TOKEN_DEFAULTS = ['16000', '32000', '16000', '8000'];
const AGT = ['agent1', 'agent2', 'agent3', 'agent4'] as const;

type PromptDefaults = { agent1: string; agent2: string; agent3: string; agent4: string };

export function AISection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_KEYS.map(k => [k, (settings as unknown as Record<string, string>)[k] ?? '']))
  );
  const [orig, setOrig] = useState(vals);
  const [saved,  setSaved]  = useState(false);
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<PromptDefaults | null>(null);

  // Sync when settings prop changes (e.g. after parent reload)
  useEffect(() => {
    const fresh = Object.fromEntries(ALL_KEYS.map(k => [k, (settings as unknown as Record<string, string>)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  // Fetch hardcoded defaults once; pre-populate empty prompt fields without dirtying the form
  const { data: promptDefaults } = useApi<PromptDefaults>('/preconstruction/prompt-defaults');
  useEffect(() => {
    if (!promptDefaults) return;
    const map = promptDefaults;
    setDefaults(map);
    const fill = (prev: Record<string, string>) => {
      const next = { ...prev };
      PROMPT_KEYS.forEach((pk, i) => { if (!next[pk]) next[pk] = map[AGT[i]]; });
      return next;
    };
    setVals(fill);
    setOrig(fill);
  }, [promptDefaults]);

  const isCustomized = (pk: string, agentIdx: number): boolean => {
    if (!defaults) return vals[pk].trim().length > 0;
    return vals[pk] !== defaults[AGT[agentIdx]];
  };

  const hasChanges = ALL_KEYS.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setVals(p => ({ ...p, [k]: e.target.value }));

  const resetPrompt = (pk: string, agentIdx: number) => {
    setVals(p => ({ ...p, [pk]: defaults?.[AGT[agentIdx]] ?? '' }));
  };

  const { run: save, saving } = useMutation(
    async () => {
      const toSend = { ...vals };
      if (defaults) {
        PROMPT_KEYS.forEach((pk, i) => {
          if (toSend[pk] === defaults[AGT[i]]) toSend[pk] = '';
        });
      }
      await api.put('/settings', toSend);
    },
    {
      onSuccess: () => {
        setOrig(vals);
        onSaved();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
      errorTitle: 'Could not save AI configuration',
    },
  );

  return (
    <div>
      <SectionTitle title="AI Configuration" sub="Per-agent model, token limits, temperature, and editable system prompts for the 4-agent takeoff + proposal pipeline."/>

      <div style={{ background: 'var(--blue-soft)', border: '1px solid rgba(77,141,247,.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--blue)', lineHeight: 1.6 }}>
        <strong>API Key:</strong> Required for plan analysis. Your key from <strong>console.anthropic.com</strong>. Leave blank until ready for testing.
      </div>

      <Field label="Anthropic API Key" desc="Your key from console.anthropic.com.">
        <input type="password" style={inputStyle} value={vals.ai_anthropic_key} onChange={set('ai_anthropic_key')} placeholder="sk-ant-••••••••••"/>
      </Field>

      {/* Agents 1–3 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 20px' }}>
        {AGENT_LABELS.slice(0, 3).map((label, i) => {
          const mKey = MODEL_KEYS[i];
          const tKey = TOKEN_KEYS[i];
          const models = MODEL_LISTS[i];
          const currentModel = vals[mKey];
          const modelList = currentModel && !models.includes(currentModel) ? [currentModel, ...models] : models;
          return (
            <div key={i}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 16 }}>
                Agent {i + 1} — {label}
              </div>
              <Field label="Model">
                <select style={{ ...inputStyle, appearance: 'none' }} value={vals[mKey]} onChange={set(mKey)}>
                  {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label={`Max Tokens (default: ${TOKEN_DEFAULTS[i]})`}>
                <input type="number" style={inputStyle} value={vals[tKey]} onChange={set(tKey)} min={256} max={64000}
                  placeholder={TOKEN_DEFAULTS[i]}/>
              </Field>
            </div>
          );
        })}
      </div>

      {/* Agent 4 row */}
      {(() => {
        const i = 3;
        const mKey = MODEL_KEYS[i];
        const tKey = TOKEN_KEYS[i];
        const models = MODEL_LISTS[i];
        const currentModel = vals[mKey];
        const modelList = currentModel && !models.includes(currentModel) ? [currentModel, ...models] : models;
        return (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
              Agent 4 — Proposal Formatter
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', maxWidth: 480 }}>
              <Field label="Model">
                <select style={{ ...inputStyle, appearance: 'none' }} value={vals[mKey]} onChange={set(mKey)}>
                  {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label={`Max Tokens (default: ${TOKEN_DEFAULTS[i]})`}>
                <input type="number" style={inputStyle} value={vals[tKey]} onChange={set(tKey)} min={256} max={64000}
                  placeholder={TOKEN_DEFAULTS[i]}/>
              </Field>
            </div>
          </div>
        );
      })()}

      {/* Takeoff accuracy Task 1 — Agent 1C, the dedicated symbol-counting stage. */}
      {(() => {
        const cur = vals.ai_takeoff_counter_model;
        const models = cur && !COUNTER_MODELS.includes(cur) ? [cur, ...COUNTER_MODELS] : COUNTER_MODELS;
        return (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
              Agent 1C — Symbol Counter
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', maxWidth: 480 }}>
              <Field label="Model" desc="Counts every fixture, device and equipment symbol on each electrical plan sheet.">
                <select aria-label="Counter model" style={{ ...inputStyle, appearance: 'none' }} value={cur} onChange={set('ai_takeoff_counter_model')}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Max Tokens (default: 32000)" desc="Includes the model's thinking. A sheet that runs out fails the run with a message.">
                <input aria-label="Counter max tokens" type="number" style={inputStyle} value={vals.ai_max_tokens_counter} onChange={set('ai_max_tokens_counter')} min={1024} max={128000}
                  placeholder="32000"/>
              </Field>
            </div>
          </div>
        );
      })()}

      {/* Evidence round — the narrow readers that feed the counter. */}
      {(() => {
        const cur = vals.ai_takeoff_evidence_model;
        const models = cur && !EVIDENCE_MODELS.includes(cur) ? [cur, ...EVIDENCE_MODELS] : EVIDENCE_MODELS;
        return (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
              Evidence Readers
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', maxWidth: 480 }}>
              <Field label="Model" desc="Finds each sheet's viewports, reads legends for typical packages and reads schedules row by row (scanned sheets only; text-layer sheets need no call).">
                <select aria-label="Evidence model" style={{ ...inputStyle, appearance: 'none' }} value={cur} onChange={set('ai_takeoff_evidence_model')}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Max Tokens (default: 16000)" desc="Per read. A read that runs out fails the run with a message.">
                <input aria-label="Evidence max tokens" type="number" style={inputStyle} value={vals.ai_max_tokens_evidence} onChange={set('ai_max_tokens_evidence')} min={1024} max={64000}
                  placeholder="16000"/>
              </Field>
            </div>
          </div>
        );
      })()}

      {/* Job profile fix round — the Overview "Plans & Job Profile" reader. */}
      {(() => {
        const cur = vals.ai_job_profile_model;
        const models = cur && !SONNET_FIRST.includes(cur) ? [cur, ...SONNET_FIRST] : SONNET_FIRST;
        return (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
              Job Profile
            </div>
            <div style={{ maxWidth: 300 }}>
              <Field label="Model" desc="Reads the cover, code/area data and electrical title blocks once per plan set to fill the bid card (one small call, a few cents).">
                <select aria-label="Job profile model" style={{ ...inputStyle, appearance: 'none' }} value={cur} onChange={set('ai_job_profile_model')}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
          </div>
        );
      })()}

      {/* Standalone assistant features (not part of the takeoff pipeline) */}
      {(() => {
        const featureModel = (key: string) => {
          const cur = vals[key];
          return cur && !TEXT_MODELS.includes(cur) ? [cur, ...TEXT_MODELS] : TEXT_MODELS;
        };
        return (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
              Assistant Models
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', maxWidth: 480 }}>
              <Field label="Email Reply Draft" desc="Command Center “AI draft reply”. Haiku is faster/cheaper; Opus is highest quality.">
                <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_reply_draft_model} onChange={set('ai_reply_draft_model')}>
                  {featureModel('ai_reply_draft_model').map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Build Proposal from Notes" desc="Generator builder “from notes”. Haiku is faster/cheaper; Opus is highest quality.">
                <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_build_from_notes_model} onChange={set('ai_build_from_notes_model')}>
                  {featureModel('ai_build_from_notes_model').map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
          </div>
        );
      })()}

      {/* Task 3 (phase 2 takeoff fidelity): per-class doc-prep tuning. */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, marginTop: 12 }}>
          Document Prep
        </div>
        {/* FIX-8 (post-review) — ai_prep_classifier_model is read in loadAIConfig
            (Task 2's cheap page-classification model) but had no field here,
            so it was never actually settable from the UI. */}
        <div style={{ maxWidth: 300, marginBottom: 4 }}>
          {(() => {
            const cur = vals.ai_prep_classifier_model;
            const models = cur && !TEXT_MODELS.includes(cur) ? [cur, ...TEXT_MODELS] : TEXT_MODELS;
            return (
              <Field label="Page Classifier Model" desc="Task 2's cheap title-block page classifier. Default: claude-haiku-4-5-20251001.">
                <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_prep_classifier_model} onChange={set('ai_prep_classifier_model')}>
                  <option value="">claude-haiku-4-5-20251001 (default)</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            );
          })()}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0 16px', maxWidth: 640 }}>
          {DOC_PREP_ROWS.map(row => (
            <Field key={row.key} label={row.label} desc={`Default: ${row.placeholder}`}>
              <input type="number" style={inputStyle} value={vals[row.key]} onChange={set(row.key)}
                min={row.min} max={row.max} placeholder={row.placeholder}/>
            </Field>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: -6, marginBottom: 4 }}>
          More tiles per page or higher DPI reads finer detail but costs more input tokens per run. Leave blank for the built-in defaults.
        </div>
      </div>

      <Field label="Temperature (0–1)" desc="Shared across all agents. Lower = more deterministic, higher = more creative.">
        <input type="number" style={{ ...inputStyle, maxWidth: 120 }} value={vals.ai_temperature} onChange={set('ai_temperature')} min={0} max={1} step={0.1}/>
      </Field>

      {/* Collapsible agent prompts */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Agent System Prompts</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
          Edit the system prompts used by each pipeline agent. Changes save to the database and take effect on the next run. Reset to revert to the built-in default.
        </div>
        {AGENT_LABELS.map((label, i) => {
          const pk = PROMPT_KEYS[i];
          const isOpen = openPrompt === i;
          const customized = isCustomized(pk, i);
          return (
            <div key={i} style={{ border: '1px solid var(--border2)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface2)', cursor: 'pointer' }}
                onClick={() => setOpenPrompt(isOpen ? null : i)}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
                  Agent {i + 1} ({label}) System Prompt
                  {customized
                    ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: 'var(--blue)', background: 'var(--blue-soft)', padding: '1px 6px', borderRadius: 4 }}>customized</span>
                    : <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>(default)</span>
                  }
                </span>
                {customized && (
                  <button
                    onClick={e => { e.stopPropagation(); resetPrompt(pk, i); }}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                    Reset to Default
                  </button>
                )}
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>{isOpen ? '▲' : '▼'}</span>
              </div>
              {isOpen && (
                <div style={{ padding: '12px 16px', background: 'var(--surface)' }}>
                  <textarea
                    value={vals[pk]}
                    onChange={set(pk)}
                    rows={14}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 12px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}
