import React, { useState, useEffect } from 'react';
import api from '../../../api/client';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, inputStyle } from '../shared';

export function AISection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const keys = ['ai_anthropic_key','ai_model','ai_takeoff_agent2_model','ai_takeoff_agent3_model','ai_max_tokens','ai_temperature'];
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(keys.map(k => [k, (settings as unknown as Record<string,string>)[k] ?? ''])));
  const [orig, setOrig] = useState(vals);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    const fresh = Object.fromEntries(keys.map(k => [k, (settings as unknown as Record<string,string>)[k] ?? '']));
    setVals(fresh); setOrig(fresh);
  }, [settings]);

  const hasChanges = keys.some(k => vals[k] !== orig[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setVals(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try { await api.put('/settings', vals); setOrig(vals); onSaved(); setSaved(true); setTimeout(() => setSaved(false), 3000); }
    finally { setSaving(false); }
  };

  const VISION_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];
  const TEXT_MODELS   = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];

  const mkModelList = (current: string, base: string[]) =>
    current && !base.includes(current) ? [current, ...base] : base;

  return (
    <div>
      <SectionTitle
        title="Plan Analysis · AI Takeoff"
        sub="Settings for the 3-agent AI pipeline used to analyze commercial electrical plans and generate scope/estimates."
      />

      <div style={{ background: 'var(--blue-soft)', border: '1px solid rgba(77,141,247,.25)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--blue)', lineHeight: 1.6 }}>
        <strong>API Key:</strong> Required for plan analysis. Get your key from <strong>console.anthropic.com</strong>. If left blank, AI features return a graceful "unavailable" response.
      </div>

      <Field label="Anthropic API Key" desc="Your key from console.anthropic.com.">
        <input type="password" style={inputStyle} value={vals.ai_anthropic_key} onChange={set('ai_anthropic_key')} placeholder="sk-ant-••••••••••"/>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <Field label="Agent 1 — Vision Model" desc="Reads plan drawings. Sonnet recommended for best extraction.">
          <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_model} onChange={set('ai_model')}>
            {mkModelList(vals.ai_model, VISION_MODELS).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Agent 2 — Scope & Estimate" desc="Builds scope of work and estimate. Haiku is fast and cost-effective.">
          <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_takeoff_agent2_model} onChange={set('ai_takeoff_agent2_model')}>
            {mkModelList(vals.ai_takeoff_agent2_model, TEXT_MODELS).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Agent 3 — QA Review" desc="Checks scope gaps and risk. Haiku is fast and cost-effective.">
          <select style={{ ...inputStyle, appearance: 'none' }} value={vals.ai_takeoff_agent3_model} onChange={set('ai_takeoff_agent3_model')}>
            {mkModelList(vals.ai_takeoff_agent3_model, TEXT_MODELS).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <Field label="Max Tokens" desc="Max output tokens per agent call (256–64000).">
          <input type="number" style={inputStyle} value={vals.ai_max_tokens} onChange={set('ai_max_tokens')} min={256} max={64000}/>
        </Field>
        <Field label="Temperature (0–1)" desc="0 = deterministic, 1 = creative. 0.3 recommended for plan analysis.">
          <input type="number" style={inputStyle} value={vals.ai_temperature} onChange={set('ai_temperature')} min={0} max={1} step={0.1}/>
        </Field>
      </div>

      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}
