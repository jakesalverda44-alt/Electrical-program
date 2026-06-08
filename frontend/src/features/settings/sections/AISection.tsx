import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';

const VISION_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];
const TEXT_MODELS   = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];

const ALL_KEYS = [
  'ai_anthropic_key',
  'ai_model', 'ai_takeoff_agent2_model', 'ai_takeoff_agent3_model', 'ai_takeoff_agent4_model',
  'ai_max_tokens_agent1', 'ai_max_tokens_agent2', 'ai_max_tokens_agent3', 'ai_max_tokens_agent4',
  'ai_temperature',
  'ai_prompt_agent1', 'ai_prompt_agent2', 'ai_prompt_agent3', 'ai_prompt_agent4',
];

const AGENT_LABELS = ['Drawing Analysis', 'Scope & Estimate', 'QA Review', 'Proposal Formatter'];
const PROMPT_KEYS = ['ai_prompt_agent1', 'ai_prompt_agent2', 'ai_prompt_agent3', 'ai_prompt_agent4'] as const;
const MODEL_KEYS  = ['ai_model', 'ai_takeoff_agent2_model', 'ai_takeoff_agent3_model', 'ai_takeoff_agent4_model'] as const;
const TOKEN_KEYS  = ['ai_max_tokens_agent1', 'ai_max_tokens_agent2', 'ai_max_tokens_agent3', 'ai_max_tokens_agent4'] as const;
const MODEL_LISTS = [VISION_MODELS, TEXT_MODELS, TEXT_MODELS, TEXT_MODELS];
const TOKEN_DEFAULTS = ['16000', '4000', '4000', '4000'];
const AGT = ['agent1', 'agent2', 'agent3', 'agent4'] as const;

type PromptDefaults = { agent1: string; agent2: string; agent3: string; agent4: string };

export function AISection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_KEYS.map(k => [k, (settings as unknown as Record<string, string>)[k] ?? '']))
  );
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<PromptDefaults | null>(null);

  // Sync when settings prop changes (e.g. after parent reload)
  useEffect(() => {
    const fresh = Object.fromEntries(ALL_KEYS.map(k => [k, (settings as unknown as Record<string, string>)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  // Fetch hardcoded defaults once; pre-populate empty prompt fields without dirtying the form
  useEffect(() => {
    api.get('/preconstruction/prompt-defaults')
      .then(r => {
        const map = r.data as PromptDefaults;
        setDefaults(map);
        setVals(prev => {
          const next = { ...prev };
          PROMPT_KEYS.forEach((pk, i) => { if (!next[pk]) next[pk] = map[AGT[i]]; });
          return next;
        });
        setOrig(prev => {
          const next = { ...prev };
          PROMPT_KEYS.forEach((pk, i) => { if (!next[pk]) next[pk] = map[AGT[i]]; });
          return next;
        });
      })
      .catch(() => {});
  }, []);

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

  const save = async () => {
    setSaving(true);
    try {
      const toSend = { ...vals };
      if (defaults) {
        PROMPT_KEYS.forEach((pk, i) => {
          if (toSend[pk] === defaults[AGT[i]]) toSend[pk] = '';
        });
      }
      await api.put('/settings', toSend);
      setOrig(vals);
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

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
